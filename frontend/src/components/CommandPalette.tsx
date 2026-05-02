import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Search, FileText, Plus, Home, FolderOpen, Settings as SettingsIcon, Shield, LogOut,
  Play, RotateCcw, Save, Eraser, Download, Cpu, Square,
} from 'lucide-react';
import { api } from '../services/api';
import type { Notebook } from '../lib/types';

export interface PaletteCommand {
  id: string;
  label: string;
  kind: 'cmd';
  icon: typeof Home;
  shortcut?: string;
  visible: boolean;
  run(): void | Promise<void>;
}

/** Subset of notebook actions the palette can invoke when the editor is
 *  the active stage. Caller wires real handlers; if undefined the command
 *  is hidden from the palette. */
export interface NotebookActions {
  runAllCells?: () => void;
  clearAllOutputs?: () => void;
  restartKernel?: () => void;
  saveNotebook?: () => void;
  exportPdf?: () => void;
  switchKernel?: () => void;
  interrupt?: () => void;
}

export interface PaletteNotebook {
  id: string;          // file_path, used for filtering and as key
  label: string;       // file name (last path segment)
  sub: string;         // folder
  kind: 'nav';
  icon: typeof FileText;
  run(): void | Promise<void>;
}

type Item = PaletteCommand | PaletteNotebook;

interface Props {
  open: boolean;
  onClose: () => void;
  user: { username: string; is_admin: boolean } | null;
  /** Mount only items relevant to the current stage (e.g. omit "Go home" when home). */
  currentStage: 'home' | 'browse' | 'notebook' | 'settings' | 'admin';
  recent: { file_path: string; last_opened: string }[];
  onNav(stage: 'home' | 'browse' | 'settings' | 'admin'): void;
  onLogout(): void;
  onOpenNotebook(path: string, nb: Notebook): void;
  onNewNotebook(): void | Promise<void>;
  /** Notebook-only actions; only surfaced when `currentStage === 'notebook'`. */
  notebookActions?: NotebookActions;
}

/**
 * Command palette — keyboard-driven launcher for navigation, quick actions
 * and recent notebooks. Triggered by ⌘K / Ctrl+K from anywhere; populates
 * its action list from the surrounding app handlers so we don't grow a
 * global event bus just for this.
 */
