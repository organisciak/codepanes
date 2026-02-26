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
import { EventEmitter } from "events";
export type ClaudeState = {
    status: "idle";
} | {
    status: "generating";
} | {
    status: "tool_running";
    toolName?: string;
} | {
    status: "thinking";
} | {
    status: "error";
    message?: string;
} | {
    status: "unknown";
};
export interface StateParserOptions {
    /** Width of the virtual terminal (default 120) */
    cols?: number;
    /** Height of the virtual terminal (default 50) */
    rows?: number;
}
/**
 * Stateful parser that processes a stream of terminal bytes
 * and infers Claude Code's current state.
 *
 * Feed raw terminal bytes (with ANSI codes) to `.feed(chunk)`.
 * Query current state with `.getState()`.
 * Listen to `'stateChange'` events for real-time updates.
 */
export declare class TerminalStateParser extends EventEmitter {
    private lines;
    private currentState;
    private cols;
    private rows;
    private debounceTimer;
    private pendingChunks;
    constructor(options?: StateParserOptions);
    /** Feed raw terminal bytes (may contain ANSI codes) */
    feed(chunk: Buffer | string): void;
    /** Get current inferred state */
    getState(): ClaudeState;
    /** Get the last N lines of visible terminal text (ANSI stripped) */
    getLines(n?: number): string[];
    /** Reset internal state */
    reset(): void;
    private _processPending;
    private _inferState;
    private _detectState;
    private _detectIdle;
    private _detectToolRunning;
    private _detectThinking;
    private _detectError;
    private _lastNonEmptyLine;
    private _setState;
}
