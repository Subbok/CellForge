import { useState } from 'react';
import { api } from '../services/api';
import { Anvil } from 'lucide-react';

interface Props {
  isFirstUser: boolean;
  onSuccess: (user: { username: string; is_admin: boolean }) => void;
}

export function LoginPage({ isFirstUser, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError('');
    setLoading(true);
    try {
      const res = isFirstUser
        ? await api.register(username, password, displayName || undefined)
        : await api.login(username, password);

      if (res.ok && res.user) {
        onSuccess(res.user);
      } else {
        setError(res.error ?? 'Unknown error');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center relative overflow-hidden">
      {/* Ambient background glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 600px 400px at 50% 40%, rgba(122,153,255,0.08), transparent),
            radial-gradient(ellipse 400px 300px at 30% 70%, rgba(122,153,255,0.04), transparent),
            radial-gradient(ellipse 300px 200px at 70% 30%, rgba(167,139,250,0.04), transparent)
          `,
        }}
      />

      {/* Subtle noise texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />

      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <Anvil size={28} className="text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-text tracking-tight">CellForge</h1>
          <p className="text-sm text-text-muted mt-2">
            {isFirstUser ? 'Create your admin account to get started' : 'Sign in to your workspace'}
          </p>
        </div>

        {/* Form card */}
        <div className="bg-bg-secondary/80 backdrop-blur-xl border border-border/60 rounded-2xl p-8 shadow-2xl shadow-black/30">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-muted mb-1.5 block">Username</label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                className="field h-11 rounded-xl bg-bg/60 border-border/60 focus:bg-bg/80 focus:border-accent/60 transition-all"
              />
            </div>

            {isFirstUser && (
              <div>
                <label className="text-xs font-medium text-text-muted mb-1.5 block">Display name</label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Optional"
                  className="field h-11 rounded-xl bg-bg/60 border-border/60 focus:bg-bg/80 focus:border-accent/60 transition-all"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-text-muted mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                className="field h-11 rounded-xl bg-bg/60 border-border/60 focus:bg-bg/80 focus:border-accent/60 transition-all"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 px-4 py-2.5 bg-error/10 border border-error/20 text-error text-xs rounded-xl">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading || !username || !password}
            className="btn btn-lg btn-primary w-full mt-6 h-11 rounded-xl text-sm font-semibold
                       shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all duration-200
                       active:scale-[0.98]"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-accent-fg/30 border-t-accent-fg rounded-full animate-spin" />
                Signing in...
              </span>
            ) : isFirstUser ? 'Create admin account' : 'Sign in'}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-text-muted/50 mt-6">
          CellForge — Notebook IDE
        </p>
      </div>
    </div>
  );
}
