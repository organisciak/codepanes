/**
 * Tests for the JSONL session parser.
 * Run with: node --import tsx/esm --test src/parser/jsonl-parser.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonlText, extractMessages, encodePath, decodePath, buildConversationTree, flattenTree } from './jsonl-parser.ts';
import type { ConversationNode } from '../types/session.ts';

// ─── Sample Data ───────────────────────────────────────────────────────────

const SESSION_ID = 'aaaaaaaa-1111-2222-3333-000000000000';

/** Monotonically increasing counter for unique, ordered timestamps */
let _seq = 0;

/**
 * Build a base record template to reduce boilerplate in samples.
 * Each call increments an internal counter so all timestamps are unique and ordered.
 */
function base(uuid: string, parentUuid: string | null = null) {
  // 2026-02-24T10:00:00Z + (++_seq) minutes → produces valid, strictly increasing timestamps
  const ts = new Date(Date.UTC(2026, 1, 24, 10, ++_seq, 0)).toISOString();
  return {
    uuid,
    parentUuid,
    sessionId: SESSION_ID,
    timestamp: ts,
    isSidechain: false,
    userType: 'external',
    cwd: '/Users/alice/projects/foo',
    version: '2.1.55',
    gitBranch: 'main',
  };
}

/**
 * A minimal realistic session:
 *
 *  user-01 (plain text message)
 *    └─ asst-02 (text response)
 *         └─ user-03 (plain text message)
 *              └─ asst-04-stream (streaming intermediate — stop_reason: null)
 *                   └─ asst-04-final (streaming final — stop_reason: end_turn)
 *                        └─ user-05 (plain text)
 *                             └─ asst-06 (tool_use: Bash)
 *                                  └─ user-07 (tool_result)
 *                                       └─ asst-08 (text after tool result)
 */
const BASIC_SESSION_JSONL = [
  // user-01: plain user message
  JSON.stringify({
    ...base('user-01'),
    type: 'user',
    message: { role: 'user', content: 'How do I list files recursively?' },
    permissionMode: 'default',
    todos: [],
  }),

  // asst-02: simple text response
  JSON.stringify({
    ...base('asst-02', 'user-01'),
    type: 'assistant',
    requestId: 'req_001',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_001',
      content: [{ type: 'text', text: 'You can use `find . -type f` or `ls -R`.' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 20,
      },
    },
  }),

  // user-03: follow-up question
  JSON.stringify({
    ...base('user-03', 'asst-02'),
    type: 'user',
    message: { role: 'user', content: 'Can you run ls for me?' },
    permissionMode: 'default',
    todos: [],
  }),

  // asst-04-stream: intermediate streaming record (stop_reason: null) — should be DROPPED
  JSON.stringify({
    ...base('asst-04-stream', 'user-03'),
    type: 'assistant',
    requestId: 'req_002',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_002',
      content: [{ type: 'text', text: "Sure, let me run" }],
      stop_reason: null,
      usage: {
        input_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 50,
        output_tokens: 5,
      },
    },
  }),

  // asst-04-final: final record for same turn (same parentUuid) — should be KEPT
  JSON.stringify({
    ...base('asst-04-final', 'user-03'),
    type: 'assistant',
    requestId: 'req_002',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_002',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_bash_001',
          name: 'Bash',
          input: { command: 'ls -la', description: 'List files' },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 50,
        output_tokens: 40,
      },
    },
  }),

  // user-04-toolresult: tool result — should be FOLDED into asst-04-final, not emitted as message
  JSON.stringify({
    ...base('user-04-toolresult', 'asst-04-final'),
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_bash_001',
          is_error: false,
          content: 'README.md\nsrc/\npackage.json',
        },
      ],
    },
  }),

  // asst-05: response after tool — includes thinking block
  JSON.stringify({
    ...base('asst-05', 'user-04-toolresult'),
    type: 'assistant',
    requestId: 'req_003',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_003',
      content: [
        { type: 'thinking', thinking: 'The ls output shows 3 items.', signature: 'sig_abc' },
        { type: 'text', text: 'Here are the files: README.md, src/, package.json' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 150,
        output_tokens: 30,
      },
    },
  }),

  // system record — should be excluded from messages
  JSON.stringify({
    ...base('sys-001', 'asst-05'),
    type: 'system',
    subtype: 'local_command',
    content: '<command-name>resume</command-name>',
    level: 'info',
  }),

  // progress record — should be excluded from messages
  JSON.stringify({
    ...base('prog-001', 'asst-04-final'),
    type: 'progress',
    slug: 'happy-blue-river',
    data: '{"type":"hook_progress"}',
    parentToolUseID: 'toolu_bash_001',
    toolUseID: 'toolu_bash_001',
  }),
].join('\n');

