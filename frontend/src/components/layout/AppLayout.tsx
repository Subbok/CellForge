import { useEffect, useState } from 'react';
import { TopBar } from '../toolbar/TopBar';
import { TabStrip } from '../toolbar/TabBar';
import { useTabStore } from '../../stores/tabStore';
import { Notebook } from '../notebook/Notebook';
import { DataViewer } from '../data/DataViewer';
import { TypstEditorView } from '../typst/TypstEditorView';
import { SearchBar } from '../notebook/SearchBar';
import { ShortcutHelp } from '../ShortcutHelp';
import { ContextMenuHost } from '../ContextMenu';
import { Sidebar } from './Sidebar';
import { useUIStore } from '../../stores/uiStore';
import { useNotebookStore } from '../../stores/notebookStore';
import { api } from '../../services/api';
import { undo, redo } from '../../services/undoRedo';
import { broadcastSaved } from '../../services/collaboration';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** Pick the right content view for the active tab. Notebook tabs fall back
 *  to the existing `Notebook` component (which reads from the notebook
 *  store), data tabs render a fresh `DataViewer` keyed by path so switching
 *  between two CSVs remounts cleanly. When no tabs are open we still render
 *  Notebook — it gracefully shows an empty state and that's also what
 *  freshly-opened sessions hit before the first file is picked. */
function ActiveTabContent() {
  const tabs = useTabStore(s => s.tabs);
  const activeId = useTabStore(s => s.activeTabId);
  const active = tabs.find(t => t.id === activeId);

  if (active?.kind === 'data') {
    return <DataViewer path={active.path} />;
  }
  if (active?.kind === 'typst') {
    return <TypstEditorView key={active.path} path={active.path} />;
  }
  return (
    <div className="h-full overflow-y-auto">
      <Notebook />
    </div>
  );
}

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
  const toggleSidebar = useUIStore(s => s.toggleSidebar);

  // <md flips the sidebar from a push-content flex sibling to a slide-in
  // drawer overlay — the notebook column on a 375px phone has no room to
  // surrender 300+ pixels of variables/files panel. Tailwind md breakpoint
  // is 768px, so the matchMedia query mirrors it (max-width 767).
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Desktop sidebar: persisted-width column docked left or right.
  // `maxWidth` keeps it from eating the notebook on narrow desktops (laptop
  // docked into a 4K, then undocked) — 4rem leaves room for the main area.
  const desktopSidebarEl = sidebarOpen && (
    <aside
      className="shrink-0 flex min-h-0"
      style={{
        width: sidebarWidth + 56,
        maxWidth: 'calc(100vw - 4rem)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <Sidebar side={sidebarSide} />
    </aside>
  );

  // Mobile drawer: fixed overlay with a backdrop. Right-side regardless of
  // `sidebarSide` preference — the toggle button lives in TopBar's right
  // corner, so anchoring the drawer there keeps the gesture intuitive.
  const mobileDrawer = isMobile && sidebarOpen && (
    <>
      <div
        className="fixed inset-0 z-30"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={toggleSidebar}
        aria-hidden
      />
      <aside
        className="fixed inset-y-0 right-0 z-40 flex min-h-0 shadow-2xl"
        style={{
          width: 'min(320px, calc(100vw - 3rem))',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <Sidebar side="right" />
      </aside>
    </>
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
        {!isMobile && sidebarSide === 'left' && desktopSidebarEl}
        <main className="flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
          <ActiveTabContent />
        </main>
        {!isMobile && sidebarSide === 'right' && desktopSidebarEl}
      </div>
      {mobileDrawer}
      <ContextMenuHost />
    </div>
  );
}
