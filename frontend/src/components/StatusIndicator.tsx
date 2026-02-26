import { clsx } from 'clsx';
import type { ClaudeStatus } from '../types/chat';

interface StatusIndicatorProps {
  status: ClaudeStatus;
  error?: string;
  /** If true, renders a compact badge; default is the full pill with label */
  compact?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  ClaudeStatus,
  {
    label: string;
    dotColor: string;
    textColor: string;
    bgColor: string;
    animate: boolean;
    icon: string;
  }
> = {
  IDLE: {
    label: 'Ready',
    dotColor: 'bg-emerald-400',
    textColor: 'text-emerald-300',
    bgColor: 'bg-emerald-950/60',
    animate: false,
    icon: '●',
  },
  GENERATING: {
    label: 'Generating',
    dotColor: 'bg-violet-400',
    textColor: 'text-violet-300',
    bgColor: 'bg-violet-950/60',
    animate: true,
    icon: '◎',
  },
  TOOL_RUNNING: {
    label: 'Running tool',
    dotColor: 'bg-amber-400',
    textColor: 'text-amber-300',
    bgColor: 'bg-amber-950/60',
    animate: true,
    icon: '⚙',
  },
  THINKING: {
    label: 'Thinking',
    dotColor: 'bg-cyan-400',
    textColor: 'text-cyan-300',
    bgColor: 'bg-cyan-950/60',
    animate: true,
    icon: '◐',
  },
  ERROR: {
    label: 'Error',
    dotColor: 'bg-red-400',
    textColor: 'text-red-300',
    bgColor: 'bg-red-950/60',
    animate: false,
    icon: '✕',
  },
};

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span className="relative flex size-2.5">
      <span
        className={clsx(
          'absolute inline-flex size-full rounded-full opacity-75 animate-ping',
          color,
        )}
      />
      <span className={clsx('relative inline-flex size-2.5 rounded-full', color)} />
    </span>
  );
}

/**
 * Displays the current Claude Code connection/generation status.
 *
 * States:
 * - IDLE: green — waiting for user input
 * - GENERATING: violet — streaming a response
 * - TOOL_RUNNING: amber — executing a bash/file/search tool
 * - THINKING: cyan — extended thinking in progress
 * - ERROR: red — something went wrong
 */
export function StatusIndicator({
  status,
  error,
  compact = false,
  className,
}: StatusIndicatorProps) {
  const cfg = STATUS_CONFIG[status];
  const label = status === 'ERROR' && error ? error : cfg.label;

  if (compact) {
    return (
      <span
        className={clsx('inline-flex items-center gap-1.5', className)}
        role="status"
        aria-label={label}
        title={label}
      >
        {cfg.animate ? (
          <PulsingDot color={cfg.dotColor} />
        ) : (
          <span className={clsx('size-2.5 rounded-full', cfg.dotColor)} />
        )}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border',
        cfg.bgColor,
        cfg.textColor,
        status === 'IDLE' && 'border-emerald-800/50',
        status === 'GENERATING' && 'border-violet-800/50',
        status === 'TOOL_RUNNING' && 'border-amber-800/50',
        status === 'THINKING' && 'border-cyan-800/50',
        status === 'ERROR' && 'border-red-800/50',
        className,
      )}
      role="status"
      aria-label={label}
    >
      {status === 'TOOL_RUNNING' ? (
        <SpinnerIcon className={clsx('size-3', cfg.textColor)} />
      ) : (
        <PulsingDot color={cfg.dotColor} />
      )}
      <span className={clsx(status === 'THINKING' && 'thinking-shimmer', cfg.textColor)}>
        {label}
      </span>
    </span>
  );
}

/**
 * A row of three animated dots used to indicate streaming/loading inline.
 */
export function TypingIndicator({ className }: { className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 px-1', className)}
      role="status"
      aria-label="Typing"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-slate-400"
          style={{
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}
