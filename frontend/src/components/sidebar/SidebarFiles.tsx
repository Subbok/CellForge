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
        const isNb = f.name.endsWith('.ipynb');
        return (
          <button
            key={f.path}
            onClick={() => {
              if (f.is_dir) setCwd(f.path);
              else if (isNb) openNotebook(f.path);
            }}
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
              f.is_dir || isNb ? 'hover:bg-bg-hover cursor-pointer' : 'opacity-40'
            }`}
          >
            {f.is_dir
              ? <Folder size={13} className="text-warning shrink-0" />
              : <FileText size={13} className={`shrink-0 ${isNb ? 'text-accent' : 'text-text-muted'}`} />}
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
