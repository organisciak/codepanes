"use strict";
/**
 * Terminal state parser for Claude Code output.
 *
 * Processes raw terminal bytes (including ANSI escape sequences) and
 * infers Claude Code's current operational state by analyzing visible
 * text patterns.
 *
 * Usage:
 *   const parser = new TerminalStateParser();
 *   sshStream.on('data', (chunk) => parser.feed(chunk));
 *   parser.on('stateChange', (state) => console.log('State:', state));
 *   console.log(parser.getState());
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalStateParser = void 0;
const events_1 = require("events");
// ── ANSI stripping ───────────────────────────────────────────────────────────
// Matches ANSI escape sequences: CSI (ESC[...), OSC (ESC]...), and simple ESC sequences
const ANSI_RE = 
// eslint-disable-next-line no-control-regex
/[\u001b\u009b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|[\u001b\u009b]\].*?(?:\u0007|\u001b\\)|[\u001b\u009b][^[\]].?/g;
function stripAnsi(s) {
    return s.replace(ANSI_RE, "");
}
// ── Tool name patterns ───────────────────────────────────────────────────────
const TOOL_PATTERNS = [
    { pattern: /⏵\s*Bash\(/, name: "Bash" },
    { pattern: /⏵\s*Write\(/, name: "Write" },
    { pattern: /⏵\s*Edit\(/, name: "Edit" },
    { pattern: /⏵\s*Read\(/, name: "Read" },
    { pattern: /⏵\s*Glob\(/, name: "Glob" },
    { pattern: /⏵\s*Grep\(/, name: "Grep" },
    { pattern: /⏵\s*WebFetch\(/, name: "WebFetch" },
    { pattern: /⏵\s*WebSearch\(/, name: "WebSearch" },
    { pattern: /⏵\s*TodoWrite\(/, name: "TodoWrite" },
    { pattern: /⏵\s*NotebookEdit\(/, name: "NotebookEdit" },
    { pattern: /⏵\s*(\w+)\(/, name: "$1" },
];
// ── State detection ──────────────────────────────────────────────────────────
/** Maximum lines to keep in the rolling buffer */
const MAX_BUFFER_LINES = 50;
/**
 * Debounce interval for state inference (ms).
 * Prevents thrashing during rapid streaming output.
 */
const DEBOUNCE_MS = 50;
/**
 * Stateful parser that processes a stream of terminal bytes
 * and infers Claude Code's current state.
 *
 * Feed raw terminal bytes (with ANSI codes) to `.feed(chunk)`.
 * Query current state with `.getState()`.
 * Listen to `'stateChange'` events for real-time updates.
 */
