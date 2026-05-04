import { useEffect, useState } from 'react';
import { api, type FileEntry } from '../../services/api';
import { useNotebookStore } from '../../stores/notebookStore';
import { useTabStore } from '../../stores/tabStore';
import { useUIStore } from '../../stores/uiStore';
import { saveCurrentTab } from '../../services/tabManager';
import { Folder, FileText, RefreshCw } from 'lucide-react';

export function SidebarFiles() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [cwd, setCwd] = useState('');
  const refreshToken = useUIStore(s => s.filesRefreshToken);
  const bumpFilesRefresh = useUIStore(s => s.bumpFilesRefresh);

  useEffect(() => {
    (cwd ? api.listFiles(cwd) : api.listFiles())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [cwd, refreshToken]);

  async function openNotebook(path: string) {
    try {
      const nb = await api.getNotebook(path);
      const name = path.split('/').pop() ?? 'Untitled';

      // save current tab before switching
      saveCurrentTab();

      // load new notebook
      useNotebookStore.getState().loadNotebook(path, nb);
      useTabStore.getState().addTab(path, name);

      // update URL
      window.history.pushState(null, '', `/notebook/${encodeURIComponent(path)}`);
    } catch (e) {
      console.error('failed to open:', e);
    }
  }

  function openDataFile(path: string) {
    // Data tabs don't load anything synchronously — DataViewer fetches the
    // first page on mount. We still call saveCurrentTab so a dirty notebook
    // doesn't get silently dropped when the user clicks a CSV from the
    // sidebar mid-edit.
    saveCurrentTab();
    const name = path.split('/').pop() ?? 'data';
    useTabStore.getState().addDataTab(path, name);
  }

  /** Returns the tab kind we should open for a given filename, or null when
   *  it isn't a previewable type. Centralised so the predicate matches the
   *  click handler exactly. */
  function tabKindFor(name: string): 'notebook' | 'data' | null {
    const lower = name.toLowerCase();
    if (lower.endsWith('.ipynb')) return 'notebook';
    if (
      lower.endsWith('.csv') ||
      lower.endsWith('.tsv') ||
      lower.endsWith('.json') ||
      lower.endsWith('.jsonl') ||
      lower.endsWith('.ndjson') ||
      lower.endsWith('.parquet') ||
      lower.endsWith('.pq')
    ) {
      return 'data';
    }
    return null;
  }

  const crumbs = cwd.split('/').filter(Boolean);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1 mb-2 text-text-muted flex-wrap">
        <button onClick={() => setCwd('')} className="hover:text-accent">~</button>
        {crumbs.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}
              className="hover:text-accent">{part}</button>
          </span>
        ))}
        <div className="flex-1" />
        <button
          onClick={bumpFilesRefresh}
          title="Refresh"
          className="p-1 rounded hover:text-accent hover:bg-accent/10"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {cwd && (
        <button
          onClick={() => setCwd(crumbs.slice(0, -1).join('/'))}
          className="w-full text-left px-2 py-1.5 rounded hover:bg-bg-hover text-text-muted"
        >..</button>
      )}

      {files.map(f => {
        const kind = f.is_dir ? null : tabKindFor(f.name);
        const openable = f.is_dir || kind != null;
        return (
          <button
            key={f.path}
            onClick={() => {
              if (f.is_dir) setCwd(f.path);
              else if (kind === 'notebook') openNotebook(f.path);
              else if (kind === 'data') openDataFile(f.path);
            }}
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
              openable ? 'hover:bg-bg-hover cursor-pointer' : 'opacity-40'
            }`}
          >
            {f.is_dir
              ? <Folder size={13} className="text-warning shrink-0" />
              : <FileText size={13} className={`shrink-0 ${kind === 'notebook' ? 'text-accent' : kind === 'data' ? 'text-success' : 'text-text-muted'}`} />}
            <span className="truncate">{f.name}</span>
          </button>
        );
      })}

      {files.length === 0 && (
        <p className="text-text-muted py-4 text-center">Empty</p>
      )}
    </div>
  );
}
