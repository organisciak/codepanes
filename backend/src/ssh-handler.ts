/**
 * SSH connection handler.
 *
 * Manages one SSH connection per WebSocket client:
 *   - Opens an SSH connection to the remote host via ssh2
 *   - Requests an interactive PTY shell (or attaches to a tmux session)
 *   - Bridges data between the WebSocket send callback and the SSH stream
 *   - Emits lifecycle events: connected, output, error, closed
 */

import { Client, ClientChannel, ConnectConfig } from "ssh2";
import { EventEmitter } from "events";
import type { ConnectMessage, ClaudeState } from "./types.js";
import { TmuxController } from "./tmux-controller.js";
// @ts-ignore — tsx resolves this at runtime; tsc can't follow cross-package .ts imports
import { TerminalStateParser } from "../../shared/src/terminal/state-parser.js";

export interface SSHHandlerEvents {
  connected: [];
  output: [data: Buffer];
  error: [err: Error, code: string];
  closed: [reason: string];
  stateChange: [state: ClaudeState];
}

export class SSHHandler extends EventEmitter {
  private client: Client | null = null;
  private stream: ClientChannel | null = null;
  private connected = false;
  private _tmux: TmuxController | null = null;
  private stateParser = new TerminalStateParser();

  constructor() {
    super();
    this.stateParser.on("stateChange", (state: ClaudeState) => {
      this.emit("stateChange", state);
    });
  }

  /** TmuxController for the current SSH connection. Only available after connect(). */
  get tmux(): TmuxController | null {
    return this._tmux;
  }

  /** Get the current inferred Claude Code state */
  getState(): ClaudeState {
    return this.stateParser.getState();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async connect(params: ConnectMessage, timeoutMs = 10_000): Promise<void> {
    if (this.connected) {
      throw Object.assign(new Error("Already connected"), { code: "ALREADY_CONNECTED" });
    }

    const config: ConnectConfig = {
      host: params.host,
      port: params.port ?? 22,
      username: params.username,
      readyTimeout: timeoutMs,
    };

    if (params.privateKey) {
      config.privateKey = params.privateKey;
      if (params.passphrase) config.passphrase = params.passphrase;
    } else if (params.password) {
      config.password = params.password;
    } else {
      // Try agent forwarding as fallback (useful in dev)
      config.agent = process.env.SSH_AUTH_SOCK;
    }

    return new Promise((resolve, reject) => {
      const client = new Client();
      this.client = client;

      const onTimeout = setTimeout(() => {
        client.destroy();
        reject(Object.assign(new Error("SSH connection timed out"), { code: "TIMEOUT" }));
      }, timeoutMs + 2_000);

      client.once("ready", () => {
        clearTimeout(onTimeout);
        this._tmux = new TmuxController(client);
        this._openShell(params, resolve, reject);
      });

      client.on("error", (err) => {
        clearTimeout(onTimeout);
        const code = classifySSHError(err);
        this.emit("error", Object.assign(err, { code }), code);
        reject(Object.assign(err, { code }));
      });

      client.on("close", () => {
        this.connected = false;
        this.stream = null;
        this.client = null;
        this._tmux = null;
        this.emit("closed", "SSH connection closed");
      });

      client.on("end", () => {
        this.emit("closed", "SSH connection ended");
      });

      client.connect(config);
    });
  }

  /** Forward raw input (keystrokes) to the SSH shell stream */
  sendInput(data: string): void {
    if (!this.stream) {
      throw Object.assign(new Error("Not connected"), { code: "NOT_CONNECTED" });
    }
    this.stream.write(data);
  }

  /** Notify the remote PTY of a terminal resize */
  resize(cols: number, rows: number): void {
    if (!this.stream) return;
    this.stream.setWindow(rows, cols, 0, 0);
  }

  /** Cleanly close the SSH connection */
  disconnect(): void {
    this.stream?.close();
    this.client?.end();
    this.connected = false;
    this.stream = null;
    this.client = null;
    this._tmux = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _openShell(
    params: ConnectMessage,
    resolve: () => void,
    reject: (err: Error) => void
  ): void {
    const cols = params.cols ?? 220;
    const rows = params.rows ?? 50;

    this.client!.shell(
      { term: "xterm-256color", cols, rows },
      (err, stream) => {
        if (err) {
          reject(Object.assign(err, { code: "INTERNAL_ERROR" }));
          return;
        }

        this.stream = stream;
        this.connected = true;

        stream.on("data", (chunk: Buffer) => {
          this.stateParser.feed(chunk);
          this.emit("output", chunk);
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          // stderr from the remote shell — treat as output
          this.stateParser.feed(chunk);
          this.emit("output", chunk);
        });

        stream.once("close", () => {
          this.connected = false;
          this.stream = null;
          this.emit("closed", "Shell stream closed");
        });

        // If a tmux session name was provided, attach/create it immediately
        if (params.tmuxSession) {
          const session = params.tmuxSession.replace(/[^a-zA-Z0-9_-]/g, "");
          // Create session if it doesn't exist, then attach
          const cmd =
            `tmux new-session -d -s ${session} 2>/dev/null || true; ` +
            `tmux attach-session -t ${session}\r`;
          stream.write(cmd);
        }

        this.emit("connected");
        resolve();
      }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifySSHError(err: Error & { level?: string }): string {
  const msg = err.message?.toLowerCase() ?? "";
  if (err.level === "client-authentication" || msg.includes("auth")) {
    return "AUTH_FAILED";
  }
  if (msg.includes("refused") || msg.includes("econnrefused")) {
    return "CONNECTION_REFUSED";
  }
  if (msg.includes("timeout") || msg.includes("etimedout")) {
    return "TIMEOUT";
  }
  if (msg.includes("unreachable") || msg.includes("enetunreach") || msg.includes("enotfound")) {
    return "HOST_UNREACHABLE";
  }
  return "INTERNAL_ERROR";
}
