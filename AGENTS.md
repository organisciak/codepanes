# Claude Code Chat

A web app that provides a polished chat UI for Claude Code running on a remote server, using SSH/Mosh + tmux as the transport layer.

## Vision

**Problem:** Claude Code CLI is powerful but the terminal UX is limiting on mobile/tablet. No easy way to access conversations from multiple devices or share context.

**Solution:** A web app that:
1. Connects to your server via SSH/Mosh
2. Interfaces with Claude Code running in a tmux session
3. Parses both the live terminal output AND the cached conversation data
4. Presents a clean, mobile-friendly chat interface

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Frontend                             │
│  (React/Vue, mobile-responsive chat UI)                     │
├─────────────────────────────────────────────────────────────┤
│                    WebSocket Server                          │
│  (Node.js, handles SSH/Mosh connections)                    │
├─────────────────────────────────────────────────────────────┤
│              SSH/Mosh Transport Layer                        │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ xterm.js /      │    │ Mosh client (via wasm or        │ │
│  │ node-pty bridge │    │ websocket proxy)                │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                Remote Server (tmux)                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ tmux session: claude-code                               ││
│  │ ┌─────────────────────────────────────────────────────┐ ││
│  │ │ Claude Code CLI                                      │ ││
│  │ │ - Interactive conversation                           │ ││
│  │ │ - File access, tool use                              │ ││
│  │ └─────────────────────────────────────────────────────┘ ││
│  │                                                          ││
│  │ Cache: ~/.claude/projects/*/...                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Data Sources

### 1. Claude Code Cache (Primary for History)
Location: `~/.claude/` on the remote server
- Contains conversation history in structured format
- Can parse to reconstruct full message history
- Gives us: timestamps, full message content, tool calls, file changes

### 2. Tmux Buffer (Primary for Live State)
- `tmux capture-pane` gives current screen
- `tmux capture-pane -S -10000` gives scrollback
- Controllable terminal size (e.g., 120x50) for predictable parsing
- Can detect: current state (waiting for input, generating, tool running)

### 3. Direct Input/Output
- Send keystrokes to tmux session
- Capture output in real-time via tmux hooks or polling

## Parsing Strategy

### Terminal State Parser
```
States to detect:
- IDLE: Waiting for user input (prompt visible)
- GENERATING: Claude is responding (streaming text)
- TOOL_RUNNING: Executing a tool (bash, file edit, etc.)
- THINKING: Extended thinking in progress
- ERROR: Error state (permission denied, rate limit, etc.)
```

### Message Extractor
- Parse cache files for historical conversations
- Parse terminal output for current/recent messages
- Merge: cache is authoritative for history, terminal for live state

## Key Technical Challenges

### 1. Web-based SSH/Mosh
Options to research:
- **xterm.js + WebSocket proxy**: Most mature (used by VS Code, etc.)
- **mosh-chrome** (now deprecated) - was a Chrome extension
- **mosh-wasm**: Community attempts exist, varying quality
- **Hybrid**: SSH via WebSocket, fall back to reconnect logic

**Current best bet:** WebSocket → SSH relay server (like wetty, ttyd, or custom)

### 2. Tmux Integration
- Fixed terminal size for predictable parsing
- Named session management
- Capture-pane for screen scraping
- Send-keys for input injection

### 3. Claude Code Output Parsing
The terminal output includes:
- ANSI escape codes (colors, cursor movement)
- Unicode (box drawing, emoji)
- Streaming text with overwrites
- Tool output blocks

Need a robust parser that can:
- Strip ANSI while preserving structure
- Detect message boundaries
- Handle multi-turn context

## Tech Stack (Proposed)

### Frontend
- **Framework**: React or Vue 3
- **UI**: Tailwind CSS + custom chat components
- **Terminal**: xterm.js (for raw mode if needed)
- **State**: Zustand or Pinia
- **PWA**: Service worker for offline/mobile

### Backend
- **Runtime**: Node.js or Bun
- **SSH**: ssh2 library
- **WebSocket**: ws or Socket.io
- **Process**: node-pty for terminal emulation

### Infrastructure
- Self-hosted (the whole point is using YOUR server)
- Optional: Cloudflare Tunnel for HTTPS without port forwarding

## MVP Features

### Phase 1: Basic Chat Interface
- [ ] WebSocket SSH connection
- [ ] Tmux session creation/attachment
- [ ] Basic terminal parsing (detect prompt, capture output)
- [ ] Chat UI: show messages, send input
- [ ] State indicator (idle/generating/tool)

### Phase 2: History Integration
- [ ] Parse Claude Code cache files
- [ ] Display conversation history
- [ ] Search past conversations
- [ ] Continue previous sessions

### Phase 3: Enhanced UX
- [ ] Mobile-optimized responsive design
- [ ] Syntax highlighting in code blocks
- [ ] File diff viewer for edits
- [ ] Tool call visualization
- [ ] Image/screenshot support

### Phase 4: Advanced Features
- [ ] Multiple server connections
- [ ] Session management (new/resume/archive)
- [ ] Notifications (via service worker)
- [ ] Export conversations
- [ ] Collaborative viewing (read-only share)

## Research Needed

1. **Claude Code cache format**: Document the exact structure of ~/.claude/
2. **Mosh WebSocket feasibility**: Test existing mosh-wasm projects
3. **Terminal parsing libraries**: Evaluate xterm.js parser, strip-ansi, etc.
4. **PWA capabilities**: Can we do background reconnection?

## Security Considerations

- SSH keys stored client-side (browser storage) or via passthrough
- Consider SSH agent forwarding
- HTTPS mandatory for production
- No server-side credential storage (stateless relay)
- Optional: TOTP/passkey for additional auth

## Directory Structure (Planned)

```
claude-code-chat/
├── frontend/           # React/Vue app
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallCard.tsx
│   │   │   └── StatusIndicator.tsx
│   │   ├── hooks/
│   │   │   ├── useSSH.ts
│   │   │   ├── useTmux.ts
│   │   │   └── useClaudeParser.ts
│   │   └── lib/
│   │       ├── terminal-parser.ts
│   │       └── cache-reader.ts
│   └── ...
├── backend/            # WebSocket relay server
│   ├── src/
│   │   ├── ssh-handler.ts
│   │   ├── tmux-controller.ts
│   │   └── message-parser.ts
│   └── ...
├── docs/               # Research notes, API docs
└── scripts/            # Dev utilities
```

## Commands

### Package manager preference
Prefer **pnpm** for this repo (it’s significantly faster for installs), except for truly global one-off installs.

```bash
# Development
pnpm run dev          # Start both frontend and backend
pnpm run frontend     # Frontend only
pnpm run backend      # Backend only

# Testing
pnpm test             # Run tests
pnpm run e2e          # End-to-end tests

# Build
pnpm run build        # Production build
```

## Related Projects / Inspiration

- **ttyd**: Terminal over WebSocket
- **wetty**: Web-based terminal emulator
- **code-server**: VS Code in browser (for architecture reference)
- **mosh**: Mobile shell (UDP-based, handles latency/roaming)
- **Claude Code**: The CLI we're wrapping

## Open Questions

1. Should we support multiple concurrent Claude Code sessions?
2. Is there value in a "spectator mode" for watching agent runs?
3. How to handle reconnection gracefully (mosh-like)?
4. Should the relay server be separate from the target server?

---

## Links

- **Notion:** https://www.notion.so/Claude-Code-Chat-31274c92778881809c71fe69c3d9740f

## Cache Format Research

Researched on 2026-02-24 by exploring `~/.claude/` on a live machine.

### Directory Structure

```
~/.claude/
├── projects/                          # Per-project conversation storage
│   └── <path-encoded-dir>/            # Dir path with / replaced by -
│       ├── sessions-index.json        # {"version":1, "entries":[], "originalPath":"/..."}
│       ├── <session-uuid>.jsonl       # Main conversation log (JSONL)
│       └── <session-uuid>/            # Optional session subdirectory
│           └── subagents/
│               └── agent-<shortid>.jsonl  # Subagent conversation logs
├── file-history/                      # Pre/post-edit file snapshots
│   └── <session-uuid>/
│       └── <file-hash>@v<N>          # File content at version N
├── history.jsonl                      # Global cross-session input history
├── todos/                             # Per-session todo lists (JSON arrays)
│   └── <session-uuid>-agent-<id>.json
├── debug/                             # Per-session debug logs (.txt)
├── plans/                             # Plan files from /plan mode
├── stats-cache.json                   # Usage stats cache
├── cache/                             # Misc cache (changelog.md, etc.)
└── settings.json                      # Global settings
```

**Path encoding**: `/Users/organisciak/projects/foo` → `-Users-organisciak-projects-foo`

### JSONL Session Format

Each `<session-uuid>.jsonl` file contains one JSON object per line. Every record shares these common fields:

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | string | Unique ID for this record |
| `parentUuid` | string\|null | UUID of parent message (forms a tree) |
| `sessionId` | string | UUID of the session this belongs to |
| `type` | string | Message type (see below) |
| `timestamp` | ISO8601 | When this record was created |
| `isSidechain` | bool | True for subagent messages |
| `userType` | string | Always "external" for human users |
| `cwd` | string | Working directory at time of message |
| `version` | string | Claude Code version (e.g. "2.1.55") |
| `gitBranch` | string | Git branch if in a repo |

### Message Types

#### `user` — Human turn
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "How do I relink Whatsapp?"  // string for plain text
    // OR content: [{...}]  // array for tool results
  },
  "thinkingMetadata": {"maxThinkingTokens": 31999},  // if extended thinking enabled
  "todos": [],         // current todo list state
  "permissionMode": "default"
}
```

When content is an array, items are tool results:
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC...",
  "is_error": false,
  "content": "ls output here..."  // string or array of content blocks
}
```

#### `assistant` — Claude turn
```json
{
  "type": "assistant",
  "requestId": "req_01ABC...",
  "message": {
    "model": "claude-sonnet-4-6",
    "id": "msg_01ABC...",
    "role": "assistant",
    "content": [
      // Array of content blocks:
      {"type": "thinking", "thinking": "...", "signature": "..."},
      {"type": "text", "text": "..."},
      {
        "type": "tool_use",
        "id": "toolu_01ABC...",
        "name": "Bash",
        "input": {"command": "ls -la", "description": "..."}
      }
    ],
    "stop_reason": "tool_use" | "end_turn" | null,
    "usage": {
      "input_tokens": 10,
      "cache_creation_input_tokens": 12,
      "cache_read_input_tokens": 17881,
      "output_tokens": 150,
      "service_tier": "standard"
    }
  }
}
```

#### `system` — System/command events
```json
{
  "type": "system",
  "subtype": "local_command",
  "content": "<command-name>/resume</command-name>...",
  "level": "info"
}
```

#### `progress` — Hook/tool progress events
```json
{
  "type": "progress",
  "slug": "cozy-growing-creek",  // human-readable session slug
  "data": "{'type': 'hook_progress', 'hookEvent': 'PostToolUse', ...}",
  "parentToolUseID": "toolu_01ABC...",
  "toolUseID": "toolu_01ABC..."
}
```

#### `file-history-snapshot` — File state snapshot
```json
{
  "type": "file-history-snapshot",
  "messageId": "<uuid>",
  "isSnapshotUpdate": false,
  "snapshot": {
    "messageId": "<uuid>",
    "timestamp": "2026-02-11T15:23:26.221Z",
    "trackedFileBackups": {
      "/path/to/file.py": { /* backup metadata */ }
    }
  }
}
```

### Subagent Files

Subagent conversations are stored separately in `<session-uuid>/subagents/agent-<shortid>.jsonl`.
Records have the same format but include `agentId` and `slug` fields.

### Global History

`~/.claude/history.jsonl` — command history across all sessions:
```json
{"display": "How do I...", "pastedContents": {}, "timestamp": 1769994715193, "project": "<path>", "sessionId": "<uuid>"}
```

### Key Implications for Parsing

1. **Message tree**: `parentUuid` links form a conversation tree, not just a flat list. Branch detection requires traversal.
2. **Tool flow**: `tool_use` in an assistant message → matched by `tool_use_id` in subsequent user message `tool_result`
3. **Streaming**: The `stop_reason: null` records are intermediate streaming states; final message has `stop_reason: "end_turn"` or `"tool_use"`
4. **File changes**: Cross-reference `file-history-snapshot` with `~/.claude/file-history/` for actual file diffs
5. **Cache is authoritative**: More structured than terminal scraping; prefer it for history reconstruction

---

## Web SSH Research

Researched on 2026-02-24. Goal: determine best transport for browser → remote SSH → tmux → Claude Code.

### Option 1: xterm.js + WebSocket Proxy (RECOMMENDED)

**How it works:**
```
Browser (xterm.js) <──WebSocket──> Relay Server (Node.js)
                                         │
                                    ssh2 library
                                         │
                                   Remote SSH Server
                                         │
                                    tmux session
