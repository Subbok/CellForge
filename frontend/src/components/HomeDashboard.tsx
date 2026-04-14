import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Cpu, Share2, Clock, Square, Plus, FolderOpen, Anvil, Settings, Shield, LogOut, Zap, X } from 'lucide-react';
import { api } from '../services/api';
import type { Notebook } from '../lib/types';

interface DashboardData {
  username: string;
  display_name: string;
  is_admin: boolean;
  stats: { recent_notebooks_count: number; running_kernels_count: number; shared_files_count: number };
  recent_notebooks: { file_path: string; last_opened: string }[];
  shared_files: { id: number; from_user: string; file_name: string }[];
  running_kernels: { id: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number; started_at: string }[];
}

interface KernelInfo {
  id: string;
  kernel_spec: string;
  language: string;
  notebook_path: string | null;
  status: string;
  memory_mb: number;
}

interface Props {
  onOpenNotebook: (path: string, nb: Notebook) => void;
  onBrowseFiles: () => void;
  onSettings: () => void;
  onAdmin?: () => void;
  onLogout?: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 6) return 'home.goodNight';
  if (h < 12) return 'home.goodMorning';
  if (h < 18) return 'home.goodAfternoon';
  return 'home.goodEvening';
}

const LANG_COLORS: Record<string, string> = {
  python: '#7aa2f7',
  r: '#2d7dca',
  julia: '#9558b2',
};

