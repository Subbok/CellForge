import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry } from '../services/api';
import type { Notebook } from '../lib/types';
import {
  Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Plus, Upload,
  Pencil, Trash2, Share2, Archive, FolderPlus, Download, Search, MoreVertical,
} from 'lucide-react';
import { ShareModal } from './ShareModal';
import { FFModalShell, FFInput } from './modals/FFModalShell';

interface Props {
  onOpenNotebook: (path: string, notebook: Notebook) => void;
  /** Called when the user clicks a tabular data file (CSV/TSV/etc.).
   *  Unlike notebook-open this skips the kernel-picker stage — data
   *  preview is read-only and doesn't need a kernel attached. */
  onOpenDataFile?: (path: string) => void;
}

export function Dashboard({ onOpenNotebook, onOpenDataFile }: Props) {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState('');
  const [_rootDir, setRootDir] = useState('');
  const [quota, setQuota] = useState<{ used_bytes: number; notebook_count: number; max_storage_mb: number } | null>(null);
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
  const [outboundShares, setOutboundShares] = useState<{ id: number; to_user: string }[]>([]);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [search, setSearch] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getConfig().then(cfg => setRootDir(cfg.notebook_dir)).catch(() => {});
    api.getQuota().then(setQuota).catch(() => setQuota(null));
  }, []);

  const loadFiles = useCallback(() => {
    setLoading(true);
    setError('');
    (cwd ? api.listFiles(cwd) : api.listFiles())
      .then(f => { setFiles(f); setLoading(false); })
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
    // Refresh quota in step with the listing — uploads/deletes/renames all
    // funnel through loadFiles, so this catches every mutation point.
    api.getQuota().then(setQuota).catch(() => {});
  }, [cwd]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { api.sharedFiles().then(setSharedFiles).catch(() => {}); }, []);

  // Prune selection on file list changes (delete, rename, navigation)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(prev => {
      const existing = new Set(files.map(f => f.path));
      const next = new Set<string>();
      for (const p of prev) if (existing.has(p)) next.add(p);
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  function navigateInto(dir: string) { setCwd(dir); }

  async function openNotebook(path: string) {
    setError('');
    try {
      const nb = await api.getNotebook(path);
      onOpenNotebook(path, nb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const crumbs = cwd ? cwd.split('/').filter(Boolean) : [];

  // Filter + sort: directories first, then alpha, then apply search filter.
  const visibleFiles = useMemo(() => {
    const s = search.trim().toLowerCase();
    const sorted = [...files].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (!s) return sorted;
    return sorted.filter(f => f.name.toLowerCase().includes(s));
  }, [files, search]);

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

  async function doCreate() {
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
      if (msg.includes('409')) setError('A notebook with this name already exists');
      else setError(msg);
    }
    setCreateModal(null);
  }

  return (
    <div className="h-full relative overflow-auto"
      style={{
        background: `
          radial-gradient(circle 800px at 100% 0%, rgba(167,139,250,0.08), transparent 60%),
          radial-gradient(circle 800px at 0% 100%, rgba(96,165,250,0.06), transparent 60%),
          var(--color-bg)
        `,
        zoom: 1.15,
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>

      <div className="relative max-w-5xl mx-auto" style={{ padding: '24px 32px' }}>
        {/* Page heading + subtitle */}
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <div>
            <h1 className="font-semibold" style={{ fontSize: 24, color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
              {t('home.workspace')}
            </h1>
            <p className="text-text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {cwd ? `~/${cwd}` : '~/workspace'}
              {' · '}
              {files.length} {files.length === 1 ? 'item' : 'items'}
              {quota && (
                <>
                  {' · '}
                  {quota.notebook_count} {quota.notebook_count === 1 ? 'notebook' : 'notebooks'}
                  {' · '}
                  {formatBytes(quota.used_bytes)} used
                  {quota.max_storage_mb > 0 && ` of ${formatBytes(quota.max_storage_mb * 1024 * 1024)}`}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Toolbar: breadcrumbs / search / actions */}
        <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-0.5 text-[13px] min-w-0 flex-1">
            <button onClick={() => setCwd('')}
              className="px-2 h-7 rounded-lg hover:bg-bg-hover text-text-secondary font-medium">
              {t('dashboard.home')}
            </button>
            {crumbs.map((part, i) => {
              const path = crumbs.slice(0, i + 1).join('/');
              return (
                <span key={path} className="flex items-center gap-0.5">
                  <ChevronRight size={12} className="text-text-muted/50" />
                  <button onClick={() => setCwd(path)}
                    className="px-2 h-7 rounded-lg hover:bg-bg-hover text-text-secondary truncate max-w-[18ch]">
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>

          {/* Search */}
          <div className="relative flex-1 max-w-[280px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('dashboard.searchFilesPlaceholder')}
              className="w-full h-8 pl-8 pr-2 rounded-lg bg-bg-secondary border border-border text-[12px] text-text outline-none placeholder:text-text-muted focus:border-accent transition-colors"
            />
          </div>

          {/* Hidden inputs for upload */}
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
              try { await api.uploadFiles(files); loadFiles(); }
              catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
              e.target.value = '';
            }} />

          {/* Upload dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowUploadMenu(v => !v); setShowNewMenu(false); }}
              className="btn btn-md btn-secondary"
            >
              <Upload size={13} /> {t('common.upload')} <ChevronDown size={11} />
            </button>
            {showUploadMenu && (
              <div className="absolute right-0 mt-1 z-30 py-1 w-44 rounded-lg shadow-2xl shadow-black/60"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <button onClick={() => { uploadRef.current?.click(); setShowUploadMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                  <FileText size={13} /> {t('dashboard.files')}
                </button>
                <button onClick={() => { folderRef.current?.click(); setShowUploadMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                  <Folder size={13} /> {t('dashboard.folder')}
                </button>
              </div>
            )}
          </div>

          {/* New dropdown */}
          <div className="relative">
            <button
              onClick={() => { setShowNewMenu(v => !v); setShowUploadMenu(false); }}
              className="btn btn-md btn-primary"
            >
              <Plus size={13} /> {t('dashboard.new')} <ChevronDown size={11} />
            </button>
            {showNewMenu && (
              <div className="absolute right-0 mt-1 z-30 py-1 w-44 rounded-lg shadow-2xl shadow-black/60"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <button onClick={() => { setCreateModal('notebook'); setCreateName('Untitled.ipynb'); setShowNewMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                  <FileText size={13} /> {t('dashboard.notebook')}
                </button>
                <button onClick={() => { setCreateModal('folder'); setCreateName(''); setShowNewMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                  <FolderPlus size={13} /> {t('dashboard.folder')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Drag overlay */}
        {dragOver && (
          <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none border-2 border-dashed rounded-lg"
            style={{ background: 'rgba(167,139,250,0.06)', borderColor: 'var(--color-accent)' }}>
            <div className="text-center">
              <Upload size={28} className="text-accent mx-auto mb-2" />
              <span className="text-accent text-base font-medium">{t('dashboard.dropFilesHere')}</span>
            </div>
          </div>
        )}

        {/* Multi-select toolbar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-accent/8 border border-accent/20"
            style={{ marginBottom: 12 }}>
            <span className="text-xs text-accent font-medium">{t('dashboard.selectedCount', { count: selected.size })}</span>
            <button onClick={downloadSelected}
              className="text-xs h-7 px-2.5 text-accent hover:bg-accent/15 rounded-lg font-medium">
              {t('dashboard.downloadZip')}
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs h-7 px-2.5 text-text-muted hover:bg-bg-hover rounded-lg">
              {t('common.clear')}
            </button>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 bg-error/10 border border-error/20 text-error text-xs rounded-lg"
            style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* File table */}
        <div className="overflow-hidden"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg, 10px)',
          }}>
          {/* Column headers — uppercase microlabel row, slightly lifted bg
              to mirror the JSX bg-2 separation. */}
          <div className="grid items-center text-[11px] font-medium uppercase tracking-[0.04em] text-text-muted"
            style={{
              gridTemplateColumns: '2.5rem 1fr 7rem 7rem 5rem 2.25rem',
              padding: '10px 18px',
              gap: 12,
              background: 'var(--color-bg-elevated)',
              borderBottom: '1px solid var(--color-border)',
            }}>
            <span></span>
            <span>{t('dashboard.colName')}</span>
            <span>{t('dashboard.colKernel')}</span>
            <span>{t('dashboard.colModified')}</span>
            <span>{t('dashboard.colSize')}</span>
            <span></span>
          </div>

          {loading ? (
            <div className="text-center py-16 text-text-muted text-sm">{t('common.loading')}</div>
          ) : visibleFiles.length === 0 ? (
            <div className="text-center py-16">
              <FolderOpen size={28} className="text-text-muted/30 mx-auto mb-3" />
              <p className="text-text-secondary font-medium">
                {search ? t('dashboard.noMatches') : t('dashboard.emptyDirectory')}
              </p>
              {!search && (
                <p className="text-sm text-text-muted mt-1">{t('dashboard.createNotebookToStart')}</p>
              )}
            </div>
          ) : (
            <div>
              {visibleFiles.map(f => (
                <FileRow
                  key={f.path}
                  file={f}
                  selected={selected.has(f.path)}
                  onSelect={() => toggleSelect(f.path)}
                  sharedBy={sharedFiles.find(s => s.file_name === f.name)?.from_user}
                  onOpen={() => {
                    if (f.is_dir) navigateInto(f.path);
                    else if (f.name.endsWith('.ipynb')) openNotebook(f.path);
                    else if (/\.(csv|tsv|json|jsonl|ndjson|parquet|pq)$/i.test(f.name)) onOpenDataFile?.(f.path);
                  }}
                  onShare={() => openShareModal(f.path)}
                  onDownload={!f.is_dir ? () => api.downloadFile(f.path).catch(e => setError(e.message)) : undefined}
                  onExtract={f.name.endsWith('.zip') ? async () => {
                    try { await api.extractZip(f.path); loadFiles(); }
                    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
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
      </div>

      {/* Create notebook / folder modal */}
      {createModal && (
        <FFModalShell
          title={createModal === 'notebook' ? 'New notebook' : 'New folder'}
          subtitle={
            createModal === 'notebook'
              ? 'Create a reactive notebook in the current directory.'
              : `Create a new folder in ${cwd ? '~/' + cwd : 'workspace root'}.`
          }
          width={480}
          primaryLabel={createModal === 'notebook' ? 'Create notebook' : 'Create folder'}
          primaryDisabled={!createName.trim()}
          onClose={() => setCreateModal(null)}
          onPrimary={doCreate}
        >
          <FFInput
            label={createModal === 'notebook' ? 'Notebook name' : 'Folder name'}
            value={createName}
            onChange={setCreateName}
            placeholder={createModal === 'notebook' ? 'protein-folding-v4' : 'experiments'}
            mono
            autoFocus
            onEnter={() => { if (createName.trim()) void doCreate(); }}
            hint={createModal === 'notebook'
              ? `Will be saved as ${createName.trim().endsWith('.ipynb') ? createName.trim() : `${createName.trim() || 'untitled'}.ipynb`}`
              : undefined}
          />
        </FFModalShell>
      )}

      {/* Share modal */}
      {shareTarget && (
        <ShareModal
          fileName={shareTarget.split('/').pop()!}
          filePath={shareTarget}
          shareUsers={shareUsers}
          outboundShares={outboundShares}
          onClose={() => setShareTarget(null)}
          onError={setError}
          onRefresh={async () => {
            const fname = shareTarget.split('/').pop()!;
            try { setOutboundShares(await api.sharesByMe(fname)); }
            catch { setOutboundShares([]); }
          }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <FFModalShell
          title={`Delete ${deleteTarget.is_dir ? 'folder' : 'file'}?`}
          subtitle={`${deleteTarget.name} · ${deleteTarget.is_dir ? 'all contents will be removed' : 'this cannot be undone'}.`}
          width={440}
          primaryLabel={t('common.delete')}
          danger
          onClose={() => setDeleteTarget(null)}
          onPrimary={async () => {
            try {
              await api.deleteFile(deleteTarget.path);
              setDeleteTarget(null);
              loadFiles();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : String(e));
              setDeleteTarget(null);
            }
          }}
        >
          <div className="flex" style={{
            gap: 10, padding: 12,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 7,
            fontSize: 12, color: '#fca5a5',
          }}>
            <span>
              Removing <span className="font-mono" style={{ color: 'var(--color-text)' }}>{deleteTarget.name}</span>
              {deleteTarget.is_dir
                ? ' will delete the folder and everything it contains.'
                : ' is permanent — there is no trash.'}
            </span>
          </div>
        </FFModalShell>
      )}
    </div>
  );
}

/** Compact byte-count rendering shared with the page subtitle. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Compact "X min/h/d ago" / "yesterday" rendering for file mtimes.
 *  Same UTC-normalisation trick as Home's timeAgo — backend serialises mtime
 *  as a bare ISO string without a Z suffix on some Linux setups. */
function formatRelative(iso: string): string {
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  const normalized = hasTz ? iso : iso.replace(' ', 'T') + 'Z';
  const ms = Date.now() - new Date(normalized).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(normalized).toLocaleDateString();
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
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(file.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isNotebook = file.name.endsWith('.ipynb');
  const isData = /\.(csv|tsv|json|jsonl|ndjson|parquet|pq)$/i.test(file.name);
  const clickable = file.is_dir || isNotebook || isData;

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggleMenu() {
    if (menuOpen) { setMenuOpen(false); return; }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuW = 176;
      const menuH = 220;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuH ? rect.bottom + 4 : Math.max(8, rect.top - menuH - 4);
      const left = Math.max(8, rect.right - menuW);
      setMenuPos({ top, left });
    }
    setMenuOpen(true);
  }

  function formatSize(bytes: number | null) {
    if (bytes == null) return '—';
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
    <div
      className={`group grid items-center text-[13px] transition-colors ${
        clickable ? 'hover:bg-bg-hover cursor-pointer' : ''
      }`}
      style={{
        gridTemplateColumns: '2.5rem 1fr 7rem 7rem 5rem 2.25rem',
        padding: '11px 18px',
        gap: 12,
        borderTop: '1px solid var(--color-border-subtle)',
      }}
      onClick={() => clickable && !editing && onOpen()}
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
        {onSelect && (
          <input type="checkbox" checked={selected} onChange={onSelect} className="shrink-0" />
        )}
      </div>

      {/* Name with icon — folder icon in accent matches JSX */}
      <div className="flex items-center gap-2.5 min-w-0">
        {file.is_dir ? (
          <Folder size={16} className="text-accent shrink-0" />
        ) : isNotebook ? (
          <FileText size={16} className="text-accent shrink-0" />
        ) : (
          <FileText size={16} className="text-text-secondary shrink-0" />
        )}
        {editing ? (
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setName(file.name); setEditing(false); }
            }}
            autoFocus
            onClick={e => e.stopPropagation()}
            className="text-[13px] text-text bg-bg-elevated border border-accent rounded px-1.5 py-0.5 outline-none flex-1 min-w-0"
          />
        ) : (
          <div className="flex flex-col min-w-0">
            <span className="text-text truncate">{file.name}</span>
            {sharedBy && (
              <span className="text-[10px] text-text-muted truncate" style={{ marginTop: 1 }}>
                shared by <span className="text-accent">@{sharedBy}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Kernel — from notebook metadata.kernelspec; "—" for non-notebooks
          and notebooks that never recorded a kernel. */}
      <span className="text-text-muted truncate" style={{ fontSize: 12 }} title={file.kernelspec ?? undefined}>
        {file.kernelspec
          ?? (file.is_dir ? '' : (file.cell_count != null ? `${file.cell_count} cells` : '—'))}
      </span>

      {/* Modified — relative time from mtime */}
      <span className="text-text-muted" style={{ fontSize: 12 }}
        title={file.modified ?? undefined}>
        {file.modified ? formatRelative(file.modified) : '—'}
      </span>

      {/* Size */}
      <span className="text-text-muted" style={{ fontSize: 12 }}>{formatSize(file.size)}</span>

      {/* Kebab menu — dropdown rendered via portal so it escapes the table's
          overflow:hidden and doesn't get clipped on the bottom-most rows. */}
      <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="More actions"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            className="fixed py-1 w-44 rounded-lg shadow-2xl shadow-black/60"
            style={{
              top: menuPos.top, left: menuPos.left, zIndex: 60,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {onShare && !sharedBy && (
              <button onClick={() => { setMenuOpen(false); onShare(); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                <Share2 size={13} /> Share
              </button>
            )}
            {onDownload && (
              <button onClick={() => { setMenuOpen(false); onDownload(); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                <Download size={13} /> Download
              </button>
            )}
            {onExtract && (
              <button onClick={() => { setMenuOpen(false); onExtract(); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                <Archive size={13} /> {t('dashboard.extractZip')}
              </button>
            )}
            {onRename && (
              <button onClick={() => { setMenuOpen(false); setEditing(true); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2">
                <Pencil size={13} /> {t('dashboard.rename')}
              </button>
            )}
            {onDelete && (
              <>
                <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} className="my-1" />
                <button onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-error hover:bg-error/10 flex items-center gap-2">
                  <Trash2 size={13} /> {t('common.delete')}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
