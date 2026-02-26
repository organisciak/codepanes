# tmux Control Mode (-CC) Evaluation

## What is Control Mode?

tmux control mode (`tmux -CC`) is a machine-oriented interface to tmux. Instead of drawing
a terminal UI, tmux sends structured text events on stdout and accepts commands on stdin.
Originally designed for iTerm2's native tmux integration.

### How to attach

```bash
tmux -CC attach-session -t mysession
```

Or create + attach:

```bash
tmux -CC new-session -s mysession
```

When attached in control mode, tmux stops drawing its own status bar and pane borders.
Instead, it emits line-based events prefixed with `%`.

## Event Format

All events are single lines starting with `%`:

### `%output <pane-id> <data>`
Raw output from a pane. `<pane-id>` is e.g. `%0`, `%1`.
`<data>` contains the raw bytes the application wrote, with non-printable bytes
octal-escaped (`\033` for ESC, etc).

```
%output %0 \033[1;32mhello\033[0m\r\n
```

### `%begin <timestamp> <number> <flags>`
Start of a command response block. Sent when tmux begins processing a command
sent on stdin.

```
%begin 1709123456 1 0
```

### `%end <timestamp> <number> <flags>`
End of a command response block (success).

```
%end 1709123456 1 0
```

### `%error <timestamp> <number> <flags>`
End of a command response block (error).

### `%session-changed <session-id> <session-name>`
Active session changed.

### `%session-renamed <new-name>`
Session was renamed.

### `%sessions-changed`
Session list changed (created/destroyed).

### `%window-add <window-id>`
### `%window-close <window-id>`
### `%window-renamed <window-id> <new-name>`
Window lifecycle events.

### `%layout-change <window-id> <layout>`
Pane layout within a window changed.

### `%pane-mode-changed <pane-id>`
Pane entered/exited copy mode or similar.

### `%exit [reason]`
tmux is exiting control mode (detach or server kill).

## Sending Commands

Commands are sent as plain text lines on stdin. Any tmux command works:

```
send-keys -t %0 "hello" Enter
resize-window -t @0 -x 120 -y 50
list-panes -F '#{pane_id} #{pane_width} #{pane_height}'
```

Responses arrive between `%begin` and `%end`/`%error` markers.

## Pros vs Raw Terminal Capture

| Aspect | Control Mode (-CC) | Raw SSH Stream |
|--------|--------------------|----------------|
| **Output source** | `%output` events tagged per-pane | Single byte stream, panes mixed |
| **Pane isolation** | Each pane's output is separate | Must use xterm.js to track pane state |
| **Latency** | Same as raw — no extra buffering | Direct from PTY |
| **Overhead** | Minimal — line parsing only | None (raw passthrough) |
| **xterm.js compat** | YES — `%output` data is raw ANSI, feed directly | YES — native input |
| **Structured events** | Window/session lifecycle, layout | None (must infer from ANSI) |
| **Multiple panes** | Trivially separated | Must emulate full terminal |
| **Reconnection** | Can re-attach cleanly | Lose screen state |
| **Complexity** | Must parse `%output` framing | Simpler initial setup |
| **Maturity** | Used by iTerm2 for years | Universal |

## Latency Implications

Control mode adds no measurable latency. The `%output` events are emitted in real-time
as the application writes to the PTY. The only overhead is string-framing each chunk
with the `%output %N ` prefix and octal-escaping non-printable bytes.

In testing, control mode is functionally equivalent to raw capture for latency purposes.

## xterm.js Compatibility

The raw data inside `%output` events is standard terminal output (ANSI escape sequences,
UTF-8 text, cursor movement, etc). After extracting the payload and unescaping octal
sequences, it can be fed directly to `xterm.js` via `terminal.write(data)`.

Steps:
1. Parse the `%output %N <data>` line
2. Unescape octal sequences (`\033` -> ESC, `\015` -> CR, etc)
3. Feed unescaped bytes to xterm.js

This is exactly what iTerm2 does under the hood.

## Recommendation

**Use raw SSH stream for MVP, with control mode as a future enhancement.**

Rationale:

1. **Simpler initial path**: The raw stream already works with xterm.js. Adding control
   mode parsing is an extra layer that doesn't solve an immediate problem.

2. **State parsing works either way**: Our `TerminalStateParser` processes raw terminal
   bytes. It works identically whether those bytes come from `%output` events or the
   raw SSH stream.

3. **Control mode shines for multi-pane**: If we later need to support multiple tmux
   panes (e.g., split views, separate Claude Code instances), control mode makes pane
   isolation trivial.

4. **Reconnection benefit**: Control mode's structured events (session/window lifecycle)
   would help with reconnection logic — knowing exactly when sessions die vs when
   connections drop.

5. **Prototype included**: The `ControlModeParser` class below is ready to integrate
   when the time comes.

### When to switch to control mode

- When we add multi-pane support
- When we need structured session lifecycle events
- When reconnection robustness becomes a priority

The `ControlModeParser` is implemented and tested so adoption is low-friction.
