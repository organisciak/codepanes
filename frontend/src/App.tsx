/**
 * Main app layout — split-panel view with terminal on the left and chat on the right.
 *
 * Run:  cd frontend && pnpm dev
 * Then open http://localhost:5183
 */
import { useState, useCallback, useRef } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { TerminalPanel } from './components/TerminalPanel';
import type { ChatSession, ChatMessage } from './types/chat';

// ─── Sample data for the chat demo ──────────────────────────────────────────

function buildSampleSession(messages: ChatMessage[]): ChatSession {
  return {
    id: 'demo-session',
    messages,
    status: 'IDLE',
    cwd: '/Users/organisciak/projects/claude-code-chat',
  };
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: "Hello! I'm Claude, running in your remote server via SSH/tmux. What would you like to work on today?",
      },
    ],
    timestamp: new Date(Date.now() - 5 * 60_000),
  },
  {
    id: '2',
    role: 'user',
    content: 'Can you look at the project structure and help me implement the chat UI components?',
    timestamp: new Date(Date.now() - 4 * 60_000),
  },
  {
    id: '3',
    role: 'assistant',
    content: [
      {
        type: 'thinking',
        thinking:
          "The user wants me to implement chat UI components. Let me first look at the project structure to understand what already exists and what needs to be built.",
      },
      {
        type: 'text',
        text: "Sure! Let me start by exploring the project structure and then I'll implement the components.",
      },
    ],
    timestamp: new Date(Date.now() - 3.5 * 60_000),
    usage: { inputTokens: 12000, outputTokens: 847, cacheReadTokens: 8000 },
  },
];

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<ChatSession>(() =>
    buildSampleSession(INITIAL_MESSAGES),
  );
  const messageIdCounter = useRef(100);

  const handleSend = useCallback((text: string) => {
    const userMsg: ChatMessage = {
      id: String(messageIdCounter.current++),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const streamingMsg: ChatMessage = {
      id: String(messageIdCounter.current++),
      role: 'assistant',
      content: [],
      timestamp: new Date(),
      isStreaming: true,
    };

    setSession((s) => ({
      ...s,
      status: 'GENERATING',
      messages: [...s.messages, userMsg, streamingMsg],
    }));

    const responses = [
      "I'm just a demo -- no real Claude Code connection here! In production, this would relay your message over WebSocket to SSH to tmux to Claude Code CLI.",
      'Great question! The real implementation would parse the tmux output and show you live streaming responses from Claude.',
      "In the actual app, I'd be running in a tmux session on your remote server. You'd see my tool calls in real-time as I work.",
    ];
    const reply = responses[Math.floor(Math.random() * responses.length)];

    let i = 0;
    const chunkSize = 5;
    const interval = setInterval(() => {
      const chunk = reply.slice(0, (i + 1) * chunkSize);
      const done = chunk.length >= reply.length;

      setSession((s) => {
        const msgs = [...s.messages];
        const lastIdx = msgs.length - 1;
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          content: [{ type: 'text', text: done ? reply : chunk }],
          isStreaming: !done,
        };
        return {
          ...s,
          status: done ? 'IDLE' : 'GENERATING',
          messages: msgs,
        };
      });

      if (done) clearInterval(interval);
      i++;
    }, 60);
  }, []);

  const handleNewChat = useCallback(() => {
    setSession(buildSampleSession([]));
  }, []);

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Split layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Terminal */}
        <div className="w-1/2 min-w-0 p-2 pr-1">
          <TerminalPanel className="h-full" />
        </div>

        {/* Right panel: Chat */}
        <div className="w-1/2 min-w-0 p-2 pl-1">
          <ChatWindow
            session={session}
            onSendMessage={handleSend}
            onNewChat={handleNewChat}
            className="h-full !sm:h-full !sm:my-0 !sm:rounded-xl"
          />
        </div>
      </div>
    </div>
  );
}