export function CommandPalette({
  open, onClose, user, currentStage, recent,
  onNav, onLogout, onOpenNotebook, onNewNotebook,
  notebookActions,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state on each open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // focus next tick so the autoFocus fires after portal mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const allItems: Item[] = useMemo(() => {
    const inNotebook = currentStage === 'notebook';
    const nb = notebookActions ?? {};
    const cmds: PaletteCommand[] = [
      // Notebook-context actions surface FIRST when in the editor — that's
      // where the user reaches for the palette mid-flow (run / restart / save).
      {
        id: 'nb-run-all', label: t('palette.cmdRunAll'), kind: 'cmd' as const, icon: Play,
        shortcut: '⌘⇧↵',
        visible: inNotebook && !!nb.runAllCells,
        run: () => nb.runAllCells?.(),
      },
      {
        id: 'nb-clear', label: t('palette.cmdClearOutputs'), kind: 'cmd' as const, icon: Eraser,
        visible: inNotebook && !!nb.clearAllOutputs,
        run: () => nb.clearAllOutputs?.(),
      },
      {
        id: 'nb-restart', label: t('palette.cmdRestartKernel'), kind: 'cmd' as const, icon: RotateCcw,
        visible: inNotebook && !!nb.restartKernel,
        run: () => nb.restartKernel?.(),
      },
      {
        id: 'nb-interrupt', label: t('palette.cmdInterrupt'), kind: 'cmd' as const, icon: Square,
        visible: inNotebook && !!nb.interrupt,
        run: () => nb.interrupt?.(),
      },
      {
        id: 'nb-save', label: t('palette.cmdSaveNotebook'), kind: 'cmd' as const, icon: Save,
        shortcut: '⌘S',
        visible: inNotebook && !!nb.saveNotebook,
        run: () => nb.saveNotebook?.(),
      },
      {
        id: 'nb-export', label: t('palette.cmdExportPdf'), kind: 'cmd' as const, icon: Download,
        visible: inNotebook && !!nb.exportPdf,
        run: () => nb.exportPdf?.(),
      },
      {
        id: 'nb-switch-kernel', label: t('palette.cmdSwitchKernel'), kind: 'cmd' as const, icon: Cpu,
        visible: inNotebook && !!nb.switchKernel,
        run: () => nb.switchKernel?.(),
      },

      // Cross-stage navigation
      {
        id: 'home', label: t('palette.cmdGoHome'), kind: 'cmd' as const, icon: Home,
        visible: currentStage !== 'home',
        run: () => onNav('home'),
      },
      {
        id: 'browse', label: t('palette.cmdBrowseFiles'), kind: 'cmd' as const, icon: FolderOpen,
        visible: currentStage !== 'browse',
        run: () => onNav('browse'),
      },
      {
        id: 'new-notebook', label: t('palette.cmdNewNotebook'), kind: 'cmd' as const, icon: Plus,
        visible: true,
        run: onNewNotebook,
      },
      {
        id: 'settings', label: t('palette.cmdOpenSettings'), kind: 'cmd' as const, icon: SettingsIcon,
        visible: currentStage !== 'settings',
        run: () => onNav('settings'),
      },
      {
        id: 'admin', label: t('palette.cmdOpenAdmin'), kind: 'cmd' as const, icon: Shield,
        visible: !!user?.is_admin && currentStage !== 'admin',
        run: () => onNav('admin'),
      },
      {
        id: 'logout', label: t('palette.cmdLogout'), kind: 'cmd' as const, icon: LogOut,
        visible: true,
        run: onLogout,
      },
    ].filter(c => c.visible);

    const navItems: PaletteNotebook[] = recent.slice(0, 8).map(r => ({
      id: r.file_path,
      label: r.file_path.split('/').pop() ?? 'Untitled',
      sub: r.file_path.includes('/') ? r.file_path.slice(0, r.file_path.lastIndexOf('/')) : '',
      kind: 'nav' as const,
      icon: FileText,
      async run() {
        try {
          const nb = await api.getNotebook(r.file_path);
          onOpenNotebook(r.file_path, nb);
        } catch { /* ignored — palette closes regardless */ }
      },
    }));

    return [...cmds, ...navItems];
  }, [t, user, currentStage, recent, onNav, onLogout, onOpenNotebook, onNewNotebook, notebookActions]);

  // Filter
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(it => {
      if (it.label.toLowerCase().includes(q)) return true;
      if (it.kind === 'nav' && it.sub.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [allItems, query]);

  // Clamp active index when items change
  useEffect(() => {
    setActiveIdx(i => Math.max(0, Math.min(i, items.length - 1)));
  }, [items.length]);

  // Keyboard handling
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => (items.length === 0 ? 0 : (i + 1) % items.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[activeIdx];
        if (item) {
          onClose();
          // run after close to avoid React state thrash inside event handler
          requestAnimationFrame(() => { void item.run(); });
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, activeIdx, onClose]);

  // Scroll active row into view as user navigates
  useEffect(() => {
    if (!listRef.current) return;
    const row = listRef.current.querySelector<HTMLDivElement>(`[data-idx="${activeIdx}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center"
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
          marginTop: '14vh',
          width: 560,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 10px)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          animation: 'ff-modal-panel-in 200ms ease-out',
        }}
      >
        {/* Search row */}
        <div className="flex items-center" style={{
          gap: 10, padding: '14px 18px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <Search size={15} className="text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('palette.placeholder')}
            className="flex-1 bg-transparent outline-none text-text"
            style={{ fontSize: 14 }}
          />
          <span className="font-mono uppercase" style={{
            padding: '2px 6px', fontSize: 10, borderRadius: 3,
            background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)',
          }}>esc</span>
        </div>

        {/* Items */}
        <div ref={listRef} style={{ padding: 6, maxHeight: 360, overflow: 'auto' }}>
          {items.length === 0 ? (
            <div className="text-center text-text-muted" style={{ padding: '32px 0', fontSize: 12 }}>
              {t('palette.noResults')}
            </div>
          ) : (
            items.map((it, i) => {
              const Icon = it.icon;
              const active = i === activeIdx;
              return (
                <div
                  key={`${it.kind}:${it.id}`}
                  data-idx={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    onClose();
                    requestAnimationFrame(() => { void it.run(); });
                  }}
                  className="flex items-center cursor-pointer transition-colors"
                  style={{
                    gap: 12, padding: '8px 12px', borderRadius: 6,
                    background: active ? 'var(--color-bg-hover)' : 'transparent',
                  }}
                >
                  <Icon size={14} style={{
                    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    flexShrink: 0,
                  }} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontSize: 13, color: 'var(--color-text)' }}>
                      {it.label}
                    </div>
                    {it.kind === 'nav' && it.sub && (
                      <div className="truncate" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {it.sub}
                      </div>
                    )}
                  </div>
                  <span className="uppercase" style={{
                    fontSize: 10, color: 'var(--color-text-muted)',
                  }}>
                    {it.kind === 'cmd' ? t('palette.kindCmd') : t('palette.kindNav')}
                  </span>
                  {it.kind === 'cmd' && it.shortcut && (
                    <span className="font-mono" style={{
                      padding: '2px 6px', fontSize: 10, borderRadius: 3,
                      background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)',
                    }}>{it.shortcut}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex font-mono" style={{
          padding: '8px 14px', gap: 14, fontSize: 10,
          background: 'var(--color-bg)',
          borderTop: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-muted)',
        }}>
          <span>{t('palette.footerNav')}</span>
          <span>{t('palette.footerSelect')}</span>
          <span>{t('palette.footerToggle')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
