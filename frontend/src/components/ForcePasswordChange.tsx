import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { FFModalShell, FFInput } from './modals/FFModalShell';

/**
 * Modal forced open after login when `user.must_change_password === true`.
 * Set on admin-created accounts (the password the admin chose is a
 * one-shot bootstrap value) and after an admin resets someone else's
 * password. Cleared by the backend the moment the user successfully
 * picks their own — `onDone` runs after that, refetching `/auth/me` so
 * the App's user state catches up.
 *
 * No "later" / "skip" affordance on purpose — the modal blocks the rest
 * of the UI until done, which is the whole point of the must-change flow.
 */
export function ForcePasswordChange({
  username,
  onDone,
}: {
  username: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (pwNew.length < 8) {
      setError(t('forcePwd.tooShort', 'Password must be at least 8 characters.'));
      return;
    }
    if (pwNew !== pwConfirm) {
      setError(t('forcePwd.mismatch', "Passwords don't match."));
      return;
    }
    setBusy(true);
    try {
      // Backend clears must_change_password when a user changes their OWN
      // password (target == caller). Don't pass `username` — the route
      // defaults to the caller.
      const res = await api.changePassword(pwNew);
      if (!res.ok) {
        setError(res.error ?? t('forcePwd.failed', 'Password change failed.'));
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <FFModalShell
      title={t('forcePwd.title', 'Choose your password')}
      subtitle={t('forcePwd.subtitle',
        'Welcome, {{user}}. Your account was set up with a temporary password — set your own to continue.',
        { user: username },
      )}
      primaryLabel={busy
        ? t('forcePwd.saving', 'Saving…')
        : t('forcePwd.submit', 'Set password')}
      secondaryLabel=""
      primaryDisabled={busy || pwNew.length === 0 || pwConfirm.length === 0}
      onPrimary={submit}
      // No-op close handler — modal is non-dismissable until the password
      // actually changes. Esc and the secondary button still fire onClose;
      // a no-op leaves the modal mounted, which is what we want.
      onClose={() => {}}
    >
      <FFInput
        label={t('forcePwd.newLabel', 'New password')}
        value={pwNew}
        onChange={setPwNew}
        type="password"
        mono
        autoFocus
        onEnter={submit}
        hint={t('forcePwd.hint', 'Minimum 8 characters. Pick something you can remember.')}
      />
      <FFInput
        label={t('forcePwd.confirmLabel', 'Confirm new password')}
        value={pwConfirm}
        onChange={setPwConfirm}
        type="password"
        mono
        onEnter={submit}
      />
      {error && (
        <div className="text-[12px] rounded-lg" style={{
          padding: '8px 12px',
          background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.20)',
          color: 'var(--color-error)',
        }}>{error}</div>
      )}
    </FFModalShell>
  );
}
