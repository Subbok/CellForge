import { useEffect, useState } from 'react';
import { TopBar } from '../toolbar/TopBar';
import { TabBar } from '../toolbar/TabBar';
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

export function AppLayout({ onGoHome, onExport, onSwitchKernel }: {
  onGoHome: () => void; onExport: () => void; onSwitchKernel: () => void;
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

  return (
    <div className="flex flex-col h-screen min-h-0">
      <TopBar onGoHome={onGoHome} onExport={onExport} onSwitchKernel={onSwitchKernel} />
      <TabBar />
      {searchOpen && <SearchBar onClose={() => setSearchOpen(false)} />}
      {shortcutHelp && <ShortcutHelp onClose={() => setShortcutHelp(false)} />}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <main className="flex-1 min-w-0 overflow-y-auto bg-bg-secondary">
          <Notebook />
        </main>
        {sidebarOpen && (
          <aside
            className="shrink-0 border-l border-border/40 bg-bg-secondary flex min-h-0"
            style={{ width: sidebarWidth }}
          >
            <Sidebar />
          </aside>
        )}
      </div>
      <ContextMenuHost />
    </div>
  );
}
