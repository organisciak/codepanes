import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { clsx } from 'clsx';
import type { ChatMessage, ChatSession, ClaudeStatus } from '../types/chat';
import { MessageBubble } from './MessageBubble';
import { StatusIndicator } from './StatusIndicator';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22 11 13 2 9z" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ─── Scroll to bottom hook ────────────────────────────────────────────────────

function useScrollToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const threshold = 100;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (isNearBottom.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, handleScroll };
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center select-none">
      <div className="size-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="size-8 text-violet-400" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
        </svg>
      </div>
      <div>
        <p className="text-slate-300 font-medium mb-1">Claude Code Chat</p>
        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
          Start a conversation or connect to an active session to see messages here.
        </p>
      </div>
    </div>
  );
}

// ─── Message list ─────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: ChatMessage[];
  status: ClaudeStatus;
}

function MessageList({ messages, status }: MessageListProps) {
  const { ref, handleScroll } = useScrollToBottom([messages, status]);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto messages-scroll px-3 sm:px-4 py-4 space-y-4"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

// ─── Input area ───────────────────────────────────────────────────────────────

interface InputAreaProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  status: ClaudeStatus;
}

function InputArea({ onSend, disabled, status }: InputAreaProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const text = value.trim();
      if (!text || disabled) return;
      onSend(text);
      setValue('');
      // Reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [value, disabled, onSend],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const placeholders: Record<ClaudeStatus, string> = {
    IDLE: 'Message Claude Code… (Enter to send, Shift+Enter for newline)',
    GENERATING: 'Claude is responding…',
    TOOL_RUNNING: 'Running a tool…',
    THINKING: 'Claude is thinking…',
    ERROR: 'Something went wrong. Try again.',
  };

  return (
    <div className="border-t border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 px-3 sm:px-4 py-3"
      >
        <div
          className={clsx(
            'flex-1 flex items-end gap-2 rounded-xl border transition-colors',
            'bg-slate-800',
            disabled
              ? 'border-slate-700/50 opacity-60'
              : 'border-slate-600/50 focus-within:border-violet-600/70',
          )}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholders[status]}
            className={clsx(
              'flex-1 bg-transparent resize-none px-3 py-2.5 text-sm text-slate-200',
              'placeholder:text-slate-500',
              'focus:outline-none',
              'min-h-[40px] max-h-[200px]',
              'leading-relaxed',
            )}
            aria-label="Message input"
            aria-multiline="true"
          />
        </div>

        <button
          type="submit"
          disabled={!canSend}
          className={clsx(
            'shrink-0 flex items-center justify-center rounded-xl p-2.5 transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
            canSend
              ? 'bg-violet-600 text-white hover:bg-violet-500 active:scale-95 shadow-lg shadow-violet-900/40'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed',
          )}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </form>

      {/* Character/line hint */}
      <p className="px-4 pb-2 text-[10px] text-slate-600 text-center">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface ChatHeaderProps {
  session: ChatSession | null;
  status: ClaudeStatus;
  onNewChat?: () => void;
}

function ChatHeader({ session, status, onNewChat }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/60 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Logo/brand */}
        <div className="size-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          C
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-200 leading-tight truncate">
            Claude Code
          </p>
          {session?.cwd && (
            <p className="text-[10px] text-slate-500 truncate max-w-48 sm:max-w-72">
              {session.cwd}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusIndicator status={status} error={session?.error} />

        {onNewChat && (
          <button
            onClick={onNewChat}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
              'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
            )}
            title="New chat"
            aria-label="Start a new chat"
          >
            <NewChatIcon />
            <span className="hidden sm:inline">New</span>
          </button>
        )}
      </div>
    </header>
  );
}

// ─── Main ChatWindow ──────────────────────────────────────────────────────────

interface ChatWindowProps {
  /** The current session data; null shows an empty/loading state */
  session: ChatSession | null;
  /** Called when the user submits a message */
  onSendMessage?: (text: string) => void;
  /** Called when the user clicks "New chat" */
  onNewChat?: () => void;
  /** If true, the input is disabled (e.g., disconnected) */
  disabled?: boolean;
  /** Additional class names for the root element */
  className?: string;
}

/**
 * The main chat window component.
 *
 * Layout (mobile-first, full-screen):
 * ┌──────────────────────────────┐
 * │  Header (status + controls)  │
 * ├──────────────────────────────┤
 * │                              │
 * │   Message list (scrollable)  │
 * │                              │
 * ├──────────────────────────────┤
 * │   Input area + send button   │
 * └──────────────────────────────┘
 *
 * On desktop it constrains to max-w-3xl and centers.
 */
export function ChatWindow({
  session,
  onSendMessage,
  onNewChat,
  disabled = false,
  className,
}: ChatWindowProps) {
  const status = session?.status ?? 'IDLE';
  const messages = session?.messages ?? [];
  const isInputDisabled = disabled || status === 'GENERATING' || status === 'THINKING';

  const handleSend = useCallback(
    (text: string) => {
      onSendMessage?.(text);
    },
    [onSendMessage],
  );

  return (
    <div
      className={clsx(
        // Full viewport on mobile, constrained + rounded on desktop
        'flex flex-col',
        'h-screen sm:h-[calc(100vh-2rem)]',
        'w-full sm:max-w-3xl sm:mx-auto sm:my-4 sm:rounded-2xl',
        'overflow-hidden',
        'bg-slate-900 text-slate-200',
        'border border-slate-700/30',
        'shadow-2xl shadow-black/40',
        className,
      )}
    >
      <ChatHeader session={session} status={status} onNewChat={onNewChat} />

      <MessageList messages={messages} status={status} />

      <InputArea
        onSend={handleSend}
        disabled={isInputDisabled}
        status={status}
      />
    </div>
  );
}
