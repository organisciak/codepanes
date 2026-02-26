# Codepanes

Web interface for pairing with AI coding agents (Claude Code, etc.) over SSH/tmux — observe, chat, and collaborate in real time.

## What is this?

Codepanes gives you a split-pane web UI to watch and interact with AI coding agents running in remote tmux sessions. Connect from any browser, including mobile, without needing a local terminal.

```
Browser (React + xterm.js)
    ↕ WebSocket
Node.js relay (ssh2)
    ↕ SSH
Remote server → tmux → AI coding agent
```

## Quick start

```bash
# Install dependencies
cd frontend && pnpm install
cd ../backend && pnpm install

# Run both (or use atmux)
cd frontend && pnpm dev    # http://localhost:5183
cd backend && pnpm dev     # ws://localhost:3005
```

## Project structure

```
codepanes/
├── frontend/    # React + Vite + Tailwind chat UI
├── backend/     # WebSocket ↔ SSH relay server
└── shared/      # JSONL parser, terminal state parser, shared types
```

## Status

Early development. See [AGENTS.md](./AGENTS.md) for architecture details, research notes, and roadmap.

## License

TBD
