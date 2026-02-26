/**
 * Parser for Claude Code's JSONL session cache files.
 *
 * Session files live at: ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
 *
 * Key behaviours:
 * - Streaming: Claude Code writes one record per streaming chunk; only the final
 *   record (stop_reason !== null) is kept per assistant turn.
 * - Tool flow: assistant emits tool_use blocks → user responds with tool_result
 *   blocks → this parser attaches results back onto the assistant message.
 * - Conversation tree: parentUuid links form a tree; the flat messages array is
 *   sorted by timestamp for display purposes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
  SessionRecord,
  UserRecord,
  AssistantRecord,
  ToolResultBlock,
  ToolUseBlock,
  AssistantContentBlock,
  TextBlock,
  ParsedMessage,
  ParsedSession,
  ResolvedToolCall,
  SessionIndex,
  ConversationNode,
} from '../types/session.ts';

// ─── Path Utilities ────────────────────────────────────────────────────────

/**
 * Encode a filesystem path to the format Claude Code uses for project dirs.
 * e.g. /Users/alice/projects/foo → -Users-alice-projects-foo
 */
export function encodePath(dirPath: string): string {
  return dirPath.replace(/\//g, '-');
}

/**
 * Decode a Claude project directory name back to a filesystem path.
 * e.g. -Users-alice-projects-foo → /Users/alice/projects/foo
 */
export function decodePath(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

/** Absolute path to ~/.claude */
export function getClaudeDir(): string {
  return path.join(os.homedir(), '.claude');
}

/** Absolute path to ~/.claude/projects */
export function getProjectsDir(): string {
  return path.join(getClaudeDir(), 'projects');
}

// ─── Filesystem Discovery ──────────────────────────────────────────────────

/** An entry in the ~/.claude/projects directory */
export interface ProjectEntry {
  /** Encoded directory name (as it appears on disk) */
  encoded: string;
  /** Decoded original filesystem path */
  decoded: string;
  /** Absolute path to the project cache directory */
  cacheDir: string;
}

/**
 * List all project directories under ~/.claude/projects/.
 */
export async function listProjects(): Promise<ProjectEntry[]> {
  const projectsDir = getProjectsDir();
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => ({
      encoded: e.name,
      decoded: decodePath(e.name),
      cacheDir: path.join(projectsDir, e.name),
    }));
}

/**
 * List all session JSONL file paths for a project.
 *
 * @param projectDir - Either the original filesystem path (e.g. /Users/alice/projects/foo)
 *                     or the encoded directory name (e.g. -Users-alice-projects-foo)
 */
export async function listSessionFiles(projectDir: string): Promise<string[]> {
  const encoded = projectDir.startsWith('/') ? encodePath(projectDir) : projectDir;
  const dir = path.join(getProjectsDir(), encoded);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
    .map(e => path.join(dir, e.name));
}

/**
 * Read and parse the sessions-index.json for a project directory.
 * Returns null if the file doesn't exist.
 */
export async function readSessionIndex(projectDir: string): Promise<SessionIndex | null> {
  const encoded = projectDir.startsWith('/') ? encodePath(projectDir) : projectDir;
  const indexPath = path.join(getProjectsDir(), encoded, 'sessions-index.json');
  try {
    const text = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(text) as SessionIndex;
  } catch {
    return null;
  }
}

// ─── JSONL Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a JSONL file from disk into raw SessionRecord objects.
 * Blank lines and malformed JSON lines are silently skipped.
 */
export async function parseJsonlFile(filePath: string): Promise<SessionRecord[]> {
  const text = await fs.readFile(filePath, 'utf8');
  return parseJsonlText(text);
}

/**
 * Parse a JSONL string into raw SessionRecord objects.
 * Accepts multi-line strings (one JSON object per line).
 * Useful for unit testing without filesystem access.
 */
export function parseJsonlText(text: string): SessionRecord[] {
  const records: SessionRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as SessionRecord);
    } catch {
      // Skip malformed lines (partial writes, corruption, etc.)
    }
  }
  return records;
}

// ─── Message Extraction ────────────────────────────────────────────────────

