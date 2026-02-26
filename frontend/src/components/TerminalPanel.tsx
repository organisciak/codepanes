import { clsx } from 'clsx';
import { useTerminal, type ConnectionState, type ClaudeState } from '../hooks/useTerminal';
import { SSHConnectForm } from './SSHConnectForm';

// ─── Claude state badge ──────────────────────────────────────────────────────

const CLAUDE_STATE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  idle:         { label: 'IDLE',         color: 'text-emerald-300', bg: 'bg-emerald-950/60' },
  generating:   { label: 'GENERATING',   color: 'text-violet-300',  bg: 'bg-violet-950/60' },
  tool_running: { label: 'TOOL RUNNING', color: 'text-amber-300',   bg: 'bg-amber-950/60' },
  thinking:     { label: 'THINKING',     color: 'text-cyan-300',    bg: 'bg-cyan-950/60' },
  error:        { label: 'ERROR',        color: 'text-red-300',     bg: 'bg-red-950/60' },
  unknown:      { label: 'UNKNOWN',      color: 'text-slate-300',   bg: 'bg-slate-800/60' },
};

function ClaudeStateBadge({ state }: { state: ClaudeState }) {
  const cfg = CLAUDE_STATE_STYLES[state.status] ?? CLAUDE_STATE_STYLES.unknown;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide',
        cfg.color,
        cfg.bg,
      )}
      role="status"
      aria-label={`Claude: ${cfg.label}`}
    >
      {cfg.label}
      {state.toolName && (
        <span className="font-normal opacity-80">({state.toolName})</span>
      )}
    </span>
  );
}

// ─── Connection state indicator ──────────────────────────────────────────────

const CONNECTION_STYLES: Record<ConnectionState, { label: string; dot: string }> = {
  disconnected: { label: 'Disconnected', dot: 'bg-slate-500' },
  connecting:   { label: 'Connecting...', dot: 'bg-amber-400 animate-pulse' },
  connected:    { label: 'Connected', dot: 'bg-emerald-400' },
  error:        { label: 'Error', dot: 'bg-red-400' },
};

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const cfg = CONNECTION_STYLES[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className={clsx('size-2 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── TerminalPanel ───────────────────────────────────────────────────────────

interface TerminalPanelProps {
  className?: string;
}

export function TerminalPanel({ className }: TerminalPanelProps) {
  const { terminalRef, connectionState, claudeState, connect, disconnect } = useTerminal();

  const isConnected = connectionState === 'connected';

  return (
    <div className={clsx('flex flex-col h-full bg-[#1e1e1e] rounded-xl overflow-hidden border border-slate-700/30', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-300">Terminal</span>
          <ConnectionBadge state={connectionState} />
        </div>
        <div className="flex items-center gap-2">
          {claudeState && <ClaudeStateBadge state={claudeState} />}
          {isConnected && (
            <button
              onClick={disconnect}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                'text-slate-400 hover:text-red-300 hover:bg-red-950/40',
              )}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Terminal or connect form */}
      <div className="flex-1 relative min-h-0">
        {/* xterm.js container - always mounted so the terminal stays alive */}
        <div
          ref={terminalRef}
          className={clsx(
            'absolute inset-0 p-1',
            !isConnected && 'invisible',
          )}
        />

        {/* Show connection form overlay when disconnected or errored */}
        {(connectionState === 'disconnected' || connectionState === 'error') && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]">
            <div className="text-center">
              <h3 className="text-sm font-semibold text-slate-300 mb-1">Connect to SSH Server</h3>
              <p className="text-xs text-slate-500 mb-4">
                Connect to a remote server running Claude Code in a tmux session.
              </p>
              <SSHConnectForm
                onConnect={connect}
                error={connectionState === 'error' ? 'Failed to connect. Check your settings and try again.' : undefined}
              />
            </div>
          </div>
        )}

        {/* Connecting overlay */}
        {connectionState === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]/80">
            <div className="text-center">
              <div className="size-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-400">Connecting...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