/**
 * Session with an error tool result.
 */
const ERROR_TOOL_JSONL = [
  JSON.stringify({
    ...base('u-01'),
    type: 'user',
    message: { role: 'user', content: 'Run a broken command' },
    permissionMode: 'default',
    todos: [],
  }),
  JSON.stringify({
    ...base('a-01', 'u-01'),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_err',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_err',
          name: 'Bash',
          input: { command: 'definitely_not_a_real_command' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
    },
  }),
  JSON.stringify({
    ...base('u-02', 'a-01'),
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_err',
          is_error: true,
          content: 'command not found: definitely_not_a_real_command',
        },
      ],
    },
  }),
].join('\n');

/**
 * Session with multiple streaming chunks for the same turn.
 * Only the last chunk (with a non-null stop_reason) should survive.
 */
const STREAMING_DEDUP_JSONL = [
  JSON.stringify({
    ...base('u-01'),
    type: 'user',
    message: { role: 'user', content: 'Tell me a story' },
    permissionMode: 'default',
    todos: [],
  }),
  // chunk 1
  JSON.stringify({
    ...base('a-chunk1', 'u-01'),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_story',
      content: [{ type: 'text', text: 'Once' }],
      stop_reason: null,
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  }),
  // chunk 2
  JSON.stringify({
    ...base('a-chunk2', 'u-01'),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_story',
      content: [{ type: 'text', text: 'Once upon a time' }],
      stop_reason: null,
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 4 },
    },
  }),
  // final chunk
  JSON.stringify({
    ...base('a-final', 'u-01'),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      id: 'msg_story',
      content: [{ type: 'text', text: 'Once upon a time, there was a parser.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
    },
  }),
].join('\n');

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('encodePath / decodePath', () => {
  it('encodes a Unix path by replacing slashes with dashes', () => {
    assert.equal(encodePath('/Users/alice/projects/foo'), '-Users-alice-projects-foo');
  });

  it('encodes the root path', () => {
    assert.equal(encodePath('/'), '-');
  });

  it('round-trips cleanly for paths without hyphens in segment names', () => {
    // decodePath is intentionally lossy: hyphens in segment names are
    // indistinguishable from encoded slashes. Round-trip only works for
    // paths whose segment names contain no literal hyphens.
    assert.equal(decodePath(encodePath('/Users/alice/projects/foo')), '/Users/alice/projects/foo');
    assert.equal(decodePath(encodePath('/home')), '/home');
    assert.equal(decodePath(encodePath('/tmp/work/session')), '/tmp/work/session');
  });

  it('decodePath converts leading dash to leading slash', () => {
    assert.equal(decodePath('-Users-bob-code'), '/Users/bob/code');
  });
});

describe('parseJsonlText', () => {
  it('returns an empty array for empty string', () => {
    assert.deepEqual(parseJsonlText(''), []);
  });

  it('skips blank lines', () => {
    const text = '\n\n' + JSON.stringify({ type: 'system', uuid: 'x' }) + '\n\n';
    const records = parseJsonlText(text);
    assert.equal(records.length, 1);
  });

  it('skips malformed JSON lines without throwing', () => {
    const text = [
      JSON.stringify({ type: 'user', uuid: 'a' }),
      'this is not json {{{',
      JSON.stringify({ type: 'assistant', uuid: 'b' }),
    ].join('\n');
    const records = parseJsonlText(text);
    assert.equal(records.length, 2);
  });

  it('parses all records from the basic session fixture', () => {
    const records = parseJsonlText(BASIC_SESSION_JSONL);
    // user-01, asst-02, user-03, asst-04-stream, asst-04-final,
    // user-04-toolresult, asst-05, sys-001, prog-001 = 9 records
    assert.equal(records.length, 9);
  });

  it('preserves record types', () => {
    const records = parseJsonlText(BASIC_SESSION_JSONL);
    const types = records.map(r => r.type);
    assert.deepEqual(types, [
      'user', 'assistant', 'user', 'assistant', 'assistant',
      'user', 'assistant', 'system', 'progress',
    ]);
  });
});

