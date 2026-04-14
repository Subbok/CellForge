import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry } from '../services/api';
import type { Notebook } from '../lib/types';
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Plus, ArrowLeft, Settings, Upload, Pencil, Trash2, Share2, Archive, FolderPlus, Download } from 'lucide-react';

interface Props {
  onOpenNotebook: (path: string, notebook: Notebook) => void;
  onSettings?: () => void;
  onBack?: () => void;
}

export function Dashboard({ onOpenNotebook, onSettings, onBack }: Props) {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState(''); // relative path within notebook_dir
  const [_rootDir, setRootDir] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<'notebook' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const [shareUsers, setShareUsers] = useState<{ username: string; display_name: string }[]>([]);
  const [sharedFiles, setSharedFiles] = useState<{ from_user: string; file_name: string }[]>([]);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getConfig().then(cfg => setRootDir(cfg.notebook_dir)).catch(() => {});
  }, []);

  const loadFiles = useCallback(() => {
    setLoading(true);
    setError('');
    (cwd ? api.listFiles(cwd) : api.listFiles())
      .then(f => { setFiles(f); setLoading(false); })
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, [cwd]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { api.sharedFiles().then(setSharedFiles).catch(() => {}); }, []);

  function navigateUp() {
    const parts = cwd.split('/').filter(Boolean);
    parts.pop();
    setCwd(parts.join('/'));
  }

  function navigateInto(dir: string) {
    setCwd(dir);
  }

  async function openNotebook(path: string) {
    setError('');
    try {
      const nb = await api.getNotebook(path);
      onOpenNotebook(path, nb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // breadcrumb parts
  const crumbs = cwd ? cwd.split('/').filter(Boolean) : [];

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.files;
    if (!items.length) return;
    await api.uploadFiles(Array.from(items));
    loadFiles();
  }

  function toggleSelect(path: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function downloadSelected() {
    const blob = await api.downloadZip([...selected]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'files.zip';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openShareModal(path: string) {
    setShareTarget(path);
    api.shareUsers().then(setShareUsers).catch(() => {});
  }

  return (
    <div className="min-h-screen bg-bg relative"
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 600px 300px at 50% 0%, rgba(122,153,255,0.04), transparent)' }} />

      {/* header */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <>
                <button onClick={onBack} className="btn btn-sm btn-ghost gap-1.5">
                  <ArrowLeft size={14} /> {t('dashboard.home')}
                </button>
                <div className="w-px h-5 bg-border/50" />
              </>
            )}
            <FolderOpen size={16} className="text-accent" />
            <span className="font-semibold text-text text-sm tracking-tight">{t('dashboard.files')}</span>
          </div>
          {onSettings && (
            <button onClick={onSettings} className="btn btn-sm btn-ghost">
              <Settings size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="relative max-w-5xl mx-auto px-6 py-6">
        {/* breadcrumbs + actions */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-0.5 text-sm">
            {cwd && (
              <button onClick={navigateUp}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted mr-1">
                <ArrowLeft size={15} />
              </button>
            )}
            <button onClick={() => setCwd('')}
              className="px-2.5 py-1 rounded-lg hover:bg-bg-hover text-text-secondary font-medium text-xs">
              {t('dashboard.home')}
            </button>
            {crumbs.map((part, i) => {
              const path = crumbs.slice(0, i + 1).join('/');
              return (
                <span key={path} className="flex items-center gap-0.5">
                  <ChevronRight size={12} className="text-text-muted/50" />
                  <button onClick={() => setCwd(path)}
                    className="px-2.5 py-1 rounded-lg hover:bg-bg-hover text-text-secondary text-xs">
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <input ref={folderRef} type="file" className="hidden"
              {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
              onChange={async e => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) { await api.uploadFiles(files); loadFiles(); }
              }} />
            <input ref={uploadRef} type="file" accept=".ipynb,.zip" multiple className="hidden"
              onChange={async e => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                try {
                  await api.uploadFiles(files);
                  loadFiles();
                } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
                e.target.value = '';
              }} />
            <div className="relative">
              <button
                onClick={() => { setShowUploadMenu(v => !v); setShowNewMenu(false); }}
                className="btn btn-md btn-secondary rounded-xl"
              >
                <Upload size={14} /> {t('common.upload')} <ChevronDown size={11} />
              </button>
              {showUploadMenu && <div className="absolute right-0 mt-1 bg-bg-secondary/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl shadow-black/40 z-20 py-1.5 w-40">
                <button onClick={() => { uploadRef.current?.click(); setShowUploadMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg-hover flex items-center gap-2"><FileText size={14} /> {t('dashboard.files')}</button>
                <button onClick={() => { folderRef.current?.click(); setShowUploadMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg-hover flex items-center gap-2"><Folder size={14} /> {t('dashboard.folder')}</button>
              </div>}
            </div>
            <div className="relative">
              <button
                onClick={() => { setShowNewMenu(v => !v); setShowUploadMenu(false); }}
                className="btn btn-md btn-primary rounded-xl shadow-lg shadow-accent/15"
              >
                <Plus size={14} /> {t('dashboard.new')} <ChevronDown size={11} />
              </button>
              {showNewMenu && <div className="absolute right-0 mt-1 bg-bg-secondary/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl shadow-black/40 z-20 py-1.5 w-40">
                <button onClick={() => { setCreateModal('notebook'); setCreateName('Untitled.ipynb'); setShowNewMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg-hover flex items-center gap-2"><FileText size={14} /> {t('dashboard.notebook')}</button>
                <button onClick={() => { setCreateModal('folder'); setCreateName(''); setShowNewMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg-hover flex items-center gap-2"><FolderPlus size={14} /> {t('dashboard.folder')}</button>
              </div>}
            </div>
          </div>
        </div>

        {/* drag overlay */}
        {dragOver && (
          <div className="fixed inset-0 bg-accent/10 border-2 border-dashed border-accent rounded-3xl z-40 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Upload size={32} className="text-accent mx-auto mb-2" />
              <span className="text-accent text-lg font-medium">{t('dashboard.dropFilesHere')}</span>
            </div>
          </div>
        )}

        {/* multi-select toolbar */}
        {selected.size > 0 && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2.5 bg-accent/5 border border-accent/20 rounded-xl">
            <span className="text-xs text-accent font-medium">{t('dashboard.selectedCount', { count: selected.size })}</span>
            <button onClick={downloadSelected}
              className="text-xs px-2.5 py-1 text-accent hover:bg-accent/10 rounded-lg font-medium">{t('dashboard.downloadZip')}</button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs px-2.5 py-1 text-text-muted hover:bg-bg-hover rounded-lg">{t('common.clear')}</button>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-2.5 bg-error/10 border border-error/20 text-error text-xs rounded-xl">{error}</div>
        )}

        {/* file list */}
        {loading ? (
          <div className="text-center py-20 text-text-muted text-sm">{t('common.loading')}</div>
        ) : files.length === 0 ? (
          <div className="text-center py-20">
            <FolderOpen size={32} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-secondary font-medium">{t('dashboard.emptyDirectory')}</p>
            <p className="text-sm text-text-muted mt-1">{t('dashboard.createNotebookToStart')}</p>
          </div>
        ) : (
          <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
            {files.map(f => (
              <FileRow
                key={f.path}
                file={f}
                selected={selected.has(f.path)}
                onSelect={() => toggleSelect(f.path)}
                sharedBy={sharedFiles.find(s => s.file_name === f.name)?.from_user}
                onOpen={() => {
                  if (f.is_dir) navigateInto(f.path);
                  else if (f.name.endsWith('.ipynb')) openNotebook(f.path);
                }}
                onShare={() => openShareModal(f.path)}
                onDownload={!f.is_dir ? () => api.downloadFile(f.path).catch(e => setError(e.message)) : undefined}
                onExtract={f.name.endsWith('.zip') ? async () => {
                  try { await api.extractZip(f.path); loadFiles(); } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
                } : undefined}
                onRename={async (newName) => {
                  try { await api.renameFile(f.path, newName); loadFiles(); }
                  catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
                }}
                onDelete={() => setDeleteTarget(f)}
              />
            ))}
          </div>
        )}
      </div>

      {/* create modal */}
      {createModal && (
        <div className="modal-backdrop" onClick={() => setCreateModal(null)}>
          <div className="modal-panel w-[360px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text mb-4">
              {createModal === 'notebook' ? 'New notebook' : 'New folder'}
            </h3>
            <input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && createName.trim()) {
                  const name = createName.trim();
                  try {
                    if (createModal === 'folder') {
                      await api.createFolder(cwd ? `${cwd}/${name}` : name);
                    } else {
                      const nbName = name.endsWith('.ipynb') ? name : `${name}.ipynb`;
                      await api.createNotebook(cwd ? `${cwd}/${nbName}` : nbName);
                    }
                    loadFiles();
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('409')) {
                      setError('A notebook with this name already exists');
                    } else {
                      setError(msg);
                    }
                  }
                  setCreateModal(null);
                }
                if (e.key === 'Escape') setCreateModal(null);
              }}
              autoFocus
              onFocus={e => {
                const dot = createName.lastIndexOf('.');
                if (dot > 0) e.target.setSelectionRange(0, dot);
                else e.target.select();
              }}
              placeholder={createModal === 'notebook' ? 'notebook_name.ipynb' : 'folder_name'}
              className="field mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const name = createName.trim();
                  if (!name) return;
                  try {
                    if (createModal === 'folder') {
                      await api.createFolder(cwd ? `${cwd}/${name}` : name);
                    } else {
                      const nbName = name.endsWith('.ipynb') ? name : `${name}.ipynb`;
                      await api.createNotebook(cwd ? `${cwd}/${nbName}` : nbName);
                    }
                    loadFiles();
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('409')) {
                      setError('A notebook with this name already exists');
                    } else {
                      setError(msg);
                    }
                  }
                  setCreateModal(null);
                }}
                className="btn btn-md btn-primary flex-1"
              >
                {t('common.create')}
              </button>
              <button onClick={() => setCreateModal(null)} className="btn btn-md btn-ghost">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* share modal */}
      {shareTarget && (
        <div className="modal-backdrop" onClick={() => setShareTarget(null)}>
          <div className="modal-panel w-[360px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text mb-2">Share file</h3>
            <p className="text-xs text-text-muted mb-4">
              Select user to share <strong className="text-text">{shareTarget.split('/').pop()}</strong> with:
            </p>
            {shareUsers.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">No other users</p>
            ) : (
              <div className="space-y-1 mb-4">
                {shareUsers.map(u => (
                  <button key={u.username} onClick={async () => {
                    try {
                      await api.shareFile(shareTarget!, u.username);
                      setShareTarget(null);
                      setError(''); // clear any previous error
                    } catch (e: unknown) {
                      setError(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
                      setShareTarget(null);
                    }
                  }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-hover text-sm text-text transition-colors">
                    {u.display_name || u.username} <span className="text-text-muted">@{u.username}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShareTarget(null)} className="btn btn-md btn-ghost w-full">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal-panel w-[360px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text mb-2">Delete file</h3>
            <p className="text-sm text-text-muted mb-5">
              Are you sure you want to delete <strong className="text-text">{deleteTarget.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await api.deleteFile(deleteTarget.path);
                    setDeleteTarget(null);
                    loadFiles();
                  } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); setDeleteTarget(null); }
                }}
                className="btn btn-md btn-danger flex-1"
              >
                {t('common.delete')}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="btn btn-md btn-ghost">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow({ file, onOpen, onRename, onDelete, onShare, onExtract, onDownload, selected, onSelect, sharedBy }: {
  file: FileEntry;
  onOpen: () => void;
  onRename?: (newName: string) => void;
  onDelete?: () => void;
  onShare?: () => void;
  onExtract?: () => void;
  onDownload?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  sharedBy?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(file.name);
  const isNotebook = file.name.endsWith('.ipynb');
  const clickable = file.is_dir || isNotebook;

  function formatSize(bytes: number | null) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function commitRename() {
    setEditing(false);
    if (name.trim() && name !== file.name) onRename?.(name.trim());
    else setName(file.name);
  }

  return (
    <div className={`group flex items-center gap-2 px-5 py-3.5 transition-all ${
      clickable ? 'hover:bg-bg-hover/50 cursor-pointer' : 'opacity-40'
    }`}>
      {onSelect && (
        <input type="checkbox" checked={selected} onChange={onSelect}
          onClick={e => e.stopPropagation()}
          className="shrink-0" />
      )}
      <button onClick={clickable ? onOpen : undefined} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        {file.is_dir ? (
          <Folder size={16} className="text-warning shrink-0" />
        ) : isNotebook ? (
          <FileText size={16} className="text-accent shrink-0" />
        ) : (
          <FileText size={16} className="text-text-muted shrink-0" />
        )}
        {editing ? (
          <input value={name} onChange={e => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setName(file.name); setEditing(false); } }}
            autoFocus onClick={e => e.stopPropagation()}
            className="text-sm text-text bg-bg-elevated border border-accent rounded px-1 py-0.5 outline-none flex-1"
          />
        ) : (
          <span className="text-sm text-text flex-1 truncate">{file.name}</span>
        )}
      </button>
      {sharedBy && (
        <span className="text-[10px] text-accent shrink-0">from @{sharedBy}</span>
      )}
      {!editing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDownload && !file.is_dir && (
            <button onClick={e => { e.stopPropagation(); onDownload(); }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-success" title="Download">
              <Download size={14} />
            </button>
          )}
          {onExtract && (
            <button onClick={e => { e.stopPropagation(); onExtract(); }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-warning" title="Extract ZIP">
              <Archive size={14} />
            </button>
          )}
          {onShare && !sharedBy && (
            <button onClick={e => { e.stopPropagation(); onShare(); }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent" title="Share">
              <Share2 size={14} />
            </button>
          )}
          {onRename && (
            <button onClick={e => { e.stopPropagation(); setEditing(true); }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-secondary" title="Rename">
              <Pencil size={14} />
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-error" title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      <span className="text-xs text-text-muted shrink-0 text-right ml-1">{formatSize(file.size)}</span>
    </div>
  );
}
