/**
 * Core types for the Claude Code Chat UI.
 * Mirrors the JSONL cache format from ~/.claude/projects/
 */

export type ClaudeStatus = 'IDLE' | 'GENERATING' | 'TOOL_RUNNING' | 'THINKING' | 'ERROR';

export type MessageRole = 'user' | 'assistant' | 'system';

export type ToolName =
  | 'Bash'
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'Task'
  | 'WebFetch'
  | 'WebSearch'
  | 'TodoWrite'
  | string;

export interface ToolCall {
  type: 'tool_use';
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  /** Result from the tool, populated when the tool_result arrives */
  result?: string | null;
  isError?: boolean;
  /** Whether this tool is currently executing */
  isRunning?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolCall;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** For user messages: plain string. For assistant: array of content blocks. */
  content: string | ContentBlock[];
  timestamp: Date;
  /** True while the assistant is still streaming this message */
  isStreaming?: boolean;
  /** Token usage for assistant messages */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
  };
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  status: ClaudeStatus;
  /** Error message when status === 'ERROR' */
  error?: string;
  /** The project/cwd this session is associated with */
  cwd?: string;
}