class TerminalStateParser extends events_1.EventEmitter {
    lines = [];
    currentState = { status: "unknown" };
    cols;
    rows;
    debounceTimer = null;
    pendingChunks = "";
    constructor(options) {
        super();
        this.cols = options?.cols ?? 120;
        this.rows = options?.rows ?? 50;
    }
    /** Feed raw terminal bytes (may contain ANSI codes) */
    feed(chunk) {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        this.pendingChunks += text;
        // Debounce state inference to avoid thrashing during rapid output
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this._processPending();
        }, DEBOUNCE_MS);
    }
    /** Get current inferred state */
    getState() {
        // Process any pending chunks immediately for synchronous reads
        if (this.pendingChunks.length > 0) {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            this._processPending();
        }
        return this.currentState;
    }
    /** Get the last N lines of visible terminal text (ANSI stripped) */
    getLines(n) {
        if (n === undefined)
            return [...this.lines];
        return this.lines.slice(-n);
    }
    /** Reset internal state */
    reset() {
        this.lines = [];
        this.pendingChunks = "";
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this._setState({ status: "unknown" });
    }
    // ── Private ─────────────────────────────────────────────────────────────────
    _processPending() {
        const raw = this.pendingChunks;
        this.pendingChunks = "";
        this.debounceTimer = null;
        // Strip ANSI codes and split into lines
        const clean = stripAnsi(raw);
        const newLines = clean.split(/\r?\n/);
        // Append to rolling buffer
        this.lines.push(...newLines);
        // Trim buffer to max size
        if (this.lines.length > MAX_BUFFER_LINES) {
            this.lines = this.lines.slice(-MAX_BUFFER_LINES);
        }
        // Infer state from current buffer
        this._inferState();
    }
    _inferState() {
        const state = this._detectState();
        this._setState(state);
    }
    _detectState() {
        // Work with the visible lines (last `rows` lines)
        const visible = this.lines.slice(-this.rows);
        if (visible.length === 0)
            return { status: "unknown" };
        // Get the last non-empty line for prompt detection
        const lastNonEmpty = this._lastNonEmptyLine(visible);
        const allText = visible.join("\n");
        // 1. Error detection (highest priority — errors should not be missed)
        const errorState = this._detectError(allText);
        if (errorState)
            return errorState;
        // 2. Tool running detection
        const toolState = this._detectToolRunning(allText);
        if (toolState)
            return toolState;
        // 3. Thinking detection
        if (this._detectThinking(allText)) {
            return { status: "thinking" };
        }
        // 4. Idle detection (prompt visible)
        if (this._detectIdle(lastNonEmpty)) {
            return { status: "idle" };
        }
        // 5. If we were previously idle and now text is appearing, we're generating
        if (this.currentState.status === "idle" || this.currentState.status === "unknown") {
            // Not idle, not tool, not thinking, not error — likely generating
            // But only if there's meaningful content
            if (allText.trim().length > 0) {
                return { status: "generating" };
            }
        }
        // 6. If we were previously generating, stay generating unless something else matched
        if (this.currentState.status === "generating") {
            return { status: "generating" };
        }
        return { status: "unknown" };
    }
    _detectIdle(lastNonEmpty) {
        if (!lastNonEmpty)
            return false;
        const trimmed = lastNonEmpty.trimEnd();
        // Prompt patterns: "> ", "? ", or just ">" at end of line
        return /(?:^|\s)[>?]\s*$/.test(trimmed) || /^\s*>\s*$/.test(trimmed);
    }
    _detectToolRunning(text) {
        // Check for tool invocation patterns
        for (const { pattern, name } of TOOL_PATTERNS) {
            const match = text.match(pattern);
            if (match) {
                const toolName = name === "$1" && match[1] ? match[1] : name;
                return { status: "tool_running", toolName };
            }
        }
        // Generic "Running..." or "Executing" patterns
        if (/\bRunning\.\.\./i.test(text) || /\bExecuting\b/i.test(text)) {
            return { status: "tool_running" };
        }
        return null;
    }
    _detectThinking(text) {
        // "Thinking..." text or spinner indicators
        return /\bThinking\.\.\./i.test(text) || /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(text);
    }
    _detectError(text) {
        // Match common error patterns
        const errorPatterns = [
            { re: /\bError:\s*(.{1,100})/, extract: true },
            { re: /\brate limit/i, msg: "Rate limited" },
            { re: /\bpermission denied/i, msg: "Permission denied" },
            { re: /\bAPIError/i, extract: true },
            { re: /\bOverloaded/i, msg: "API overloaded" },
        ];
        for (const { re, extract, msg } of errorPatterns) {
            const match = text.match(re);
            if (match) {
                const message = extract ? match[1]?.trim() || match[0] : msg;
                return { status: "error", message };
            }
        }
        return null;
    }
    _lastNonEmptyLine(lines) {
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().length > 0)
                return lines[i];
        }
        return "";
    }
    _setState(newState) {
        if (newState.status !== this.currentState.status ||
            (newState.status === "tool_running" &&
                this.currentState.status === "tool_running" &&
                newState.toolName !==
                    this.currentState.toolName) ||
            (newState.status === "error" &&
                this.currentState.status === "error" &&
                newState.message !==
                    this.currentState.message)) {
            this.currentState = newState;
            this.emit("stateChange", newState);
        }
    }
}
exports.TerminalStateParser = TerminalStateParser;
//# sourceMappingURL=state-parser.js.map