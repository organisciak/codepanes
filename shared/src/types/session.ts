/**
 * TypeScript types for Claude Code's JSONL session file format.
 *
 * Files live at: ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
 * Path encoding: /Users/alice/projects/foo → -Users-alice-projects-foo
 */

// ─── Content Blocks ────────────────────────────────────────────────────────

/** Extended thinking block (when extended thinking is enabled) */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  /** Cryptographic signature from Anthropic API */
  signature?: string;
}

/** Plain text response block */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** A tool invocation by the assistant */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * A tool result returned by the user turn after a tool_use.
 * Appears inside a user message's content array.
 */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  is_error: boolean;
  /** Either a plain string or an array of text/image blocks */
  content: string | TextBlock[];
}

/** Content blocks that can appear in an assistant message */
export type AssistantContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

/** Content blocks that can appear nested inside a tool result */
export type ToolResultContentBlock = TextBlock;

// ─── Message Wrappers ──────────────────────────────────────────────────────

export interface UserMessage {
  role: 'user';
  /**
   * Plain text string for normal user messages.
   * Array of ToolResultBlock when the user turn is delivering tool results.
   */
  content: string | ToolResultBlock[];
}

export interface AssistantMessage {
  role: 'assistant';
  model: string;
  /** Anthropic message ID (msg_...) */
  id: string;
  content: AssistantContentBlock[];
  /** null during streaming; "end_turn" or "tool_use" when complete */
  stop_reason: 'tool_use' | 'end_turn' | null;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
    service_tier?: string;
  };
}

// ─── Base Record Fields ────────────────────────────────────────────────────

/** Fields shared by every JSONL record */
export interface BaseRecord {
  /** Unique ID for this specific record */
  uuid: string;
  /** UUID of the parent record (forms a conversation tree); null for root */
  parentUuid: string | null;
  /** Session UUID this record belongs to */
  sessionId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** True for records belonging to a subagent conversation */
  isSidechain: boolean;
  userType?: string;
  /** Working directory at time of record */
  cwd: string;
  /** Claude Code version string */
  version: string;
  /** Git branch if the cwd is inside a git repo */
  gitBranch?: string;
}

// ─── Record Types ──────────────────────────────────────────────────────────

/** A human turn in the conversation */
export interface UserRecord extends BaseRecord {
  type: 'user';
  message: UserMessage;
  /** Extended thinking configuration */
  thinkingMetadata?: { maxThinkingTokens: number };
  todos?: unknown[];
  permissionMode?: string;
}

/** An assistant (Claude) turn in the conversation */
export interface AssistantRecord extends BaseRecord {
  type: 'assistant';
  /** Anthropic API request ID (req_...) */
  requestId?: string;
  message: AssistantMessage;
}

/** A system/command event (e.g. /resume, /clear) */
export interface SystemRecord extends BaseRecord {
  type: 'system';
  subtype?: string;
  content: string;
  level?: string;
}

/** A hook or tool progress event emitted during tool execution */
export interface ProgressRecord extends BaseRecord {
  type: 'progress';
  /** Human-readable slug for the session */
  slug?: string;
  /** JSON-encoded hook event data */
  data?: string;
  parentToolUseID?: string;
  toolUseID?: string;
}

/** Snapshot of tracked file states at a point in the conversation */
export interface FileHistorySnapshotRecord extends BaseRecord {
  type: 'file-history-snapshot';
  messageId: string;
  isSnapshotUpdate: boolean;
  snapshot: {
    messageId: string;
    timestamp: string;
    trackedFileBackups: Record<string, unknown>;
  };
}

/** Union of all record types found in a session JSONL file */
export type SessionRecord =
  | UserRecord
  | AssistantRecord
  | SystemRecord
  | ProgressRecord
  | FileHistorySnapshotRecord;

// ─── Parsed Output Types ───────────────────────────────────────────────────

/** A tool call from an assistant message with its result attached */
export interface ResolvedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Tool output string or content blocks; undefined if result not yet received */
  result?: string | TextBlock[];
  isError?: boolean;
}

/**
 * A fully parsed conversation turn (user or assistant).
 * Tool results from user records are folded into the assistant message's toolCalls.
 */
export interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: Date;
  role: 'user' | 'assistant';
  /**
   * For user messages: plain text string.
   * For assistant messages: array of content blocks (thinking, text, tool_use).
   */
  content: string | AssistantContentBlock[];
  /** Resolved tool calls with results attached (assistant messages only) */
  toolCalls?: ResolvedToolCall[];
  /** True if this is an intermediate streaming record (stop_reason === null) */
  isStreaming?: boolean;
  /** Token usage (assistant messages only) */
  usage?: AssistantMessage['usage'];
  cwd: string;
  gitBranch?: string;
  isSidechain: boolean;
}

/** A node in the conversation tree, wrapping a message with its branches */
export interface ConversationNode {
  message: ParsedMessage;
  children: ConversationNode[];
  depth: number;
}

/** The result of fully parsing a session JSONL file */
export interface ParsedSession {
  sessionId: string;
  /** Chronological user/assistant messages with streaming duplicates removed */
  messages: ParsedMessage[];
  /** Conversation tree built from parentUuid links */
  conversationTree: ConversationNode[];
  /** Every raw record from the file (includes system, progress, snapshots) */
  allRecords: SessionRecord[];
  /** Absolute path of the source file */
  filePath: string;
}

// ─── Session Index ─────────────────────────────────────────────────────────

export interface SessionIndexEntry {
  sessionId: string;
  timestamp?: string;
}

/** sessions-index.json format in a project directory */
export interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
  /** The original decoded filesystem path this project directory represents */
  originalPath: string;
}