/**
 * Returns true if the assistant record is a streaming intermediate.
 * Claude Code emits multiple records per assistant turn while streaming;
 * the final record has stop_reason === 'end_turn' | 'tool_use'.
 */
function isStreamingIntermediate(record: AssistantRecord): boolean {
  return record.message.stop_reason === null;
}

/**
 * Build a deduplication key for an assistant record.
 * Two records with the same key represent the same logical assistant turn.
 */
function assistantTurnKey(record: AssistantRecord): string {
  return `${record.sessionId}::${record.parentUuid ?? 'root'}`;
}

/**
 * Collect all tool results from user records into a lookup map.
 * key: tool_use_id → { content, isError }
 */
function buildToolResultMap(
  records: SessionRecord[]
): Map<string, { content: string | TextBlock[]; isError: boolean }> {
  const map = new Map<string, { content: string | TextBlock[]; isError: boolean }>();
  for (const record of records) {
    if (record.type !== 'user') continue;
    const { content } = record.message;
    if (!Array.isArray(content)) continue;
    for (const block of content as ToolResultBlock[]) {
      if (block.type === 'tool_result') {
        map.set(block.tool_use_id, {
          content: block.content as string | TextBlock[],
          isError: block.is_error,
        });
      }
    }
  }
  return map;
}

/**
 * Deduplicate assistant records, keeping the best record per logical turn.
 *
 * Strategy:
 * 1. Prefer records with a non-null stop_reason (final records).
 * 2. Among non-final records, keep the last one (most content accumulated).
 *
 * Returns a Set of UUIDs that should be emitted.
 */
function deduplicateAssistantRecords(records: SessionRecord[]): Set<string> {
  // Map: turnKey → best AssistantRecord so far
  const best = new Map<string, AssistantRecord>();

  for (const record of records) {
    if (record.type !== 'assistant') continue;
    const key = assistantTurnKey(record);
    const existing = best.get(key);

    if (!existing) {
      best.set(key, record);
    } else if (!isStreamingIntermediate(record)) {
      // Final record always wins
      best.set(key, record);
    } else if (isStreamingIntermediate(existing)) {
      // Both streaming: keep latest (last in file = most content)
      best.set(key, record);
    }
    // else: existing is final, record is streaming → keep existing
  }

  return new Set(Array.from(best.values()).map(r => r.uuid));
}

/**
 * Extract user and assistant messages from raw session records.
 *
 * What this does:
 * - Filters out system, progress, and file-history-snapshot records
 * - Deduplicates streaming assistant chunks (keeps final record per turn)
 * - Folds tool_result user records into the assistant turn's toolCalls
 * - Sorts results chronologically by timestamp
 *
 * What callers get:
 * - User messages: plain text content (tool-result-only user turns are skipped)
 * - Assistant messages: content blocks with toolCalls populated
 */
export function extractMessages(records: SessionRecord[]): ParsedMessage[] {
  const keepAssistantUuids = deduplicateAssistantRecords(records);
  const toolResultMap = buildToolResultMap(records);

  const messages: ParsedMessage[] = [];

  for (const record of records) {
    if (record.type === 'user') {
      const { content } = record.message;

      // Skip pure tool-result turns (they're attached to assistant messages)
      if (Array.isArray(content)) continue;

      messages.push({
        uuid: record.uuid,
        parentUuid: record.parentUuid,
        sessionId: record.sessionId,
        timestamp: new Date(record.timestamp),
        role: 'user',
        content: content as string,
        cwd: record.cwd,
        gitBranch: record.gitBranch,
        isSidechain: record.isSidechain,
      });
    } else if (record.type === 'assistant') {
      if (!keepAssistantUuids.has(record.uuid)) continue;

      // Resolve tool calls with their results
      const toolCalls: ResolvedToolCall[] = (record.message.content as AssistantContentBlock[])
        .filter((b): b is ToolUseBlock => b.type === 'tool_use')
        .map(b => {
          const result = toolResultMap.get(b.id);
          return {
            id: b.id,
            name: b.name,
            input: b.input,
            result: result?.content,
            isError: result?.isError,
          };
        });

      messages.push({
        uuid: record.uuid,
        parentUuid: record.parentUuid,
        sessionId: record.sessionId,
        timestamp: new Date(record.timestamp),
        role: 'assistant',
        content: record.message.content as AssistantContentBlock[],
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        isStreaming: isStreamingIntermediate(record),
        usage: record.message.usage,
        cwd: record.cwd,
        gitBranch: record.gitBranch,
        isSidechain: record.isSidechain,
      });
    }
    // system, progress, file-history-snapshot → omitted from messages
  }

  // Sort chronologically for display
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return messages;
}