describe('extractMessages — basic session', () => {
  const records = parseJsonlText(BASIC_SESSION_JSONL);
  const messages = extractMessages(records);

  it('excludes system and progress records', () => {
    assert.ok(messages.every(m => m.role === 'user' || m.role === 'assistant'));
  });

  it('excludes tool-result-only user turns', () => {
    // user-04-toolresult has array content → should be excluded
    const uuids = messages.map(m => m.uuid);
    assert.ok(!uuids.includes('user-04-toolresult'));
  });

  it('keeps plain-text user messages', () => {
    const userMessages = messages.filter(m => m.role === 'user');
    assert.equal(userMessages.length, 2); // user-01, user-03
    assert.equal(userMessages[0].uuid, 'user-01');
    assert.equal(userMessages[1].uuid, 'user-03');
  });

  it('drops the streaming intermediate and keeps the final assistant record', () => {
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const uuids = assistantMessages.map(m => m.uuid);
    assert.ok(!uuids.includes('asst-04-stream'), 'streaming intermediate should be dropped');
    assert.ok(uuids.includes('asst-04-final'), 'final streaming record should be kept');
  });

  it('keeps all three assistant turns', () => {
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    assert.equal(assistantMessages.length, 3); // asst-02, asst-04-final, asst-05
  });

  it('attaches tool result to the assistant message that issued the tool_use', () => {
    const asst04 = messages.find(m => m.uuid === 'asst-04-final');
    assert.ok(asst04, 'asst-04-final should be in messages');
    assert.ok(asst04.toolCalls, 'should have toolCalls');
    assert.equal(asst04.toolCalls!.length, 1);
    const call = asst04.toolCalls![0];
    assert.equal(call.id, 'toolu_bash_001');
    assert.equal(call.name, 'Bash');
    assert.equal(call.result, 'README.md\nsrc/\npackage.json');
    assert.equal(call.isError, false);
  });

  it('parses thinking blocks in assistant content', () => {
    const asst05 = messages.find(m => m.uuid === 'asst-05');
    assert.ok(asst05, 'asst-05 should be in messages');
    const content = asst05.content as Array<{ type: string }>;
    assert.equal(content[0].type, 'thinking');
    assert.equal(content[1].type, 'text');
  });

  it('sorts messages chronologically', () => {
    for (let i = 1; i < messages.length; i++) {
      assert.ok(
        messages[i].timestamp >= messages[i - 1].timestamp,
        `message ${i} should be >= message ${i - 1}`
      );
    }
  });

  it('preserves parentUuid relationships', () => {
    const asst02 = messages.find(m => m.uuid === 'asst-02');
    assert.ok(asst02);
    assert.equal(asst02.parentUuid, 'user-01');

    const user01 = messages.find(m => m.uuid === 'user-01');
    assert.ok(user01);
    assert.equal(user01.parentUuid, null);
  });

  it('includes usage stats on assistant messages', () => {
    const asst02 = messages.find(m => m.uuid === 'asst-02');
    assert.ok(asst02?.usage);
    assert.equal(asst02.usage!.output_tokens, 20);
  });
});

describe('extractMessages — error tool result', () => {
  const records = parseJsonlText(ERROR_TOOL_JSONL);
  const messages = extractMessages(records);

  it('marks error tool results', () => {
    const asst = messages.find(m => m.role === 'assistant');
    assert.ok(asst?.toolCalls);
    const call = asst.toolCalls![0];
    assert.equal(call.isError, true);
    assert.equal(call.result, 'command not found: definitely_not_a_real_command');
  });

  it('produces only one user and one assistant message', () => {
    assert.equal(messages.filter(m => m.role === 'user').length, 1);
    assert.equal(messages.filter(m => m.role === 'assistant').length, 1);
  });
});

describe('extractMessages — streaming deduplication', () => {
  const records = parseJsonlText(STREAMING_DEDUP_JSONL);
  const messages = extractMessages(records);

  it('collapses three assistant chunks into one message', () => {
    assert.equal(messages.filter(m => m.role === 'assistant').length, 1);
  });

  it('keeps the final chunk with full text', () => {
    const asst = messages.find(m => m.role === 'assistant');
    assert.ok(asst);
    const content = asst.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].text, 'Once upon a time, there was a parser.');
  });

  it('marks the kept record as non-streaming', () => {
    const asst = messages.find(m => m.role === 'assistant');
    assert.equal(asst!.isStreaming, false);
  });
});

describe('extractMessages — content field types', () => {
  it('user messages have string content', () => {
    const records = parseJsonlText(BASIC_SESSION_JSONL);
    const messages = extractMessages(records);
    for (const m of messages.filter(m => m.role === 'user')) {
      assert.equal(typeof m.content, 'string', `user message ${m.uuid} should have string content`);
    }
  });

  it('assistant messages have array content', () => {
    const records = parseJsonlText(BASIC_SESSION_JSONL);
    const messages = extractMessages(records);
    for (const m of messages.filter(m => m.role === 'assistant')) {
      assert.ok(Array.isArray(m.content), `assistant message ${m.uuid} should have array content`);
    }
  });
});

describe('extractMessages — isSidechain field', () => {
  it('propagates isSidechain from records', () => {
    const sidechainLine = JSON.stringify({
      ...base('sc-01'),
      isSidechain: true,
      type: 'user',
      message: { role: 'user', content: 'subagent message' },
      permissionMode: 'default',
      todos: [],
    });
    const records = parseJsonlText(sidechainLine);
    const messages = extractMessages(records);
    assert.equal(messages[0].isSidechain, true);
  });
});

