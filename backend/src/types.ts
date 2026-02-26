/**
 * Shared TypeScript types for the WebSocket ↔ SSH relay server.
 *
 * Message protocol between browser client and relay server:
 *   Client → Server: ClientMessage
 *   Server → Client: ServerMessage
 */

// ─── Client → Server messages ────────────────────────────────────────────────

/** Initiate an SSH connection */
export interface ConnectMessage {
  type: "connect";
  host: string;
  port?: number;          // default 22
  username: string;
  /** Provide exactly one of: password, privateKey */
  password?: string;
  privateKey?: string;    // PEM string
  passphrase?: string;    // passphrase for encrypted private key
  /** tmux session to attach/create on the remote (optional) */
  tmuxSession?: string;
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
}

/** Raw keystroke / terminal input to forward to SSH stream */
export interface InputMessage {
  type: "input";
  data: string;           // raw chars (may include escape sequences)
}

/** Terminal resize event */
export interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

/** Graceful disconnect request */
export interface DisconnectMessage {
  type: "disconnect";
}

// ─── Server → Client messages ─────────────────────────────────────────────────

/** SSH connection established */
export interface ConnectedMessage {
  type: "connected";
  host: string;
  username: string;
}

/** Raw output from the SSH shell */
export interface OutputMessage {
  type: "output";
  data: string;           // raw bytes as string (UTF-8)
}

/** Error from SSH layer or relay server */
export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

/** SSH session closed (gracefully or via error) */
export interface ClosedMessage {
  type: "closed";
  reason?: string;
}

/** Pong response to a ping (keepalive) */
export interface PongMessage {
  type: "pong";
}

/** Inferred Claude Code operational state (mirrors shared/terminal/state-parser.ts) */
export type ClaudeState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "tool_running"; toolName?: string }
  | { status: "thinking" }
  | { status: "error"; message?: string }
  | { status: "unknown" };

/** Claude Code state update (inferred from terminal output) */
export interface StateMessage {
  type: "state";
  state: ClaudeState;
}

export type ServerMessage =
  | ConnectedMessage
  | OutputMessage
  | ErrorMessage
  | ClosedMessage
  | PongMessage
  | TmuxSessionsMessage
  | StateMessage;

/** Request a list of tmux sessions on the remote host */
export interface TmuxListMessage {
  type: "tmux-list";
}

/** Request the current Claude Code state */
export interface GetStateMessage {
  type: "get-state";
}

export type ClientMessage =
  | ConnectMessage
  | InputMessage
  | ResizeMessage
  | DisconnectMessage
  | TmuxListMessage
  | GetStateMessage;

// ─── Tmux types ───────────────────────────────────────────────────────────────

/** A tmux session on the remote host */
export interface TmuxSession {
  name: string;
  id: string;
  created: Date;
  attached: boolean;
}

/** Server response with a list of tmux sessions */
export interface TmuxSessionsMessage {
  type: "tmux-sessions";
  sessions: TmuxSession[];
}

// ─── Error codes ──────────────────────────────────────────────────────────────

export type ErrorCode =
  | "AUTH_FAILED"
  | "CONNECTION_REFUSED"
  | "HOST_UNREACHABLE"
  | "TIMEOUT"
  | "ALREADY_CONNECTED"
  | "NOT_CONNECTED"
  | "INVALID_MESSAGE"
  | "INTERNAL_ERROR";

// ─── Server config ────────────────────────────────────────────────────────────

export interface ServerConfig {
  /** Port for the WebSocket server to listen on */
  wsPort: number;
  /** SSH connection timeout in milliseconds */
  sshTimeout: number;
  /** Maximum simultaneous connections per WebSocket client (always 1 currently) */
  maxConnections: number;
  /** Keepalive interval in milliseconds (0 = disabled) */
  keepaliveInterval: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  wsPort: parseInt(process.env.WS_PORT ?? "3005", 10),
  sshTimeout: 10_000,
  maxConnections: 1,
  keepaliveInterval: 30_000,
};
