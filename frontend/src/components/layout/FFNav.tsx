import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, FolderOpen, FileText, Settings, Shield, Search, LogOut } from 'lucide-react';
import { BrandMark } from '../brand/BrandMark';
import { Wordmark } from '../brand/Wordmark';

export type NavStage = 'home' | 'browse' | 'notebook' | 'settings' | 'admin';

interface NavItemDef {
  id: NavStage;
  label: string;
  icon: typeof Home;
  visible: boolean;
  enabled: boolean;
}

interface Props {
  user: { username: string; display_name?: string; is_admin: boolean } | null;
  currentStage: NavStage;
  hasOpenNotebook: boolean;
  onNav: (stage: NavStage) => void;
  onLogout: () => void;
  onOpenSearch?: () => void;
}

/**
 * The Forge top-nav. 52px tall, persistent across every authenticated stage.
 * - Logo + wordmark on the left (acts as Home)
 * - Nav items in the centre (Notebook is disabled until a tab is open)
 * - Search ⌘K placeholder + avatar dropdown on the right
 *
 * Search behaviour is a Phase 8 follow-up — the input is intentionally inert
 * here so the chrome reads the same as the handoff without wiring an unused
 * command palette.
 */
export function FFNav({ user, currentStage, hasOpenNotebook, onNav, onLogout, onOpenSearch }: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const items: NavItemDef[] = [
    { id: 'home', label: t('nav.home'), icon: Home, visible: true, enabled: true },
    { id: 'browse', label: t('nav.files'), icon: FolderOpen, visible: true, enabled: true },
    { id: 'notebook', label: t('nav.notebook'), icon: FileText, visible: true, enabled: hasOpenNotebook },
    { id: 'settings', label: t('nav.settings'), icon: Settings, visible: true, enabled: true },
    { id: 'admin', label: t('nav.admin'), icon: Shield, visible: !!user?.is_admin, enabled: true },
  ];

  const displayName = user?.display_name || user?.username || '';
  const initial = displayName.slice(0, 1).toUpperCase() || '?';

  return (
    <header
      className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b"
      style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg)' }}
    >
      {/* Brand — clicking goes home */}
      <button
        onClick={() => onNav('home')}
        className="flex items-center gap-2 pr-3 mr-1"
        title={t('nav.home')}
      >
        <BrandMark size={22} className="text-text" />
        <Wordmark className="text-[15px]" />
      </button>

      {/* Nav items */}
      <nav className="flex items-center gap-0.5">
        {items.filter(it => it.visible).map(it => {
          const active = currentStage === it.id;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              disabled={!it.enabled}
              onClick={() => it.enabled && onNav(it.id)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium transition-colors
                ${active
                  ? 'bg-bg-hover text-text'
                  : it.enabled
                    ? 'text-text-muted hover:bg-bg-secondary hover:text-text-secondary'
                    : 'text-text-muted/40 cursor-not-allowed'}`}
              title={it.enabled ? it.label : `${it.label} — ${t('nav.openANotebookFirst')}`}
            >
              <Icon size={14} />
              {it.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Search ⌘K — opens the command palette. */}
      <button
        onClick={onOpenSearch}
        className="hidden md:flex items-center gap-2 h-8 w-[260px] px-3 rounded-lg text-[12px] hover:border-text-muted/40 transition-colors"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
      >
        <Search size={13} />
        <span className="flex-1 text-left">{t('nav.searchPlaceholder')}</span>
        <kbd
          className="px-1.5 py-0.5 rounded text-[10px] font-mono"
          style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
        >
          ⌘K
        </kbd>
      </button>

      {/* Avatar pill + dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="flex items-center gap-2 h-8 pl-1 pr-3 rounded-full hover:bg-bg-secondary transition-colors"
          title={displayName}
        >
          <span
            className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center"
            style={{ background: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
          >
            {initial}
          </span>
          <span className="text-[12px] text-text-secondary max-w-[12ch] truncate">{displayName}</span>
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-48 py-1 rounded-lg shadow-2xl shadow-black/60 z-50"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <p className="text-sm font-medium text-text truncate">{displayName}</p>
              <p className="text-[11px] text-text-muted">@{user?.username}</p>
            </div>
            {/* Settings and Admin live in the top-nav itself; the avatar
                dropdown stays focused on identity-bound actions (sign out,
                future profile/account-management) to avoid duplicating
                navigation entry points. */}
            <button
              onClick={() => { setMenuOpen(false); onLogout(); }}
              className="w-full text-left px-3 py-2 text-sm text-error hover:bg-error/10 flex items-center gap-2"
            >
              <LogOut size={14} /> {t('home.signOut')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
