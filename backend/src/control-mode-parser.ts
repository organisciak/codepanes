/**
 * tmux control mode (-CC) event parser.
 *
 * Parses the line-based event protocol emitted by `tmux -CC attach`.
 * Each event is a single line starting with `%`.
 *
 * Usage:
 *   const event = parseControlLine("%output %0 hello\\033[m");
 *   // { type: 'output', paneId: '%0', data: 'hello\x1b[m' }
 *
 *   // Or as a transform stream:
 *   sshStream.pipe(new ControlModeParser()).on('event', (e) => { ... });
 */

import { Transform, TransformCallback } from "stream";

// ── Types ────────────────────────────────────────────────────────────────────

export type ControlEvent =
  | { type: "output"; paneId: string; data: string }
  | { type: "begin"; timestamp: number; number: number; flags: number }
  | { type: "end"; timestamp: number; number: number; flags: number }
  | { type: "error"; timestamp: number; number: number; flags: number }
  | { type: "session-changed"; sessionId: string; sessionName: string }
  | { type: "window-add"; windowId: string }
  | { type: "window-close"; windowId: string }
  | { type: "exit"; reason: string }
  | { type: "unknown"; line: string };

// ── Line parser ──────────────────────────────────────────────────────────────

/**
 * Unescape octal escape sequences in tmux control mode output.
 * e.g. \033 -> ESC (0x1B), \015 -> CR, \012 -> LF
 */
function unescapeOctal(s: string): string {
  return s.replace(/\\(\d{3})/g, (_, oct: string) =>
    String.fromCharCode(parseInt(oct, 8))
  );
}

/**
 * Parse a single line of tmux -CC output into a ControlEvent.
 *
 * Lines that don't start with `%` are either command responses
 * (between %begin/%end) or noise — returned as `unknown`.
 */
export function parseControlLine(line: string): ControlEvent {
  if (!line.startsWith("%")) {
    return { type: "unknown", line };
  }

  // %output %<paneId> <data>
  const outputMatch = line.match(/^%output (%\d+) (.*)$/);
  if (outputMatch) {
    return {
      type: "output",
      paneId: outputMatch[1],
      data: unescapeOctal(outputMatch[2]),
    };
  }

  // %begin <timestamp> <number> <flags>
  const beginMatch = line.match(/^%begin (\d+) (\d+) (\d+)$/);
  if (beginMatch) {
    return {
      type: "begin",
      timestamp: parseInt(beginMatch[1], 10),
      number: parseInt(beginMatch[2], 10),
      flags: parseInt(beginMatch[3], 10),
    };
  }

  // %end <timestamp> <number> <flags>
  const endMatch = line.match(/^%end (\d+) (\d+) (\d+)$/);
  if (endMatch) {
    return {
      type: "end",
      timestamp: parseInt(endMatch[1], 10),
      number: parseInt(endMatch[2], 10),
      flags: parseInt(endMatch[3], 10),
    };
  }

  // %error <timestamp> <number> <flags>
  const errorMatch = line.match(/^%error (\d+) (\d+) (\d+)$/);
  if (errorMatch) {
    return {
      type: "error",
      timestamp: parseInt(errorMatch[1], 10),
      number: parseInt(errorMatch[2], 10),
      flags: parseInt(errorMatch[3], 10),
    };
  }

  // %session-changed $<id> <name>
  const sessionMatch = line.match(/^%session-changed \$(\d+) (.+)$/);
  if (sessionMatch) {
    return {
      type: "session-changed",
      sessionId: sessionMatch[1],
      sessionName: sessionMatch[2],
    };
  }

  // %window-add @<id>
  const windowAddMatch = line.match(/^%window-add (@\d+)$/);
  if (windowAddMatch) {
    return { type: "window-add", windowId: windowAddMatch[1] };
  }

  // %window-close @<id>
  const windowCloseMatch = line.match(/^%window-close (@\d+)$/);
  if (windowCloseMatch) {
    return { type: "window-close", windowId: windowCloseMatch[1] };
  }

  // %exit [reason]
  const exitMatch = line.match(/^%exit\s*(.*)$/);
  if (exitMatch) {
    return { type: "exit", reason: exitMatch[1] || "" };
  }

  return { type: "unknown", line };
}

// ── Transform stream ─────────────────────────────────────────────────────────

/**
 * Transform stream that buffers incoming bytes into lines and
 * emits a parsed `ControlEvent` for each complete line.
 *
 * Events are emitted as `'event'` events on the stream.
 */
export class ControlModeParser extends Transform {
  private buffer = "";

  constructor() {
    super({ readableObjectMode: true });
  }

  _transform(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.length > 0) {
        const event = parseControlLine(line);
        this.emit("event", event);
        this.push(event);
      }
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.trim().length > 0) {
      const event = parseControlLine(this.buffer.trim());
      this.emit("event", event);
      this.push(event);
    }
    this.buffer = "";
    callback();
  }
}
