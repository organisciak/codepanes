import { useState, type FormEvent } from 'react';
import { clsx } from 'clsx';

export interface SSHConnectParams {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
}

interface SSHConnectFormProps {
  onConnect: (params: SSHConnectParams) => void;
  disabled?: boolean;
  error?: string;
}

export function SSHConnectForm({ onConnect, disabled, error }: SSHConnectFormProps) {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password');
  const [privateKey, setPrivateKey] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!host.trim() || !username.trim()) return;

    onConnect({
      host: host.trim(),
      port: port ? Number(port) : undefined,
      username: username.trim(),
      password: authMode === 'password' ? password : undefined,
      privateKey: authMode === 'key' ? privateKey : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 max-w-sm">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="ssh-host" className="block text-xs font-medium text-slate-400 mb-1">
              Host
            </label>
            <input
              id="ssh-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={disabled}
              placeholder="hostname or IP"
              className={clsx(
                'w-full rounded-lg border border-slate-600/50 bg-slate-800 px-3 py-2 text-sm text-slate-200',
                'placeholder:text-slate-500 focus:outline-none focus:border-violet-600/70',
                disabled && 'opacity-60',
              )}
            />
          </div>
          <div className="w-20">
            <label htmlFor="ssh-port" className="block text-xs font-medium text-slate-400 mb-1">
              Port
            </label>
            <input
              id="ssh-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={disabled}
              placeholder="22"
              className={clsx(
                'w-full rounded-lg border border-slate-600/50 bg-slate-800 px-3 py-2 text-sm text-slate-200',
                'placeholder:text-slate-500 focus:outline-none focus:border-violet-600/70',
                disabled && 'opacity-60',
              )}
            />
          </div>
        </div>

        <div>
          <label htmlFor="ssh-username" className="block text-xs font-medium text-slate-400 mb-1">
            Username
          </label>
          <input
            id="ssh-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={disabled}
            placeholder="your username"
            className={clsx(
              'w-full rounded-lg border border-slate-600/50 bg-slate-800 px-3 py-2 text-sm text-slate-200',
              'placeholder:text-slate-500 focus:outline-none focus:border-violet-600/70',
              disabled && 'opacity-60',
            )}
          />
        </div>

        <div>
          <div className="flex gap-3 mb-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
              <input
                type="radio"
                name="auth-mode"
                checked={authMode === 'password'}
                onChange={() => setAuthMode('password')}
                disabled={disabled}
                className="accent-violet-500"
              />
              Password
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
              <input
                type="radio"
                name="auth-mode"
                checked={authMode === 'key'}
                onChange={() => setAuthMode('key')}
                disabled={disabled}
                className="accent-violet-500"
              />
              Private Key
            </label>
          </div>

          {authMode === 'password' ? (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled}
              placeholder="password"
              className={clsx(
                'w-full rounded-lg border border-slate-600/50 bg-slate-800 px-3 py-2 text-sm text-slate-200',
                'placeholder:text-slate-500 focus:outline-none focus:border-violet-600/70',
                disabled && 'opacity-60',
              )}
            />
          ) : (
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              disabled={disabled}
              placeholder="Paste private key contents..."
              rows={4}
              className={clsx(
                'w-full rounded-lg border border-slate-600/50 bg-slate-800 px-3 py-2 text-sm text-slate-200',
                'placeholder:text-slate-500 focus:outline-none focus:border-violet-600/70 resize-none',
                'font-mono text-xs',
                disabled && 'opacity-60',
              )}
            />
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={disabled || !host.trim() || !username.trim()}
        className={clsx(
          'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
          disabled || !host.trim() || !username.trim()
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
            : 'bg-violet-600 text-white hover:bg-violet-500 active:scale-[0.98]',
        )}
      >
        Connect
      </button>
    </form>
  );
}