export function HomeDashboard({ onOpenNotebook, onBrowseFiles, onSettings, onAdmin, onLogout }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [kernels, setKernels] = useState<KernelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const loadDashboard = useCallback(async () => {
    try {
      const d = await api.getDashboard();
      setData(d);
      setKernels(d.running_kernels.map(k => ({
        id: k.id, kernel_spec: k.kernel_spec, language: k.language,
        notebook_path: k.notebook_path, status: k.status, memory_mb: k.memory_mb,
      })));
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const pollKernels = useCallback(async () => {
    try { setKernels(await api.getDashboardKernels()); } catch { /* ignored */ }
  }, []);

  useEffect(() => {
    loadDashboard();
    pollRef.current = setInterval(pollKernels, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadDashboard, pollKernels]);

  // close user menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const stopKernel = useCallback(async (id: string) => {
    try { await api.stopKernel(id); await pollKernels(); await loadDashboard(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }, [pollKernels, loadDashboard]);

  async function openRecent(path: string) {
    try { const nb = await api.getNotebook(path); onOpenNotebook(path, nb); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Anvil size={22} className="text-accent animate-pulse" />
          </div>
          <span className="text-sm text-text-muted">{t('home.loadingWorkspace')}</span>
        </div>
      </div>
    );
  }

  const stats = data?.stats ?? { recent_notebooks_count: 0, running_kernels_count: 0, shared_files_count: 0 };
  const displayName = data?.display_name || data?.username || 'user';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-bg relative overflow-auto">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 800px 400px at 50% 0%, rgba(122,153,255,0.06), transparent)' }} />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
              <Anvil size={18} className="text-accent" />
            </div>
            <span className="font-semibold text-text text-sm tracking-tight">CellForge</span>
          </div>
          <div className="flex items-center gap-1" ref={menuRef}>
            {/* User avatar / menu */}
            <div className="relative ml-1">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="w-8 h-8 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center hover:bg-accent/25 transition-colors"
                title={displayName}
              >
                {initials}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded-xl shadow-2xl shadow-black/40 py-1 w-44 z-50">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium text-text truncate">{displayName}</p>
                    <p className="text-[11px] text-text-muted">@{data?.username}</p>
                  </div>
                  <button onClick={() => { setShowUserMenu(false); onSettings(); }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover flex items-center gap-2">
                    <Settings size={14} /> {t('common.settings')}
                  </button>
                  {onAdmin && (
                    <button onClick={() => { setShowUserMenu(false); onAdmin(); }}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover flex items-center gap-2">
                      <Shield size={14} /> {t('home.adminPanel')}
                    </button>
                  )}
                  {onLogout && (
                    <button onClick={() => { setShowUserMenu(false); onLogout(); }}
                      className="w-full text-left px-3 py-2 text-sm text-error hover:bg-error/10 flex items-center gap-2">
                      <LogOut size={14} /> {t('home.signOut')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="relative max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-bold text-text tracking-tight">
            {t(greetingKey())}, {displayName}
          </h1>
          <p className="text-sm text-text-muted mt-1">{t('home.workspaceSubtitle')}</p>
        </div>

        {error && (
          <div className="px-4 py-2.5 bg-error/10 border border-error/20 text-error text-xs rounded-xl">{error}</div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="group bg-bg-secondary/60 border border-border/50 rounded-2xl p-5 hover:border-accent/30 transition-all duration-300 cursor-default">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/15 transition-colors">
                <FileText size={18} className="text-accent" />
              </div>
            </div>
            <p className="text-2xl font-bold text-text">{stats.recent_notebooks_count}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('home.recentNotebooks')}</p>
          </div>
          <div className="group bg-bg-secondary/60 border border-border/50 rounded-2xl p-5 hover:border-success/30 transition-all duration-300 cursor-default">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center group-hover:bg-success/15 transition-colors">
                <Zap size={18} className="text-success" />
              </div>
              {kernels.length > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] text-success font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  {t('home.live')}
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-text">{kernels.length}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('home.runningKernels')}</p>
          </div>
          <div className="group bg-bg-secondary/60 border border-border/50 rounded-2xl p-5 hover:border-warning/30 transition-all duration-300 cursor-default">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center group-hover:bg-warning/15 transition-colors">
                <Share2 size={18} className="text-warning" />
              </div>
            </div>
            <p className="text-2xl font-bold text-text">{stats.shared_files_count}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('home.sharedWithMe')}</p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-3">
          <button onClick={onBrowseFiles}
            className="btn btn-md btn-secondary gap-2 rounded-xl hover:border-border transition-all">
            <FolderOpen size={15} /> {t('home.browseFiles')}
          </button>
          <button
            onClick={async () => {
              try {
                const res = await api.createNotebook();
                const nb = await api.getNotebook(res.path);
                onOpenNotebook(res.path, nb);
              } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
            }}
            className="btn btn-md btn-primary gap-2 rounded-xl shadow-lg shadow-accent/15 hover:shadow-accent/25 active:scale-[0.98] transition-all">
            <Plus size={15} /> {t('home.newNotebook')}
          </button>
        </div>

        {/* Recent notebooks */}
        {data && data.recent_notebooks.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('home.recentNotebooks')}</h2>
              <button onClick={onBrowseFiles} className="text-xs text-accent hover:text-accent-hover transition-colors">
                {t('home.viewAll')}
              </button>
            </div>
            <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
              {data.recent_notebooks.map(n => (
                <button
                  key={n.file_path}
                  onClick={() => openRecent(n.file_path)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-bg-hover/50 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/8 flex items-center justify-center group-hover:bg-accent/12 transition-colors">
                    <FileText size={15} className="text-accent" />
                  </div>
                  <span className="text-sm text-text flex-1 truncate font-medium">
                    {n.file_path?.split('/').pop() ?? 'Untitled'}
                  </span>
                  <span className="text-[11px] text-text-muted shrink-0 flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Clock size={11} /> {timeAgo(n.last_opened)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Shared with me */}
        {data && data.shared_files.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('home.sharedWithMe')}</h2>
            <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
              {data.shared_files.map((s, i) => (
                <div key={`${s.from_user}-${s.file_name}-${i}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-bg-hover/50 transition-all group">
                  <button
                    onClick={() => s.file_name.endsWith('.ipynb') ? openRecent(s.file_name) : undefined}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <div className="w-8 h-8 rounded-lg bg-warning/8 flex items-center justify-center group-hover:bg-warning/12 transition-colors">
                      <Share2 size={15} className="text-warning" />
                    </div>
                    <span className="text-sm text-text flex-1 truncate font-medium">{s.file_name}</span>
                    <span className="text-[11px] text-text-muted">{t('home.fromUser', { username: s.from_user })}</span>
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api.unshareFile(s.id).catch(() => {});
                      loadDashboard();
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-all"
                    title={t('home.removeShare')}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Running kernels */}
        {kernels.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('home.runningKernels')}</h2>
            <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
              {kernels.map(k => {
                const langColor = LANG_COLORS[k.language?.toLowerCase()] ?? '#7aa2f7';
                return (
                  <div key={k.id} className="flex items-center gap-3 px-5 py-3.5 group">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${langColor}12` }}>
                        <Cpu size={15} style={{ color: langColor }} />
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-secondary ${k.status === 'busy' ? 'bg-warning animate-pulse' : 'bg-success'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text block truncate font-medium">
                        {k.notebook_path?.split('/').pop() ?? k.kernel_spec}
                      </span>
                      <div className="flex items-center gap-2 text-[11px] text-text-muted">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{ backgroundColor: `${langColor}15`, color: langColor }}>
                          {k.language}
                        </span>
                        <span>{k.status}</span>
                        <span>{k.memory_mb > 0 ? `${k.memory_mb} MB` : ''}</span>
                      </div>
                    </div>
                    <button onClick={() => stopKernel(k.id)}
                      className="opacity-0 group-hover:opacity-100 btn btn-sm btn-ghost text-error hover:bg-error/10 transition-all"
                      title={t('home.stopKernel')}>
                      <Square size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {data && data.recent_notebooks.length === 0 && kernels.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-accent/8 flex items-center justify-center mx-auto mb-4">
              <Anvil size={32} className="text-accent/40" />
            </div>
            <p className="text-text-secondary font-medium">{t('home.workspaceEmpty')}</p>
            <p className="text-sm text-text-muted mt-1">{t('home.createToStart')}</p>
            <button
              onClick={async () => {
                try {
                  const res = await api.createNotebook();
                  const nb = await api.getNotebook(res.path);
                  onOpenNotebook(res.path, nb);
                } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
              }}
              className="btn btn-md btn-primary gap-2 rounded-xl mt-4 shadow-lg shadow-accent/15">
              <Plus size={15} /> {t('home.createNotebook')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
