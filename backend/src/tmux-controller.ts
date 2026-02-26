/**
 * TmuxController — runs tmux commands over SSH exec channels.
 *
 * Unlike the shell-based approach in SSHHandler._openShell(), this class
 * uses `client.exec()` to run individual tmux commands over SSH without
 * requiring an interactive PTY. This is more suitable for programmatic
 * control of tmux sessions.
 */

import { Client } from "ssh2";
import type { TmuxSession } from "./types.js";

export class TmuxController {
  constructor(private client: Client) {}

  /** Run a command over SSH exec and return its stdout */
  private exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        stream.on("close", (code: number) => {
          if (code !== 0 && !stdout) {
            reject(new Error(stderr.trim() || `Command exited with code ${code}`));
          } else {
            resolve(stdout);
          }
        });
      });
    });
  }

  /** Ensure a named session exists, creating it if needed */
  async ensureSession(name: string, cols = 120, rows = 50): Promise<void> {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
    // Check if session exists; if not, create it with the specified dimensions
    await this.exec(
      `tmux has-session -t ${safeName} 2>/dev/null || ` +
      `tmux new-session -d -s ${safeName} -x ${cols} -y ${rows}`
    );
  }

  /** List all tmux sessions */
  async listSessions(): Promise<TmuxSession[]> {
    let output: string;
    try {
      output = await this.exec(
        `tmux list-sessions -F '#{session_name}\t#{session_id}\t#{session_created}\t#{session_attached}'`
      );
    } catch {
      // No tmux server running or no sessions — return empty
      return [];
    }

    const sessions: TmuxSession[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const [name, id, created, attached] = line.split("\t");
      sessions.push({
        name,
        id,
        created: new Date(parseInt(created, 10) * 1000),
        attached: attached !== "0",
      });
    }
    return sessions;
  }

  /** Capture the current pane content (strips ANSI escape codes by default) */
  async capturePane(session: string, lines = 50): Promise<string> {
    const safeName = session.replace(/[^a-zA-Z0-9_-]/g, "");
    const output = await this.exec(
      `tmux capture-pane -t ${safeName} -p -S -${lines}`
    );
    // Strip ANSI escape sequences
    return output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  }

  /** Send keys to a session pane */
  async sendKeys(session: string, keys: string): Promise<void> {
    const safeName = session.replace(/[^a-zA-Z0-9_-]/g, "");
    // Use -- to prevent tmux from interpreting keys as flags
    // Quote the keys to handle spaces and special characters
    const escaped = keys.replace(/'/g, "'\\''");
    await this.exec(`tmux send-keys -t ${safeName} -- '${escaped}'`);
  }
}