// ─── Conversation Tree ─────────────────────────────────────────────────────

/**
 * Build a conversation tree from parsed messages using parentUuid links.
 *
 * Strategy:
 * 1. Build a parent→children map from all messages
 * 2. Find root messages (parentUuid === null or parentUuid not in message set)
 * 3. Traverse depth-first, prioritizing non-sidechain children (main conversation)
 *    over sidechain children (subagent branches)
 * 4. Return an array of root ConversationNode trees
 */
export function buildConversationTree(messages: ParsedMessage[]): ConversationNode[] {
  if (messages.length === 0) return [];

  // Index messages by uuid for fast lookup
  const byUuid = new Map<string, ParsedMessage>();
  for (const msg of messages) {
    byUuid.set(msg.uuid, msg);
  }

  // Build parent → children map
  const childrenOf = new Map<string, ParsedMessage[]>();
  const roots: ParsedMessage[] = [];

  for (const msg of messages) {
    if (msg.parentUuid === null || !byUuid.has(msg.parentUuid)) {
      roots.push(msg);
    } else {
      let siblings = childrenOf.get(msg.parentUuid);
      if (!siblings) {
        siblings = [];
        childrenOf.set(msg.parentUuid, siblings);
      }
      siblings.push(msg);
    }
  }

  // Sort roots by timestamp
  roots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Recursively build tree nodes
  function buildNode(msg: ParsedMessage, depth: number): ConversationNode {
    const children = childrenOf.get(msg.uuid) ?? [];
    // Sort: non-sidechain first (main conversation), then sidechain; within group, by timestamp
    children.sort((a, b) => {
      if (a.isSidechain !== b.isSidechain) return a.isSidechain ? 1 : -1;
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
    return {
      message: msg,
      children: children.map(c => buildNode(c, depth + 1)),
      depth,
    };
  }

  return roots.map(r => buildNode(r, 0));
}

/**
 * Flatten a conversation tree into a linear array in depth-first traversal order.
 * This produces messages in "conversation order" — the main chain first,
 * with sidechain branches appearing after their parent's main-chain children.
 */
export function flattenTree(tree: ConversationNode[]): ParsedMessage[] {
  const result: ParsedMessage[] = [];
  function walk(node: ConversationNode): void {
    result.push(node.message);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of tree) {
    walk(root);
  }
  return result;
}

// ─── High-Level API ────────────────────────────────────────────────────────

/**
 * Parse a session JSONL file and return structured conversation data.
 * This is the primary entry point for reading a single session.
 */
export async function readSession(filePath: string): Promise<ParsedSession> {
  const allRecords = await parseJsonlFile(filePath);
  const messages = extractMessages(allRecords);
  const conversationTree = buildConversationTree(messages);
  const sessionId = allRecords.find(r => r.sessionId)?.sessionId
    ?? path.basename(filePath, '.jsonl');

  return { sessionId, messages, conversationTree, allRecords, filePath };
}

/**
 * Find and parse the most recently modified session file for a project.
 * Returns null if no session files exist.
 */
export async function getLatestSession(projectDir: string): Promise<ParsedSession | null> {
  const files = await listSessionFiles(projectDir);
  if (files.length === 0) return null;

  const withStats = await Promise.all(
    files.map(async f => ({ file: f, mtime: (await fs.stat(f)).mtime }))
  );
  withStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return readSession(withStats[0].file);
}

/**
 * Read all sessions for a project directory, sorted newest-first.
 */
export async function readAllSessions(projectDir: string): Promise<ParsedSession[]> {
  const files = await listSessionFiles(projectDir);

  const withStats = await Promise.all(
    files.map(async f => ({ file: f, mtime: (await fs.stat(f)).mtime }))
  );
  withStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return Promise.all(withStats.map(s => readSession(s.file)));
}
