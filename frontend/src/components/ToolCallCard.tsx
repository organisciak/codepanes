import { useState } from 'react';
import { clsx } from 'clsx';
import type { ToolCall, ToolName } from '../types/chat';

interface ToolCallCardProps {
  toolCall: ToolCall;
  className?: string;
}

// ─── Tool metadata ─────────────────────────────────────────────────────────

interface ToolMeta {
  label: string;
  icon: string;
  accentColor: string; // Tailwind text color class
  bgColor: string;     // Tailwind bg color class
  borderColor: string; // Tailwind border color class
}

const TOOL_META: Record<string, ToolMeta> = {
  Bash: {
    label: 'Bash',
    icon: '$',
    accentColor: 'text-emerald-400',
    bgColor: 'bg-emerald-950/40',
    borderColor: 'border-emerald-800/50',
  },
  Read: {
    label: 'Read',
    icon: '📄',
    accentColor: 'text-sky-400',
    bgColor: 'bg-sky-950/40',
    borderColor: 'border-sky-800/50',
  },
  Write: {
    label: 'Write',
    icon: '✏️',
    accentColor: 'text-amber-400',
    bgColor: 'bg-amber-950/40',
    borderColor: 'border-amber-800/50',
  },
  Edit: {
    label: 'Edit',
    icon: '📝',
    accentColor: 'text-orange-400',
    bgColor: 'bg-orange-950/40',
    borderColor: 'border-orange-800/50',
  },
  Glob: {
    label: 'Glob',
    icon: '🔍',
    accentColor: 'text-purple-400',
    bgColor: 'bg-purple-950/40',
    borderColor: 'border-purple-800/50',
  },
  Grep: {
    label: 'Grep',
    icon: '🔎',
    accentColor: 'text-violet-400',
    bgColor: 'bg-violet-950/40',
    borderColor: 'border-violet-800/50',
  },
  Task: {
    label: 'Task',
    icon: '🤖',
    accentColor: 'text-cyan-400',
    bgColor: 'bg-cyan-950/40',
    borderColor: 'border-cyan-800/50',
  },
  WebFetch: {
    label: 'WebFetch',
    icon: '🌐',
    accentColor: 'text-blue-400',
    bgColor: 'bg-blue-950/40',
    borderColor: 'border-blue-800/50',
  },
  WebSearch: {
    label: 'WebSearch',
    icon: '🔍',
    accentColor: 'text-indigo-400',
    bgColor: 'bg-indigo-950/40',
    borderColor: 'border-indigo-800/50',
  },
  TodoWrite: {
    label: 'TodoWrite',
    icon: '✅',
    accentColor: 'text-teal-400',
    bgColor: 'bg-teal-950/40',
    borderColor: 'border-teal-800/50',
  },
};

const DEFAULT_TOOL_META: ToolMeta = {
  label: 'Tool',
  icon: '⚙',
  accentColor: 'text-slate-400',
  bgColor: 'bg-slate-900/40',
  borderColor: 'border-slate-700/50',
};

function getToolMeta(name: ToolName): ToolMeta {
  return TOOL_META[name] ?? { ...DEFAULT_TOOL_META, label: name };
}

// ─── Input summary helpers ──────────────────────────────────────────────────

function summarizeInput(name: ToolName, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': {
      const cmd = (input.command as string) ?? '';
      return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
    }
    case 'Read': {
      const path = (input.file_path as string) ?? '';
      return shortenPath(path);
    }
    case 'Write':
    case 'Edit': {
      const path = (input.file_path as string) ?? '';
      return shortenPath(path);
    }
    case 'Glob': {
      const pattern = (input.pattern as string) ?? '';
      const dir = (input.path as string) ?? '';
      return dir ? `${pattern} in ${shortenPath(dir)}` : pattern;
    }
    case 'Grep': {
      const pattern = (input.pattern as string) ?? '';
      const path = (input.path as string) ?? '';
      return path ? `"${pattern}" in ${shortenPath(path)}` : `"${pattern}"`;
    }
    case 'WebFetch':
    case 'WebSearch': {
      return (input.url as string) ?? (input.query as string) ?? '';
    }
    case 'Task': {
      const desc = (input.description as string) ?? '';
      return desc.length > 60 ? desc.slice(0, 60) + '…' : desc;
    }
    default: {
      const keys = Object.keys(input);
      if (keys.length === 0) return '';
      const first = keys[0];
      const val = String(input[first] ?? '');
      return val.length > 60 ? val.slice(0, 60) + '…' : val;
    }
  }
}

