import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { BrandMark } from './brand/BrandMark';

interface Props {
  isFirstUser: boolean;
  onSuccess: (user: { username: string; is_admin: boolean }) => void;
}

/** Forge field: 12px label above a 10/12 padded input on bg-elevated. */
function FFField({
  label, value, onChange, type, autoFocus, onEnter, placeholder, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'password' | 'text';
  autoFocus?: boolean;
  onEnter?: () => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[12px] text-text-secondary mb-1.5">{label}</label>
      <input
        type={type ?? 'text'}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        placeholder={placeholder}
        className={`w-full px-3 py-2.5 rounded-[8px] text-[13px] text-text outline-none transition-colors ${
          mono || type === 'password' ? 'font-mono' : ''
        }`}
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
        }}
      />
    </div>
  );
}

export function LoginPage({ isFirstUser, onSuccess }: Props) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!username || !password) return;
    setError('');
    setLoading(true);
    try {
      const res = isFirstUser
        ? await api.register(username, password, displayName || undefined)
        : await api.login(username, password);

      if (res.ok && res.user) {
        onSuccess(res.user);
      } else {
        setError(res.error ?? t('auth.unknownError'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: `
          radial-gradient(circle 700px at 100% 0%, rgba(167,139,250,0.18), transparent 65%),
          radial-gradient(circle 700px at 0% 100%, rgba(96,165,250,0.12), transparent 65%),
          var(--color-bg)
        `,
      }}
    >

      {/* Card */}
      <div
        className="relative"
        style={{
          width: 460, padding: 44,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          zoom: 1.15,
        }}
      >
        {/* Brand: mark + wordmark inline */}
        <div className="flex items-center" style={{ gap: 9 }}>
          <BrandMark size={28} className="text-text" />
          <span
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: 28 * 0.7,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              color: 'var(--color-text)',
            }}
          >
            Cell<span style={{ color: 'var(--color-accent)' }}>Forge</span>
          </span>
        </div>

        {/* Welcome heading */}
        <h1
          className="text-[26px] font-semibold"
          style={{
            color: 'var(--color-text)',
            marginTop: 28,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}
        >
          {isFirstUser ? t('auth.workspaceFirstSetup') : t('auth.welcomeBack')}
        </h1>
        <p className="text-[14px] text-text-muted" style={{ marginTop: 4 }}>
          {isFirstUser ? t('auth.createAdminAccount') : t('auth.signInToWorkspace')}
        </p>

        {/* Fields */}
        <div className="flex flex-col" style={{ marginTop: 28, gap: 14 }}>
          <FFField
            label={t('auth.username')}
            value={username}
            onChange={setUsername}
            autoFocus
            mono
            onEnter={submit}
          />
          {isFirstUser && (
            <FFField
              label={t('auth.displayName')}
              value={displayName}
              onChange={setDisplayName}
              placeholder={t('auth.optional')}
              onEnter={submit}
            />
          )}
          <FFField
            label={t('auth.password')}
            value={password}
            onChange={setPassword}
            type="password"
            onEnter={submit}
          />
        </div>

        {error && (
          <div
            className="text-[12px] rounded-lg"
            style={{
              marginTop: 14,
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.20)',
              color: 'var(--color-error)',
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading || !username || !password}
          className="w-full transition-colors active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            marginTop: 20,
            padding: '11px 16px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 rounded-full animate-spin"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent-fg) 30%, transparent)',
                  borderTopColor: 'var(--color-accent-fg)',
                }} />
              {t('auth.signingIn')}
            </span>
          ) : isFirstUser ? t('auth.createAdmin') : t('auth.signIn')}
        </button>

        {/* Help line */}
        {!isFirstUser && (
          <p
            className="text-center"
            style={{
              marginTop: 22, fontSize: 12, lineHeight: 1.6,
              color: 'var(--color-text-muted)',
            }}
          >
            {t('auth.askYourAdmin')}
          </p>
        )}
      </div>
    </div>
  );
}
