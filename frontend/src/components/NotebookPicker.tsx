import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { FileText, FolderOpen, Plus } from 'lucide-react';
import type { Notebook } from '../lib/types';

interface Props {
  onOpen: (path: string, notebook: Notebook) => void;
}

export function NotebookPicker({ onOpen }: Props) {
  const [notebooks, setNotebooks] = useState<{ name: string; path: string }[]>([]);
  const [dir, setDir] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const openAbsolute = useCallback(async (path: string) => {
    setError('');
    try {
      const nb = await api.openNotebookPath(path);
      onOpen(path, nb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onOpen]);

  useEffect(() => {
    Promise.all([api.getConfig(), api.listNotebooks()])
      .then(([cfg, nbs]) => {
        setDir(cfg.notebook_dir);
        setNotebooks(nbs);

        // if server was started with a specific file, open it right away
        if (cfg.initial_notebook) {
          openAbsolute(cfg.initial_notebook);
          return;
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [openAbsolute]);

  async function openRelative(path: string) {
    setError('');
    try {
      const nb = await api.getNotebook(path);
      onOpen(path, nb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createNew() {
    try {
      const entry = await api.createNotebook();
      const nb = await api.getNotebook(entry.path);
      onOpen(entry.path, nb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return (
      <div className="modal-backdrop">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel w-[520px] max-h-[80vh] flex flex-col">
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-text">Open a notebook</h2>
          <p className="text-xs text-text-muted mt-1">{dir}</p>
        </div>

        {error && (
          <div className="mx-4 mb-2 px-3 py-2 bg-error/10 text-error text-xs rounded">
            {error}
          </div>
        )}

        <div className="px-4 pb-2 overflow-y-auto flex-1">
          {/* notebooks in working dir */}
          {notebooks.length > 0 && (
            <div className="space-y-1 mb-3">
              {notebooks.map(nb => (
                <button
                  key={nb.path}
                  onClick={() => openRelative(nb.path)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left
                    hover:bg-bg-hover border border-transparent hover:border-border transition-all"
                >
                  <FileText size={16} className="text-accent shrink-0" />
                  <span className="text-sm text-text truncate">{nb.name}</span>
                </button>
              ))}
            </div>
          )}

          {notebooks.length === 0 && (
            <p className="text-xs text-text-muted py-4 text-center">
              No notebooks in working directory.
            </p>
          )}

          {/* open from path */}
          <div className="border-t border-border pt-3 mt-1">
            <label className="text-xs text-text-muted block mb-1.5">
              Or enter a path:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPath}
                onChange={e => setCustomPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && customPath) openAbsolute(customPath); }}
                placeholder="/home/user/notebook.ipynb"
                className="field flex-1"
              />
              <button
                onClick={() => customPath && openAbsolute(customPath)}
                disabled={!customPath}
                className="btn btn-md btn-primary shrink-0"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* new notebook */}
        <div className="px-4 pb-4 pt-2 border-t border-border shrink-0">
          <button onClick={createNew} className="btn btn-lg btn-secondary w-full">
            <Plus size={16} />
            New notebook
          </button>
        </div>
      </div>
    </div>
  );
}
