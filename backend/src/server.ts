/**
 * WebSocket relay server — entry point.
 *
 * Listens for WebSocket connections from the browser frontend and,
 * for each connection, manages an SSH session via SSHHandler.
 *
 * Message protocol (JSON over WebSocket text frames):
 *   Client → Server: ConnectMessage | InputMessage | ResizeMessage | DisconnectMessage
 *   Server → Client: ConnectedMessage | OutputMessage | ErrorMessage | ClosedMessage | PongMessage
 *
 * Usage:
 *   WS_PORT=3005 npx tsx src/server.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { SSHHandler } from "./ssh-handler.js";
import {
  ClientMessage,
  ServerMessage,
  DEFAULT_CONFIG,
} from "./types.js";

const config = DEFAULT_CONFIG;

// ─── WebSocket server setup ───────────────────────────────────────────────────

const wss = new WebSocketServer({
  port: config.wsPort,
  // Allow all origins in dev; add CORS check here for production
  verifyClient: (_info: { origin: string; req: IncomingMessage; secure: boolean }) => true,
});

console.log(`[server] WebSocket relay listening on ws://localhost:${config.wsPort}`);

wss.on("connection", (ws, req) => {
  const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`[server] Client connected: ${clientId}`);

  const session = new ClientSession(ws, clientId);

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      session.sendError("INVALID_MESSAGE", "Malformed JSON");
      return;
    }
    session.handleMessage(msg);
  });

  ws.on("ping", () => ws.pong());

  ws.on("close", (code, reason) => {
    console.log(`[server] Client disconnected: ${clientId} (code=${code} reason=${reason.toString()})`);
    session.destroy();
  });

  ws.on("error", (err) => {
    console.error(`[server] WebSocket error for ${clientId}:`, err.message);
    session.destroy();
  });
});

wss.on("error", (err) => {
  console.error("[server] Fatal WebSocket server error:", err);
  process.exit(1);
});

// ─── Per-connection session ───────────────────────────────────────────────────

class ClientSession {
  private ssh = new SSHHandler();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private lastConnectParams: { host: string; username: string } = { host: "?", username: "?" };

  constructor(
    private readonly ws: WebSocket,
    private readonly clientId: string
  ) {
    this._wireSSHEvents();
    if (config.keepaliveInterval > 0) {
      this._startKeepalive();
    }
  }

  // ── Message dispatch ────────────────────────────────────────────────────────

  handleMessage(msg: ClientMessage): void {
    if (this.destroyed) return;

    switch (msg.type) {
      case "connect":
        this._handleConnect(msg);
        break;

      case "input":
        try {
          this.ssh.sendInput(msg.data);
        } catch (err: unknown) {
          const e = err as Error & { code?: string };
          this.sendError(e.code ?? "INTERNAL_ERROR", e.message);
        }
        break;

      case "resize":
        this.ssh.resize(msg.cols, msg.rows);
        break;

      case "disconnect":
        this.ssh.disconnect();
        break;

      case "tmux-list":
        this._handleTmuxList();
        break;

      case "get-state":
        this.send({ type: "state", state: this.ssh.getState() });
        break;

      default:
        this.sendError("INVALID_MESSAGE", `Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  // ── Tmux ────────────────────────────────────────────────────────────────────

  private async _handleTmuxList(): Promise<void> {
    const tmux = this.ssh.tmux;
    if (!tmux) {
      this.sendError("NOT_CONNECTED", "SSH not connected — cannot list tmux sessions");
      return;
    }
    try {
      const sessions = await tmux.listSessions();
      this.send({ type: "tmux-sessions", sessions });
    } catch (err: unknown) {
      const e = err as Error;
      this.sendError("INTERNAL_ERROR", e.message);
    }
  }

  // ── SSH connect ─────────────────────────────────────────────────────────────

  private async _handleConnect(msg: Extract<ClientMessage, { type: "connect" }>): Promise<void> {
    if (this.ssh.isConnected()) {
      this.sendError("ALREADY_CONNECTED", "Already connected to an SSH host");
      return;
    }

    this.lastConnectParams = { host: msg.host, username: msg.username };
    console.log(`[session:${this.clientId}] Connecting to ${msg.username}@${msg.host}:${msg.port ?? 22}`);

    try {
      await this.ssh.connect(msg, config.sshTimeout);
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      console.error(`[session:${this.clientId}] SSH connect failed: ${e.message}`);
      this.sendError(e.code ?? "INTERNAL_ERROR", e.message);
    }
  }

  // ── SSH event wiring ────────────────────────────────────────────────────────

  private _wireSSHEvents(): void {
    this.ssh.on("connected", () => {
      console.log(`[session:${this.clientId}] SSH connected`);
      this.send({ type: "connected", ...this.lastConnectParams });
    });

    this.ssh.on("output", (chunk: Buffer) => {
      this.send({ type: "output", data: chunk.toString("binary") });
    });

    this.ssh.on("error", (err: Error, code: string) => {
      console.error(`[session:${this.clientId}] SSH error [${code}]:`, err.message);
      this.sendError(code, err.message);
    });

    this.ssh.on("closed", (reason: string) => {
      console.log(`[session:${this.clientId}] SSH closed: ${reason}`);
      this.send({ type: "closed", reason });
    });

    this.ssh.on("stateChange", (state) => {
      this.send({ type: "state", state });
    });
  }

  // ── Keepalive ───────────────────────────────────────────────────────────────

  private _startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, config.keepaliveInterval);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  send(msg: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendError(code: string, message: string): void {
    this.ws.send(JSON.stringify({ type: "error", code, message }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.ssh.disconnect();
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  wss.close(() => {
    console.log("[server] WebSocket server closed");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
