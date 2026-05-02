import { useEffect, useState } from 'react';
import { TopBar } from '../toolbar/TopBar';
import { TabStrip } from '../toolbar/TabBar';
import { useTabStore } from '../../stores/tabStore';
import { Notebook } from '../notebook/Notebook';
import { SearchBar } from '../notebook/SearchBar';
import { ShortcutHelp } from '../ShortcutHelp';
import { ContextMenuHost } from '../ContextMenu';
import { Sidebar } from './Sidebar';
import { useUIStore } from '../../stores/uiStore';
import { useNotebookStore } from '../../stores/notebookStore';
import { api } from '../../services/api';
import { undo, redo } from '../../services/undoRedo';
import { broadcastSaved } from '../../services/collaboration';

function TabStripRow({ username }: { username: string }) {
  const tabs = useTabStore(s => s.tabs);
  if (tabs.length <= 1) return null;
  return (
    <div
      className="shrink-0"
      style={{
        height: 36,
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <TabStrip username={username} />
    </div>
  );
}

export function AppLayout({ onExport, onSwitchKernel, username }: {
  onExport: () => void; onSwitchKernel: () => void;
  username: string;
}) {
  const sidebarOpen = useUIStore(s => s.sidebarOpen);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);

  // auto-save (configurable interval)
  const autoSaveInterval = useUIStore(s => s.autoSaveInterval);
  useEffect(() => {
    if (autoSaveInterval <= 0) return;
    const timer = setInterval(() => {
      const { filePath, dirty, metadata, cells } = useNotebookStore.getState();
      if (!filePath || !dirty) return;
      api.saveNotebook(filePath, {
        metadata, nbformat: 4, nbformat_minor: 5,
        cells: cells.map(c => ({
          cell_type: c.cell_type, id: c.id, source: c.source, metadata: c.metadata,
          ...(c.cell_type === 'code' ? { outputs: c.outputs, execution_count: c.execution_count } : {}),
        })),
      }).then(() => { useNotebookStore.setState({ dirty: false }); broadcastSaved(); })
        .catch(() => {});
    }, autoSaveInterval * 1000);
    return () => clearInterval(timer);
  }, [autoSaveInterval]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+S save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const { filePath, metadata, cells, dirty } = useNotebookStore.getState();
        if (!filePath || !dirty) return;

        api.saveNotebook(filePath, {
          metadata,
          nbformat: 4,
          nbformat_minor: 5,
          cells: cells.map(c => ({
            cell_type: c.cell_type,
            id: c.id,
            source: c.source,
            metadata: c.metadata,
            ...(c.cell_type === 'code' ? {
              outputs: c.outputs,
              execution_count: c.execution_count,
            } : {}),
          })),
        }).then(() => {
          useNotebookStore.setState({ dirty: false });
          broadcastSaved();
        }).catch(err => {
          console.error('save failed:', err);
        });
      }

      // Ctrl+Z undo (not inside Monaco — Monaco has its own undo)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const inEditor = (e.target as HTMLElement)?.closest?.('.monaco-editor');
        if (!inEditor) { e.preventDefault(); undo(); }
        return;
      }
      // Ctrl+Y or Ctrl+Shift+Z redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        const inEditor = (e.target as HTMLElement)?.closest?.('.monaco-editor');
        if (!inEditor) { e.preventDefault(); redo(); }
        return;
      }

      // Ctrl+F search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }

      // ? → shortcut help (only when not typing in an editor/input)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement;
        if (!el.closest('.monaco-editor') && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setShortcutHelp(v => !v);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sidebarWidth = useUIStore(s => s.sidebarWidth);
  const sidebarSide = useUIStore(s => s.sidebarSide);

  // Sidebar width is the panel content; the 56px icon rail sits beside it,
  // so the total column reserved is panel + rail. We also clamp it on small
  // viewports so the notebook column always has at least ~360px to breathe —
  // the user's persisted width might be wider than what the current window
  // can sensibly accommodate (laptop docked into a 4K, then undocked, etc.).
  const sidebarEl = sidebarOpen && (
    <aside
      className="shrink-0 flex min-h-0"
      style={{
        width: sidebarWidth + 56,
        maxWidth: 'calc(100vw - 360px)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <Sidebar side={sidebarSide} />
    </aside>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Thin tab strip — only shown when 2+ notebooks are open. Sits above
          the notebook action header so it never has to fight kernel chip
          and action chips for horizontal space on narrow viewports. */}
      <TabStripRow username={username} />
      <TopBar onExport={onExport} onSwitchKernel={onSwitchKernel} />
      {searchOpen && <SearchBar onClose={() => setSearchOpen(false)} />}
      {shortcutHelp && <ShortcutHelp onClose={() => setShortcutHelp(false)} />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {sidebarSide === 'left' && sidebarEl}
        <main className="flex-1 min-w-0 overflow-y-auto" style={{ background: 'var(--color-bg)' }}>
          <Notebook />
        </main>
        {sidebarSide === 'right' && sidebarEl}
      </div>
      <ContextMenuHost />
    </div>
  );
}
