import { useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, FolderOpen } from 'lucide-react';
import { api } from '../services/api';
import { BrandMark } from './brand/BrandMark';
import { langColor } from '../lib/languages';
import type { Notebook } from '../lib/types';

interface DashboardData {
  username: string;
  display_name: string;
  is_admin: boolean;
  stats: { recent_notebooks_count: number; running_kernels_count: number; shared_files_count: number; online_count: number };
  recent_notebooks: { file_path: string; last_opened: string }[];
  shared_files: { id: number; from_user: string; file_name: string; shared_at: string }[];
  running_kernels: { id: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number; started_at: string }[];
  online_others: string[];
}

interface KernelInfo {
  id: string;
  kernel_spec: string;
  language: string;
  notebook_path: string | null;
  status: string;
  memory_mb: number;
  started_at?: string;
}

interface Props {
  onOpenNotebook: (path: string, nb: Notebook) => void;
  onBrowseFiles: () => void;
}

function timeAgo(iso: string): string {
  // SQLite CURRENT_TIMESTAMP serialises UTC as "YYYY-MM-DD HH:MM:SS" with no
  // timezone marker, which JS parses as local time. Force UTC interpretation
  // by replacing the space with 'T' and appending 'Z' when no offset is
  // present, otherwise the "X minutes ago" reading is off by the user's
  // timezone offset.
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  const normalized = hasTz ? iso : iso.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
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

/** Stat card from the 4-card top row. */
function StatCard({ label, value, sub, dotColor }: {
  label: string;
  value: string | number;
  sub: string;
  dotColor: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg, 10px)',
      }}
    >
      <div className="flex items-center gap-2 text-text-muted" style={{ fontSize: 12 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        {label}
      </div>
      <div className="font-semibold" style={{ fontSize: 28, color: 'var(--color-text)', marginTop: 10, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      <div className="text-text-muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** A 1.6fr / 1fr panel section header. */
function PanelHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header
      className="flex items-center justify-between"
      style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--color-text)', fontWeight: 600 }}>{title}</div>
      {action}
    </header>
  );
}

export function HomeDashboard({ onOpenNotebook, onBrowseFiles }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [kernels, setKernels] = useState<KernelInfo[]>([]);
  const [events, setEvents] = useState<{ id: number; ts: string; actor: string; kind: string; target: string; meta: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    // Loaders inlined here (instead of useCallback at component scope) so
    // react-hooks/set-state-in-effect can see that every setState happens
    // *after* an `await`, not synchronously in the effect body. The functions
    // weren't used anywhere else in the component, so nothing else loses
    // access to them.
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const d = await api.getDashboard();
        if (cancelled) return;
        setData(d);
        setKernels(d.running_kernels.map(k => ({
          id: k.id, kernel_spec: k.kernel_spec, language: k.language,
          notebook_path: k.notebook_path, status: k.status, memory_mb: k.memory_mb,
          started_at: k.started_at,
        })));
        setError('');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const pollKernels = async () => {
      try {
        const ks = await api.getDashboardKernels();
        if (!cancelled) setKernels(ks);
      } catch { /* ignored */ }
    };

    const loadActivity = async () => {
      try {
        const ev = await api.getActivity();
        if (!cancelled) setEvents(ev);
      } catch { /* feed is optional, don't propagate */ }
    };

    loadDashboard();
    loadActivity();
    pollRef.current = setInterval(() => {
      pollKernels();
      loadActivity();
    }, 5000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function openRecent(path: string) {
    try { const nb = await api.getNotebook(path); onOpenNotebook(path, nb); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function newNotebook() {
    try {
      const res = await api.createNotebook();
      const nb = await api.getNotebook(res.path);
      onOpenNotebook(res.path, nb);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // Activity feed: prefer the real backend `activity_events` stream — it
  // already encodes who-did-what across share / open / kernel-start /
  // create-user. Falls back to a synthesised view derived from
  // `recent_notebooks + kernels.started_at + shared_files.shared_at` so a
  // brand-new workspace (no events logged yet) still has something useful.
  interface Evt { kind: 'opened' | 'kernel' | 'shared' | 'created_user'; when: string; what: string; lang?: string; from?: string; selfActor: boolean }
  const myUsername = data?.username ?? '';
  const activity = useMemo(() => {
    if (events.length > 0) {
      return events
        .map(e => {
          const selfActor = e.actor === myUsername;
          if (e.kind === 'shared') {
            // The backend records shares as actor=sharer, target=recipient,
            // meta=file_name. Display flips depending on viewer.
            return {
              kind: 'shared' as const,
              when: e.ts,
              what: e.meta || e.target,
              from: selfActor ? e.target : e.actor,
              selfActor,
            };
          }
          if (e.kind === 'kernel_started') {
            return {
              kind: 'kernel' as const,
              when: e.ts,
              what: e.target.split('/').pop() ?? e.target,
              lang: e.meta,
              selfActor,
            };
          }
          if (e.kind === 'created_user') {
            return {
              kind: 'created_user' as const,
              when: e.ts,
              what: e.target,
              selfActor,
            };
          }
          // default: 'opened'
          return {
            kind: 'opened' as const,
            when: e.ts,
            what: e.target.split('/').pop() ?? e.target,
            selfActor,
          };
        })
        .slice(0, 8);
    }
    // Fallback synthesis (workspace with no logged events yet).
    const out: Evt[] = [];
    for (const r of data?.recent_notebooks ?? []) {
      out.push({ kind: 'opened', when: r.last_opened, what: r.file_path?.split('/').pop() ?? 'Untitled', selfActor: true });
    }
    for (const k of kernels) {
      if (k.started_at) {
        out.push({
          kind: 'kernel', when: k.started_at,
          what: k.notebook_path?.split('/').pop() ?? k.kernel_spec,
          lang: k.language, selfActor: true,
        });
      }
    }
    for (const s of data?.shared_files ?? []) {
      if (s.shared_at) {
        out.push({ kind: 'shared', when: s.shared_at, what: s.file_name, from: s.from_user, selfActor: false });
      }
    }
    const ts = (iso: string) => {
      const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
      return new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z').getTime();
    };
    return out.sort((a, b) => ts(b.when) - ts(a.when)).slice(0, 6);
  }, [events, data, kernels, myUsername]);

  if (loading) {
    return (
      <div className="h-full bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="text-accent animate-pulse">
            <BrandMark size={28} />
          </div>
          <span className="text-sm text-text-muted">{t('home.loadingWorkspace')}</span>
        </div>
      </div>
    );
  }

  const recent = (data?.recent_notebooks ?? []).slice(0, 6);
  const sharedCount = data?.shared_files.length ?? 0;
  const totalMem = kernels.reduce((acc, k) => acc + (k.memory_mb || 0), 0);
  const langs = Array.from(new Set(kernels.map(k => k.language).filter(Boolean)));
  const sharers = new Set((data?.shared_files ?? []).map(s => s.from_user));
  const displayName = data?.display_name || data?.username || 'user';
  // Map filename → owner username for the shared-from chip on Recent rows.
  const sharedBy = new Map((data?.shared_files ?? []).map(s => [s.file_name, s.from_user]));

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-[1100px] mx-auto" style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 32px) 48px' }}>
        {/* Greeting + actions */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between" style={{ marginBottom: 28 }}>
          <div>
            <div className="font-semibold" style={{ fontSize: 30, color: 'var(--color-text)', letterSpacing: '-0.025em' }}>
              {t(greetingKey())}, {displayName}
            </div>
            <div className="text-text-muted" style={{ fontSize: 14, marginTop: 4 }}>
              {kernels.length} {kernels.length === 1 ? 'kernel' : 'kernels'} running
              {data && data.stats.online_count > 1 && (
                <> · {data.stats.online_count - 1} {data.stats.online_count - 1 === 1 ? 'collaborator' : 'collaborators'} online</>
              )}
              {recent[0] && (
                <> · last opened {timeAgo(recent[0].last_opened)}</>
              )}
            </div>
          </div>
          <div className="flex" style={{ gap: 8 }}>
            <button
              onClick={onBrowseFiles}
              style={{
                padding: '8px 14px',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                color: 'var(--color-text)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('home.openFile')}
            </button>
            <button
              onClick={newNotebook}
              style={{
                padding: '8px 14px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 8,
                color: 'var(--color-accent-fg)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + {t('home.newNotebook')}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-[12px] rounded-lg" style={{
            marginBottom: 16, padding: '8px 12px',
            background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)',
            color: 'var(--color-error)',
          }}>
            {error}
          </div>
        )}

        {/* 4-stat grid */}
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 12, marginBottom: 28 }}>
          <StatCard
            label={t('home.statActiveKernels')}
            value={kernels.length}
            sub={langs.length > 0 ? langs.slice(0, 3).join(', ') : '—'}
            dotColor="var(--color-success)"
          />
          <StatCard
            label={t('home.statMemoryInUse')}
            value={totalMem >= 1024 ? `${(totalMem / 1024).toFixed(1)} GB` : `${totalMem} MB`}
            sub={t('home.memOfKernels', { count: kernels.length })}
            dotColor="var(--color-accent)"
          />
          <StatCard
            label={t('home.statNotebooks')}
            value={data?.stats.recent_notebooks_count ?? 0}
            sub={t('home.sharedSub', { count: sharedCount })}
            dotColor="var(--color-info)"
          />
          <StatCard
            label={t('home.statSharedWithMe')}
            value={sharedCount}
            sub={t('home.fromPeople', { count: sharers.size })}
            dotColor="#a78bfa"
          />
        </div>

        {/* 2-column on md+, stacked on mobile so each panel gets full width */}
        <div className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr] gap-5">
          {/* Recent notebooks */}
          <section
            className="overflow-hidden"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
            }}
          >
            <PanelHeader
              title={t('home.recentNotebooks')}
              action={recent.length > 0 ? (
                <button onClick={onBrowseFiles}
                  className="text-text-muted hover:text-text"
                  style={{ fontSize: 12, cursor: 'pointer' }}>
                  {t('home.viewAll')} →
                </button>
              ) : undefined}
            />
            {recent.length === 0 ? (
              <div className="text-center" style={{ padding: '40px 18px' }}>
                <FileText size={20} className="mx-auto mb-2 text-text-muted/40" />
                <p className="text-[13px] text-text-muted">{t('home.noRecent')}</p>
                <button onClick={newNotebook}
                  className="mt-3"
                  style={{
                    padding: '6px 12px', borderRadius: 8,
                    background: 'var(--color-accent)', color: 'var(--color-accent-fg)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                  }}>
                  + {t('home.newNotebook')}
                </button>
              </div>
            ) : (
              recent.map((r, i) => {
                const fname = r.file_path?.split('/').pop() ?? 'Untitled';
                const folder = r.file_path?.includes('/') ? r.file_path.slice(0, r.file_path.lastIndexOf('/')) : '';
                const ext = fname.split('.').pop() ?? '';
                const owner = sharedBy.get(fname);
                return (
                  <button
                    key={r.file_path}
                    onClick={() => openRecent(r.file_path)}
                    className="w-full text-left hover:bg-bg-hover transition-colors grid grid-cols-[36px_1fr_100px] md:grid-cols-[36px_1fr_140px_100px] items-center"
                    style={{
                      padding: '12px 18px',
                      borderTop: i ? '1px solid var(--color-border-subtle)' : 'none',
                      cursor: 'pointer',
                      background: 'transparent',
                      border: 'none',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: owner ? 'rgba(167,139,250,0.12)' : 'var(--color-bg-hover)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11,
                      color: owner ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    }}>
                      <FileText size={13} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate flex items-center gap-1.5" style={{ fontSize: 13, color: 'var(--color-text)' }}>
                        <span className="truncate">{fname}</span>
                        {owner && (
                          <span style={{
                            padding: '1px 6px', borderRadius: 4,
                            background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                            color: 'var(--color-accent)',
                            fontSize: 10, fontWeight: 500,
                            flexShrink: 0,
                          }}>
                            @{owner}
                          </span>
                        )}
                      </div>
                      {folder && (
                        <div className="truncate" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{folder}</div>
                      )}
                    </div>
                    <div className="hidden md:block">
                      <span style={{
                        padding: '2px 8px', borderRadius: 4,
                        background: 'var(--color-bg-hover)',
                        fontSize: 11, color: 'var(--color-text-secondary)',
                      }}>{ext || 'file'}</span>
                    </div>
                    <div className="text-right text-text-muted" style={{ fontSize: 11 }}>{timeAgo(r.last_opened)}</div>
                  </button>
                );
              })
            )}
          </section>

          {/* Activity */}
          <section
            className="overflow-hidden"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
            }}
          >
            <PanelHeader
              title={t('home.activity')}
              action={kernels.length > 0 ? (
                <span className="flex items-center gap-1.5" style={{ fontSize: 11 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <span className="text-success font-medium">{kernels.length} {t('home.live')}</span>
                </span>
              ) : undefined}
            />
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activity.length === 0 ? (
                <p className="text-[12px] text-text-muted text-center" style={{ padding: '24px 0' }}>
                  {t('home.noActivity')}
                </p>
              ) : (
                activity.map((evt, i) => {
                  const color = evt.kind === 'kernel'
                    ? langColor(evt.lang ?? '')
                    : evt.kind === 'shared'
                      ? 'var(--color-warning)'
                      : 'var(--color-accent)';
                  // Avatar identifies the actor: incoming shares show the
                  // sharer; everything else (including outgoing shares the
                  // viewer initiated) uses the viewer's initial.
                  const subjectName = (evt.kind === 'shared' && !evt.selfActor)
                    ? (evt.from ?? '?')
                    : (displayName || 'Y');
                  const initial = subjectName.slice(0, 1).toUpperCase();
                  const action =
                    evt.kind === 'opened' ? t('home.evtOpened')
                      : evt.kind === 'kernel' ? t('home.evtKernelStarted')
                        : evt.kind === 'created_user' ? t('home.evtCreatedUser')
                          : evt.selfActor ? t('home.evtSharedWith')
                            : t('home.evtSharedWithYou');
                  // Outgoing shares display the recipient's @username;
                  // incoming ones display the file name. created_user shows
                  // the new account's @username.
                  const targetLabel = evt.kind === 'shared' && evt.selfActor
                    ? `@${evt.from ?? evt.what}`
                    : evt.kind === 'created_user'
                      ? `@${evt.what}`
                      : evt.what;
                  // Subject text: "You" for self-actor events; "@actor" for
                  // events someone else triggered (incoming shares).
                  const subjectLabel = (evt.kind === 'shared' && !evt.selfActor)
                    ? `@${evt.from ?? '?'}`
                    : t('home.you');
                  return (
                    <div key={i} className="flex items-start" style={{ gap: 10 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: color, color: '#1a1815',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 600,
                        flexShrink: 0,
                      }}>
                        {initial}
                      </div>
                      <div className="flex-1 min-w-0" style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--color-text)' }}>{subjectLabel}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}> {action} </span>
                        <span style={{ color: 'var(--color-accent)' }}>{targetLabel}</span>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                          {timeAgo(evt.when)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Empty workspace nudge if there's truly nothing */}
        {recent.length === 0 && kernels.length === 0 && (
          <div className="text-center" style={{ marginTop: 32 }}>
            <button onClick={onBrowseFiles}
              className="inline-flex items-center gap-2 text-text-muted hover:text-text"
              style={{ fontSize: 13 }}>
              <FolderOpen size={14} />
              {t('home.browseFiles')}
            </button>
            <span className="mx-2 text-text-muted/40">·</span>
            <span className="inline-flex items-center gap-1 text-text-muted" style={{ fontSize: 13 }}>
              <Plus size={14} />
              {t('home.createToStart')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