// ─── Conversation Tree Tests ────────────────────────────────────────────────

describe('buildConversationTree — empty session', () => {
  it('returns an empty array for no messages', () => {
    const tree = buildConversationTree([]);
    assert.deepEqual(tree, []);
  });
});

describe('buildConversationTree — linear conversation', () => {
  const linearJsonl = [
    JSON.stringify({
      ...base('lin-u1'),
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      permissionMode: 'default',
      todos: [],
    }),
    JSON.stringify({
      ...base('lin-a1', 'lin-u1'),
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        id: 'msg_lin1',
        content: [{ type: 'text', text: 'Hi there!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
      },
    }),
    JSON.stringify({
      ...base('lin-u2', 'lin-a1'),
      type: 'user',
      message: { role: 'user', content: 'How are you?' },
      permissionMode: 'default',
      todos: [],
    }),
    JSON.stringify({
      ...base('lin-a2', 'lin-u2'),
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        id: 'msg_lin2',
        content: [{ type: 'text', text: 'Doing well!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
      },
    }),
  ].join('\n');

  const records = parseJsonlText(linearJsonl);
  const messages = extractMessages(records);
  const tree = buildConversationTree(messages);

  it('produces a single root', () => {
    assert.equal(tree.length, 1);
  });

  it('root is the first user message', () => {
    assert.equal(tree[0].message.uuid, 'lin-u1');
    assert.equal(tree[0].depth, 0);
  });

  it('forms a linear chain with correct depths', () => {
    const flat = flattenTree(tree);
    assert.deepEqual(flat.map(m => m.uuid), ['lin-u1', 'lin-a1', 'lin-u2', 'lin-a2']);
    // Check depths via tree traversal
    let node: ConversationNode = tree[0];
    assert.equal(node.depth, 0);
    assert.equal(node.children.length, 1);
    node = node.children[0]; // lin-a1
    assert.equal(node.depth, 1);
    assert.equal(node.children.length, 1);
    node = node.children[0]; // lin-u2
    assert.equal(node.depth, 2);
    assert.equal(node.children.length, 1);
    node = node.children[0]; // lin-a2
    assert.equal(node.depth, 3);
    assert.equal(node.children.length, 0);
  });
});

describe('buildConversationTree — sidechain branch', () => {
  const sidechainJsonl = [
    JSON.stringify({
      ...base('sc-u1'),
      type: 'user',
      message: { role: 'user', content: 'Main question' },
      permissionMode: 'default',
      todos: [],
    }),
    JSON.stringify({
      ...base('sc-a1', 'sc-u1'),
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        id: 'msg_sc1',
        content: [{ type: 'text', text: 'Let me think...' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
      },
    }),
    // Sidechain message branching from sc-a1
    JSON.stringify({
      ...base('sc-sub-u1', 'sc-a1'),
      isSidechain: true,
      type: 'user',
      message: { role: 'user', content: 'subagent: research this' },
      permissionMode: 'default',
      todos: [],
    }),
    JSON.stringify({
      ...base('sc-sub-a1', 'sc-sub-u1'),
      isSidechain: true,
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        id: 'msg_sub1',
        content: [{ type: 'text', text: 'Subagent result' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
      },
    }),
    // Main chain continues from sc-a1
    JSON.stringify({
      ...base('sc-u2', 'sc-a1'),
      type: 'user',
      message: { role: 'user', content: 'Follow up' },
      permissionMode: 'default',
      todos: [],
    }),
  ].join('\n');

  const records = parseJsonlText(sidechainJsonl);
  const messages = extractMessages(records);
  const tree = buildConversationTree(messages);

  it('produces a single root', () => {
    assert.equal(tree.length, 1);
  });

  it('sc-a1 has two children: main chain first, sidechain second', () => {
    const a1 = tree[0].children[0]; // sc-a1
    assert.equal(a1.message.uuid, 'sc-a1');
    assert.equal(a1.children.length, 2);
    // Main chain child first (non-sidechain)
    assert.equal(a1.children[0].message.uuid, 'sc-u2');
    assert.equal(a1.children[0].message.isSidechain, false);
    // Sidechain child second
    assert.equal(a1.children[1].message.uuid, 'sc-sub-u1');
    assert.equal(a1.children[1].message.isSidechain, true);
  });

  it('flattenTree visits main chain before sidechain', () => {
    const flat = flattenTree(tree);
    const uuids = flat.map(m => m.uuid);
    assert.deepEqual(uuids, ['sc-u1', 'sc-a1', 'sc-u2', 'sc-sub-u1', 'sc-sub-a1']);
  });
});
