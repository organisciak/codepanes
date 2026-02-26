import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, ContentBlock, TextBlock, ThinkingBlock, ToolCall } from '../types/chat';
import { ToolCallCard } from './ToolCallCard';
import { TypingIndicator } from './StatusIndicator';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Whether to show timestamp (default true) */
  showTimestamp?: boolean;
  className?: string;
}

// ─── Time formatting ─────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Markdown renderer ───────────────────────────────────────────────────────

function MarkdownContent({ text, isUser }: { text: string; isUser: boolean }) {
  return (
    <div
      className={clsx(
        'prose prose-sm max-w-none',
        isUser
          ? [
              'prose-invert',
              'prose-p:text-white/90',
              'prose-code:text-violet-200',
              'prose-code:bg-violet-900/60',
              'prose-pre:bg-violet-950/80',
            ]
          : [
              'prose-invert',
              'prose-p:text-slate-200',
              'prose-code:text-emerald-300',
              'prose-code:bg-slate-800',
              'prose-pre:bg-slate-900',
              'prose-pre:border prose-pre:border-slate-700',
              'prose-a:text-violet-400 hover:prose-a:text-violet-300',
            ],
        // Common overrides
        'prose-p:my-1.5 prose-p:leading-relaxed',
        'prose-pre:my-2 prose-pre:text-xs',
        'prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:font-mono',
        'prose-pre:code:bg-transparent prose-pre:code:p-0',
        'prose-ul:my-1.5 prose-ol:my-1.5',
        'prose-li:my-0.5',
        'prose-h1:text-lg prose-h2:text-base prose-h3:text-sm',
        'prose-blockquote:border-l-violet-500 prose-blockquote:text-slate-400',
        'prose-hr:border-slate-600',
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

// ─── Content block renderers ─────────────────────────────────────────────────

function ThinkingBubble({ block }: { block: ThinkingBlock }) {
  return (
    <details className="group mb-2">
      <summary className="cursor-pointer select-none text-xs text-cyan-400 hover:text-cyan-300 transition-colors list-none flex items-center gap-1.5">
        <span
          className="inline-block transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="thinking-shimmer font-medium">Thinking</span>
        <span className="text-slate-500">
          ({Math.ceil(block.thinking.split(/\s+/).length / 200)} min read)
        </span>
      </summary>
      <div className="mt-2 pl-4 border-l-2 border-cyan-800/50 text-slate-400 text-sm leading-relaxed whitespace-pre-wrap font-mono">
        {block.thinking}
      </div>
    </details>
  );
}

function AssistantContent({
  blocks,
  isStreaming,
}: {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}) {
  const rendered: React.ReactNode[] = [];

  blocks.forEach((block, idx) => {
    if (block.type === 'thinking') {
      rendered.push(<ThinkingBubble key={idx} block={block as ThinkingBlock} />);
    } else if (block.type === 'text') {
      const text = (block as TextBlock).text;
      const isLast = idx === blocks.length - 1;
      rendered.push(
        <div key={idx} className={clsx(isLast && isStreaming && 'streaming-cursor')}>
          <MarkdownContent text={text} isUser={false} />
        </div>,
      );
    } else if (block.type === 'tool_use') {
      rendered.push(
        <ToolCallCard key={idx} toolCall={block as ToolCall} className="my-2" />,
      );
    }
  });

  // If currently streaming but no text blocks yet, show a typing indicator
  if (isStreaming && rendered.length === 0) {
    rendered.push(<TypingIndicator key="typing" />);
  }

  return <>{rendered}</>;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function UserAvatar() {
  return (
    <div className="size-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
      U
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="size-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 border border-slate-600">
      <svg viewBox="0 0 24 24" className="size-4 text-violet-400" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
      </svg>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * Renders a single chat message as a bubble.
 *
 * - User messages: right-aligned, violet bubble, plain or markdown text
 * - Assistant messages: left-aligned, dark slate, supports content blocks:
 *   - text: rendered as Markdown
 *   - thinking: collapsible ThinkingBubble
 *   - tool_use: ToolCallCard
 * - Streaming state: cursor animation on last text block, typing indicator if no text yet
 */
export function MessageBubble({
  message,
  showTimestamp = true,
  className,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // System messages get a minimal centered treatment
  if (isSystem) {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as TextBlock).text)
            .join('');
    return (
      <div className={clsx('flex justify-center my-3', className)}>
        <span className="text-xs text-slate-500 bg-slate-800/60 rounded-full px-3 py-1 border border-slate-700/50">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex gap-2 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
        'items-end',
        className,
      )}
    >
      {/* Avatar */}
      <div className="shrink-0 mb-1">{isUser ? <UserAvatar /> : <AssistantAvatar />}</div>

      {/* Bubble */}
      <div
        className={clsx(
          'relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm',
          isUser
            ? [
                'rounded-br-sm',
                'bg-violet-700 text-white',
                'shadow-violet-900/30',
              ]
            : [
                'rounded-bl-sm',
                'bg-slate-800 text-slate-200 border border-slate-700/50',
                'shadow-slate-900/30',
              ],
        )}
      >
        {/* Content */}
        {isUser ? (
          <div
            className={clsx(
              message.isStreaming && 'streaming-cursor',
            )}
          >
            {typeof message.content === 'string' ? (
              <MarkdownContent text={message.content} isUser />
            ) : (
              message.content
                .filter((b) => b.type === 'text')
                .map((b, i) => (
                  <MarkdownContent key={i} text={(b as TextBlock).text} isUser />
                ))
            )}
          </div>
        ) : (
          <AssistantContent
            blocks={typeof message.content === 'string'
              ? [{ type: 'text', text: message.content }]
              : (message.content as ContentBlock[])}
            isStreaming={message.isStreaming}
          />
        )}

        {/* Timestamp + streaming indicator */}
        {showTimestamp && (
          <div
            className={clsx(
              'flex items-center gap-1.5 mt-1.5',
              'text-[10px] leading-none',
              isUser ? 'justify-end text-violet-300/60' : 'justify-start text-slate-500',
            )}
          >
            <time dateTime={message.timestamp.toISOString()}>
              {formatTime(message.timestamp)}
            </time>
            {message.isStreaming && (
              <span className={isUser ? 'text-violet-300/80' : 'text-violet-400'}>
                ···
              </span>
            )}
            {/* Token usage for assistant messages */}
            {!isUser && message.usage?.outputTokens && (
              <span className="text-slate-600 ml-1">
                {message.usage.outputTokens.toLocaleString()} tok
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