function shortenPath(path: string): string {
  if (!path) return '';
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return '…/' + parts.slice(-2).join('/');
}

// ─── Components ─────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx('size-3.5 transition-transform duration-200', open && 'rotate-180')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StatusBadge({ toolCall, accentColor }: { toolCall: ToolCall; accentColor: string }) {
  if (toolCall.isRunning) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-400 text-[10px]">
        <SpinnerIcon className="size-3" />
        running
      </span>
    );
  }
  if (toolCall.isError) {
    return <span className="text-red-400 text-[10px]">✕ error</span>;
  }
  if (toolCall.result !== undefined) {
    return <span className={clsx('text-[10px]', accentColor)}>✓ done</span>;
  }
  return null;
}

/**
 * Displays a single tool call from an assistant message.
 * Collapsible — click the header to show/hide the raw input + result.
 *
 * Tool types each have distinct colors:
 * - Bash: emerald (terminal)
 * - Read: sky (file read)
 * - Write/Edit: amber/orange (file mutation)
 * - Glob/Grep: purple/violet (search)
 * - Task: cyan (subagent)
 * - Web*: blue/indigo (network)
 */
export function ToolCallCard({ toolCall, className }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const meta = getToolMeta(toolCall.name);
  const summary = summarizeInput(toolCall.name, toolCall.input);
  const hasOutput = toolCall.result !== undefined && toolCall.result !== null;

  return (
    <div
      className={clsx(
        'rounded-lg border text-xs font-mono overflow-hidden',
        meta.bgColor,
        meta.borderColor,
        className,
      )}
    >
      {/* Header — always visible */}
      <button
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2 text-left',
          'hover:bg-white/5 active:bg-white/10 transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${meta.label} — ${summary || 'expand'}`}
      >
        {/* Tool icon */}
        <span className="text-sm leading-none select-none" aria-hidden="true">
          {meta.icon}
        </span>

        {/* Tool name */}
        <span className={clsx('font-semibold shrink-0', meta.accentColor)}>{meta.label}</span>

        {/* Input summary */}
        {summary && (
          <span className="text-slate-400 truncate flex-1 min-w-0">{summary}</span>
        )}

        {/* Status badge */}
        <StatusBadge toolCall={toolCall} accentColor={meta.accentColor} />

        {/* Chevron */}
        <span className="text-slate-500 shrink-0">
          <ChevronIcon open={open} />
        </span>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div className="border-t border-white/5">
          {/* Input */}
          <div className="p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-sans">Input</p>
            <pre className="whitespace-pre-wrap break-all text-slate-300 leading-relaxed max-h-48 overflow-y-auto">
              {formatInput(toolCall.input)}
            </pre>
          </div>

          {/* Result */}
          {hasOutput && (
            <div className="border-t border-white/5 p-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-sans">
                {toolCall.isError ? 'Error output' : 'Output'}
              </p>
              <pre
                className={clsx(
                  'whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto',
                  toolCall.isError ? 'text-red-300' : 'text-slate-300',
                )}
              >
                {toolCall.result}
              </pre>
            </div>
          )}

          {/* Running indicator */}
          {toolCall.isRunning && (
            <div className="border-t border-white/5 p-3">
              <span className="text-amber-400 inline-flex items-center gap-2">
                <SpinnerIcon className="size-3.5" />
                <span>Executing…</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
