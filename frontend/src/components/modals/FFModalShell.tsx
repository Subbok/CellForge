import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ShellProps {
  /** Modal title shown in the header at 16/600. */
  title: string;
  /** Optional 12px hint under the title — file path, scope, etc. */
  subtitle?: string;
  /** Body content. The shell handles header + footer chrome. */
  children: ReactNode;
  /** Width in px — handoff defaults: notebook=480, share=520, restart=440. */
  width?: number;
  /** Primary action label (right-most footer button). */
  primaryLabel?: string;
  /** Secondary/cancel label (left-most footer button). */
  secondaryLabel?: string;
  /** Whether the primary action is destructive — flips primary to red. */
  danger?: boolean;
  /** Disable the primary button (e.g. invalid form). */
  primaryDisabled?: boolean;
  /** Hide the footer entirely (custom action bars inside body). */
  hideFooter?: boolean;
  /** Called when the user clicks Cancel, the close X, the backdrop or hits Esc. */
  onClose: () => void;
  /** Primary action; if it returns a promise the button shows no spinner — caller decides. */
  onPrimary?: () => void | Promise<void>;
}

/**
 * Forge modal shell — header (title + subtitle + close X), padded body slot
 * and a darker footer shelf (Cancel ghost + primary). Destructive variant
 * swaps the primary fill for red. Open/close animations and backdrop click
 * dismissal are handled here so callers stay focused on form content.
 */
export function FFModalShell({
  title,
  subtitle,
  children,
  width = 480,
  primaryLabel,
  secondaryLabel,
  danger,
  primaryDisabled,
  hideFooter,
  onClose,
  onPrimary,
}: ShellProps) {
  const { t } = useTranslation();
  const finalPrimary = primaryLabel ?? t('common.ok');
  const finalSecondary = secondaryLabel ?? t('common.cancel');

  // Esc closes the topmost modal. We don't track a stack — the latest mounted
  // FFModalShell handles Esc; for nested cases the parent should disable the
  // child's keyboard handling itself.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        animation: 'ff-modal-backdrop-in 180ms ease-out',
      }}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: `min(${width}px, calc(100vw - 24px))`,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 10px)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          animation: 'ff-modal-panel-in 200ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <div className="flex-1 min-w-0">
              <div className="font-semibold" style={{
                fontSize: 16, color: 'var(--color-text)', letterSpacing: '-0.015em',
              }}>{title}</div>
              {subtitle && (
                <div style={{
                  fontSize: 12, color: 'var(--color-text-muted)',
                  marginTop: 4, lineHeight: 1.5,
                }}>{subtitle}</div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-text-muted hover:text-text"
              style={{
                width: 24, height: 24, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 24px' }}>{children}</div>

        {/* Footer */}
        {!hideFooter && (
          <div className="flex justify-end" style={{
            padding: '14px 24px',
            background: 'var(--color-bg)',
            borderTop: '1px solid var(--color-border-subtle)',
            gap: 8,
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                color: 'var(--color-text-secondary)',
                fontSize: 13, cursor: 'pointer',
              }}
            >
              {finalSecondary}
            </button>
            {onPrimary && (
              <button
                onClick={onPrimary}
                disabled={primaryDisabled}
                style={{
                  padding: '8px 14px',
                  background: danger ? '#ef4444' : 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 6,
                  color: danger ? '#fff' : 'var(--color-accent-fg)',
                  fontSize: 13, fontWeight: 600,
                  cursor: primaryDisabled ? 'not-allowed' : 'pointer',
                  opacity: primaryDisabled ? 0.5 : 1,
                }}
              >
                {finalPrimary}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Forge form input — uppercase microlabel, padded mono/regular field, hint. */
export function FFInput({
  label, value, onChange, placeholder, type, mono, prefix, hint, autoFocus, onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  mono?: boolean;
  prefix?: ReactNode;
  hint?: ReactNode;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="uppercase" style={{
        fontSize: 11, color: 'var(--color-text-secondary)',
        marginBottom: 6, letterSpacing: '0.04em', fontWeight: 500,
      }}>{label}</div>
      <div className="flex items-center" style={{
        padding: '9px 12px',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 7,
        gap: 6,
      }}>
        {prefix && <span style={{ color: 'var(--color-text-muted)', display: 'flex' }}>{prefix}</span>}
        <input
          type={type ?? 'text'}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          className="flex-1 bg-transparent outline-none"
          style={{
            fontSize: 13,
            color: 'var(--color-text)',
            fontFamily: mono ? '"JetBrains Mono", monospace' : 'inherit',
            border: 'none', padding: 0,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** Forge select — same chrome as FFInput, but renders a native select for accessibility. */
export function FFSelect<T extends string | number>({
  label, value, options, onChange, hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="uppercase" style={{
        fontSize: 11, color: 'var(--color-text-secondary)',
        marginBottom: 6, letterSpacing: '0.04em', fontWeight: 500,
      }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        style={{
          width: '100%', padding: '9px 12px',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 7,
          fontSize: 13, color: 'var(--color-text)',
          outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={String(o.value)} value={o.value as string | number}>{o.label}</option>
        ))}
      </select>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** Inline toggle row — JSX uses this inside notebook-create for "reactive execution". */
export function FFToggleRow({
  label, sub, on, onChange,
}: {
  label: string; sub?: string; on: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center" style={{
      gap: 10, padding: 12,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 7,
    }}>
      <button
        onClick={() => onChange(!on)}
        style={{
          width: 32, height: 18, borderRadius: 9,
          background: on ? 'var(--color-accent)' : 'var(--color-bg-hover)',
          position: 'relative', cursor: 'pointer', border: 'none',
          flexShrink: 0,
          transition: 'background 120ms ease',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: on ? 'var(--color-accent-fg)' : 'var(--color-text-muted)',
          transition: 'left 120ms ease, background 120ms ease',
        }} />
      </button>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline check row — used by the kernel restart confirmation. */
export function FFCheckRow({
  label, checked, onChange,
}: {
  label: string; checked: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center"
      style={{
        gap: 8, fontSize: 13, color: 'var(--color-text-secondary)',
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 3,
        border: '1.5px solid var(--color-border)',
        background: checked ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 4.5L3.5 7L8 1" stroke="var(--color-accent-fg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}