```

- **Frontend**: xterm.js renders terminal UI, captures keystrokes, emits via WebSocket
- **Backend**: Node.js relay uses `ssh2` npm library to open SSH connection to remote
- **PTY bridge**: `node-pty` (on local relay) or pass-through via SSH to remote pty
- **Data flow**: keystrokes → WS → relay → SSH → remote shell; output flows back same path

**Pros:**
- Battle-tested: used by VS Code Remote, Theia, many cloud IDEs
- xterm.js is actively maintained (Microsoft sponsorship), great ANSI/VT100 support
- `ssh2` npm library is pure JS, no native compilation needed for SSH layer
- Full programmatic access to output stream — can intercept/parse before xterm.js renders
- Supports resize events (`SIGWINCH`), binary data, SSH auth (password, key, agent)

**Cons:**
- `node-pty` requires native compilation (node-gyp), can be tricky in some environments
- No UDP/roaming — TCP connection drops on network change (unlike mosh)
- Need to manage reconnection logic manually

**Key libraries:**
- [`@xterm/xterm`](https://www.npmjs.com/package/@xterm/xterm) v5.5.0 — frontend terminal emulator (note: old `xterm` npm package is deprecated, use scoped `@xterm/*`)
- [`ssh2`](https://www.npmjs.com/package/ssh2) v1.17.0 — Node.js SSH client (pure JS, no native deps)
- [`node-pty`](https://www.npmjs.com/package/node-pty) v1.1.0 — pseudo-terminal (Microsoft-maintained, native module; only needed if process is local)
- [`ws`](https://www.npmjs.com/package/ws) — WebSocket server

**Reference implementations:** [webssh2](https://github.com/billchurch/webssh2) (billchurch, TypeScript, 2.6k stars, updated 2025 — best reference), wetty, VS Code Remote

---

### Option 2: mosh-wasm (NOT FEASIBLE)

**Status: Dead end.** No viable WASM port of mosh exists for browsers.

- **mosh-chrome** (rpwoodbu) used Chrome Native Client (NaCl/PNaCl) — deprecated since Chrome removed NaCl support
- Mosh requires **UDP** which browsers don't expose (only TCP via WebSocket)
- No active WASM compilation of mosh C++ codebase exists as of 2026
- The UDP requirement is fundamental to mosh's roaming/latency features — can't be shimmed over WebSocket

**Verdict:** Skip mosh entirely. Implement WebSocket reconnection logic to approximate mosh-like resilience.

---

### Option 3: ttyd (Good reference, not directly usable)

**What it is:** C binary that shares any terminal command over the web via WebSocket. Built on libwebsockets + libuv, serves xterm.js frontend.

```bash
ttyd -p 7681 tmux attach -t claude-code  # Exposes tmux session in browser
```

**Pros:**
- Extremely fast (C implementation, minimal overhead)
- Production-ready: SSL, basic auth, Sixel image support, ZMODEM
- Cross-platform (Linux, macOS, BSD, Windows)
- Simple deployment: single binary, just point at any command

**Cons:**
- C binary must be installed on the remote server
- No programmatic output interception — it's a passthrough terminal
- Can't add custom parsing/chat UI layer without forking
- Not easily embeddable in a Node.js app

**Use as:** Inspiration for protocol design. Could use ttyd as a quick demo/fallback, but build custom for the actual product.

---

### Option 4: wetty (Good reference, partial overlap)

**What it is:** Node.js web terminal over HTTP/HTTPS. Uses xterm.js + WebSocket + SSH connection.

```bash
npm -g i wetty
wetty --ssh-host myserver.com --ssh-user alice -p 3000
```

**Pros:**
- Pure Node.js — no C compilation required
- SSH built-in: can connect to remote via SSH host/port/user flags
- Docker image available (`wettyoss/wetty`)
- Good reference for Node.js SSH+WebSocket architecture

**Cons:**
- Designed as a standalone app, not as a library
- Limited active maintenance on main repo (many forks)
- Generic terminal passthrough — no Claude-specific parsing
- No programmatic output access for chat UI layer

**Use as:** Architecture reference. Study `butlerx/wetty` source for SSH+xterm.js integration patterns.

---

### Other Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **gotty** (sorenisanerd/gotty) | Go binary, shares terminal as web app (yudai/gotty abandoned; sorenisanerd fork active, v1.6.0) | Similar to ttyd; Go binary required on server |
| **webssh2** (billchurch) | Node.js: ssh2 + socket.io + xterm.js | Best direct reference for custom build |
| **Cloudflare Tunnel** | HTTPS without port forwarding | Infrastructure layer, not terminal protocol |
| **node-pty local** | PTY on relay, SSH via node | Useful if relay is on same host as target |

---

### Key Architectural Insight: tmux Control Mode

Instead of parsing raw ANSI/VT100 sequences from tmux output, use **tmux control mode** (`tmux -CC attach`). This gives structured events:

```
%begin 1234567890 1 0
%output %0 \033[...raw screen data...\033[m
%end 1234567890 1 0
```

Each `%output` event is tagged with the pane ID and contains exactly what the application sent to that pane. This separates "what Claude Code printed" from "tmux decoration" without regex-scraping escape codes. iTerm2 uses this protocol for native tmux integration.

For the chat UI:
- Feed the raw bytes to xterm.js for display (handles ANSI normally)
- Process the same bytes server-side via `stream.on('data')` for programmatic parsing
- Use control mode events to know pane boundaries and timestamps

---

### Recommendation

**Build a custom Node.js/Bun relay** using:

1. **`ssh2`** — SSH connection from relay to remote server (no native deps)
2. **`ws`** — WebSocket for browser ↔ relay (prefer over socket.io for simplicity)
3. **`@xterm/xterm`** — Frontend terminal emulator
4. **Custom output interceptor** — Tap the SSH data stream before passing to xterm.js
5. **tmux control mode (`-CC`)** — Structured output events instead of raw ANSI parsing

Study **webssh2** (billchurch/webssh2) as the closest reference implementation. Study **ttyd**'s flow control (PAUSE/RESUME messages) to prevent buffer overflow on high-throughput output.

---

## Session Log

- 2026-02-24: Project created, initial planning complete
- 2026-02-25: Research complete — cache format documented, web SSH options evaluated
