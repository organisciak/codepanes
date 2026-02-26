/**
 * Hook that manages an xterm.js terminal instance connected to a WebSocket relay.
 *
 * Usage:
 *   const { terminalRef, connectionState, claudeState, connect, disconnect, sendInput } = useTerminal();
 *   <div ref={terminalRef} style={{ height: '400px' }} />
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ClaudeState {
  status: 'idle' | 'generating' | 'tool_running' | 'thinking' | 'error' | 'unknown';
  toolName?: string;
  message?: string;
}

export interface ConnectParams {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3005';

export function useTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [claudeState, setClaudeState] = useState<ClaudeState | null>(null);

  // Initialize terminal once the ref is attached to a DOM element
  useEffect(() => {
    const container = terminalRef.current;
    if (!container || terminalInstance.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
      cols: 120,
      rows: 50,
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    fit.fit();

    terminalInstance.current = terminal;
    fitAddon.current = fit;

    // Resize observer to keep terminal fitted to container
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalInstance.current = null;
      fitAddon.current = null;
    };
  }, []);

  // Send a resize message over the WebSocket
  const sendResize = useCallback(() => {
    const ws = wsRef.current;
    const fit = fitAddon.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !fit) return;

    const dims = fit.proposeDimensions();
    const cols = dims?.cols ?? 120;
    const rows = dims?.rows ?? 50;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  const connect = useCallback((params: ConnectParams) => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const terminal = terminalInstance.current;
    if (!terminal) return;

    terminal.clear();
    setConnectionState('connecting');
    setClaudeState(null);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      const fit = fitAddon.current;
      const dims = fit?.proposeDimensions();
      const cols = dims?.cols ?? 120;
      const rows = dims?.rows ?? 50;

      ws.send(JSON.stringify({
        type: 'connect',
        host: params.host,
        port: params.port,
        username: params.username,
        password: params.password,
        privateKey: params.privateKey,
        tmuxSession: 'claude-code',
        cols,
        rows,
      }));
    };

    ws.onmessage = (event: MessageEvent) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'connected':
          setConnectionState('connected');
          // Request initial state
          ws.send(JSON.stringify({ type: 'get-state' }));
          break;

        case 'output': {
          const data = msg.data as string;
          const bytes = Uint8Array.from(data, (c) => c.charCodeAt(0));
          terminal.write(bytes);
          break;
        }

        case 'state':
          setClaudeState(msg.state as ClaudeState);
          break;

        case 'error':
          setConnectionState('error');
          terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
          break;

        case 'closed':
          setConnectionState('disconnected');
          terminal.writeln(`\r\n\x1b[33mConnection closed: ${msg.reason}\x1b[0m`);
          break;
      }
    };

    ws.onerror = () => {
      setConnectionState('error');
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setConnectionState((prev) => (prev === 'error' ? 'error' : 'disconnected'));
      }
    };

    // Wire terminal input → WebSocket
    const inputDisposable = terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Wire resize → WebSocket
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Store disposables so we can clean up
    const cleanup = () => {
      inputDisposable.dispose();
      resizeDisposable.dispose();
    };

    // Override onclose to also clean up listeners
    const originalOnClose = ws.onclose;
    ws.onclose = (ev) => {
      cleanup();
      originalOnClose?.call(ws, ev);
    };
  }, []);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'disconnect' }));
      }
      ws.close();
      wsRef.current = null;
    }
    setConnectionState('disconnected');
  }, []);

  const sendInput = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: text }));
    }
  }, []);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Fit the terminal whenever the window resizes (backup for ResizeObserver)
  useEffect(() => {
    const handleResize = () => {
      fitAddon.current?.fit();
      sendResize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sendResize]);

  return {
    terminalRef,
    connectionState,
    claudeState,
    connect,
    disconnect,
    sendInput,
  };
}
