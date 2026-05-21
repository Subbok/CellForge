import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import {
  RefreshCw, Square, Trash2, Cpu, Plus, Layers, MoreVertical, Settings2, Search, Shield, Key,
} from 'lucide-react';
import { langColor } from '../lib/languages';
import { FFModalShell, FFInput, FFSelect } from './modals/FFModalShell';
import { useUIStore } from '../stores/uiStore';

interface AdminStats { user_count: number; total_kernels: number; total_memory_mb: number; }
interface AdminUser {
  username: string;
  display_name: string;
  is_admin: boolean;
  /** True only for the workspace bootstrap admin (`id == 1`). */
  is_super_admin: boolean;
  created_at: string;
  /** Username of the admin who created this account; empty for the bootstrap admin. */
  created_by: string;
  /** ISO timestamp of the last authenticated request, or null if never seen. */
  last_seen_at: string | null;
  kernel_count: number;
  /** Number of `.ipynb` files in the user's workspace. */
  notebook_count: number;
  /** Total bytes consumed by everything under the workspace dir. */
  storage_bytes: number;
}
interface AdminGroup { name: string; description: string; max_kernels_per_user: number; max_memory_mb_per_user: number; }
interface AdminKernel { id: string; username: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number; cpu_pct: number; }

/** Avatar palette cycled by row index — matches the JSX FFAdmin renderer. */
const AVATAR_PALETTE = ['#ffaa3b', '#7ec4cf', '#b39ddb', '#a6c780', '#e8a87c', '#cba6f7'];

/** Ratio bar — used for CPU / MEM cells in the Members table. */
function FFBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v > 70 ? '#f87171' : v > 40 ? 'var(--color-accent)' : '#4ade80';
  return (
    <div className="flex items-center" style={{ gap: 6, marginBottom: 2 }}>
      <span style={{ width: 28, fontSize: 10, color: 'var(--color-text-muted)' }}>{label}</span>
      <div style={{
        flex: 1, maxWidth: 80, height: 4,
        background: 'var(--color-bg-hover)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${v}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ width: 28, fontSize: 10, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
        {v}%
      </span>
    </div>
  );
}

/** Compact byte count rendering — shared between Admin storage tooltip and
 *  the Files page subtitle. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  const normalized = hasTz ? iso : iso.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  if (Number.isNaN(diff) || diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Stat card — matches the JSX FFAdmin pattern (label, big number, colored sub). */
function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub: string; color: string;
}) {
  return (
    <div style={{
      padding: 16,
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg, 10px)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
      <div className="font-semibold" style={{
        fontSize: 26, color: 'var(--color-text)',
        marginTop: 6, letterSpacing: '-0.02em',
      }}>{value}</div>
      <div style={{ fontSize: 11, color, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function AdminPanel({ callerIsSuperAdmin }: { callerIsSuperAdmin: boolean }) {
  const { t } = useTranslation();
  // Hub mode gates the advanced sections (groups + per-group resource
  // limits + running kernels monitor). Basic user CRUD stays visible
  // either way so a small deployment can still add/disable/reset users
  // from the UI without `--hub`.
  const hubMode = useUIStore(s => s.hubMode);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [kernels, setKernels] = useState<AdminKernel[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupMaxKernels, setNewGroupMaxKernels] = useState('3');
  const [newGroupMaxMemory, setNewGroupMaxMemory] = useState('2048');
  const [showNewGroup, setShowNewGroup] = useState(false);

  const [editUser, setEditUser] = useState<string | null>(null);
  const [editMaxKernels, setEditMaxKernels] = useState('');
  const [editMaxMemory, setEditMaxMemory] = useState('');
  const [editMaxStorage, setEditMaxStorage] = useState('');
  const [editGroup, setEditGroup] = useState('');

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [createError, setCreateError] = useState('');

  // Change-password modal — admin can reset any user's password.
  // The bootstrap super-admin can reset anyone including admins.
  const [pwUser, setPwUser] = useState<string | null>(null);
  const [pwNew, setPwNew] = useState('');
  const [pwError, setPwError] = useState('');

  // Delete-user confirm modal — destructive operation, separate state so
  // the kebab can pop the dialog on the right username and the body can
  // surface what's being removed (account row, workspace dir, sessions).
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const refresh = useCallback(async () => {
    setError('');
    try {
      // Stats + users are always available (basic admin surface). Groups +
      // kernels live behind require_hub middleware and 403 in non-hub mode.
      // Promise.all fail-fasts on any rejection, so calling all four
      // unconditionally would 403-out the whole batch and leave the
      // Members table empty for non-hub admins. Gate the hub-only calls.
      const [s, u] = await Promise.all([api.getAdminStats(), api.getAdminUsers()]);
      setStats(s); setUsers(u);
      if (hubMode) {
        const [g, k] = await Promise.all([api.getAdminGroups(), api.getAdminKernels()]);
        setGroups(g); setKernels(k);
      } else {
        setGroups([]); setKernels([]);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [hubMode]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      // Don't close if clicking the trigger that opened the current menu
      // (those bind their own toggle handler).
      for (const btn of triggerRefs.current.values()) {
        if (btn.contains(target)) return;
      }
      setOpenMenu(null);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggleMenu(username: string) {
    if (openMenu === username) { setOpenMenu(null); return; }
    const btn = triggerRefs.current.get(username);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const menuW = 176;
      const menuH = 80;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= menuH ? rect.bottom + 4 : Math.max(8, rect.top - menuH - 4);
      const left = Math.max(8, rect.right - menuW);
      setMenuPos({ top, left });
    }
    setOpenMenu(username);
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await api.createAdminGroup({
        name, description: newGroupDesc.trim() || undefined,
        max_kernels_per_user: Number(newGroupMaxKernels) || 3,
        max_memory_mb_per_user: Number(newGroupMaxMemory) || 2048,
      });
      setNewGroupName(''); setNewGroupDesc(''); setShowNewGroup(false);
      flash(`Group "${name}" created`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function deleteGroup(name: string) {
    try { await api.deleteAdminGroup(name); flash(`Group "${name}" deleted`); await refresh(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function stopKernel(id: string) {
    try { await api.adminStopKernel(id); flash('Kernel stopped'); await refresh(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function stopAllIdle() {
    try { const r = await api.adminStopAllIdle(); flash(`Stopped ${r.stopped} idle kernel(s)`); await refresh(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function createUser() {
    setCreateError('');
    const username = newUsername.trim();
    if (!username || !newPassword) {
      setCreateError('Username and password are required');
      return;
    }
    try {
      await api.adminCreateUser({
        username,
        password: newPassword,
        display_name: newDisplayName.trim() || undefined,
        role: newRole,
      });
      setShowCreateUser(false);
      flash(`User @${username} created${newRole === 'admin' ? ' as admin' : ''}`);
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Map backend HTTP statuses to friendlier copy. The api wrapper throws
      // with the response body so 409/400 fall here.
      if (msg.includes('409')) setCreateError('Username already taken');
      else if (msg.includes('400')) setCreateError('Username and password must be valid (≥2 / ≥8 chars)');
      else setCreateError(msg);
    }
  }

  async function changeRole(username: string, makeAdmin: boolean) {
    setOpenMenu(null);
    try {
      await api.updateAdminUser(username, { is_admin: makeAdmin });
      flash(makeAdmin ? `@${username} promoted to admin` : `@${username} demoted to user`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeUserPassword() {
    if (!pwUser || pwNew.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    try {
      const res = await api.changePassword(pwNew, pwUser);
      if (res.ok) {
        flash(`Password for @${pwUser} changed`);
        setPwUser(null); setPwNew(''); setPwError('');
      } else {
        setPwError(res.error ?? 'Change failed');
      }
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmDeleteMember() {
    if (!deleteTarget) return;
    const username = deleteTarget.username;
    try {
      const res = await api.deleteUser(username);
      if (!res.ok) {
        setError(`Delete failed (${res.status})`);
        setDeleteTarget(null);
        return;
      }
      flash(`@${username} deleted`);
      setDeleteTarget(null);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleteTarget(null);
    }
  }

  async function saveUserLimits() {
    if (!editUser) return;
    try {
      await api.updateAdminUser(editUser, {
        max_kernels: editMaxKernels ? Number(editMaxKernels) : undefined,
        max_memory_mb: editMaxMemory ? Number(editMaxMemory) : undefined,
        max_storage_mb: editMaxStorage ? Number(editMaxStorage) : undefined,
        group_name: editGroup || undefined,
      });
      setEditUser(null); flash(`Limits updated for ${editUser}`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // Per-user MEM and CPU derived from currently running kernel sessions.
  // CPU is summed across the user's kernels and clamped to 100 since each
  // session's value is already normalised to whole-machine.
  const memByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of kernels) m.set(k.username, (m.get(k.username) ?? 0) + (k.memory_mb || 0));
    return m;
  }, [kernels]);
  const cpuByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of kernels) m.set(k.username, (m.get(k.username) ?? 0) + (k.cpu_pct || 0));
    return m;
  }, [kernels]);

  const filteredUsers = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u =>
      u.username.toLowerCase().includes(s) ||
      (u.display_name && u.display_name.toLowerCase().includes(s)),
    );
  }, [users, search]);

  if (loading) {
    return <div className="h-full bg-bg flex items-center justify-center text-text-muted text-sm">{t('admin.loadingAdmin')}</div>;
  }

  return (
    <div className="h-full overflow-auto relative" style={{
      background: `
        radial-gradient(circle 800px at 100% 0%, rgba(167,139,250,0.08), transparent 60%),
        radial-gradient(circle 800px at 0% 100%, rgba(96,165,250,0.06), transparent 60%),
        var(--color-bg)
      `,
    }}>
      <div className="max-w-[1100px] mx-auto" style={{ padding: 'clamp(16px, 4vw, 32px)' }}>
        {/* Page heading + subtitle + refresh */}
        <div className="flex items-start justify-between" style={{ marginBottom: 24 }}>
          <div>
            <h1 className="font-semibold" style={{
              fontSize: 28, color: 'var(--color-text)', letterSpacing: '-0.025em',
            }}>
              {t('admin.title')}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              {t('admin.subtitle')}
            </p>
          </div>
          <button onClick={refresh} className="btn btn-sm btn-secondary gap-1.5">
            <RefreshCw size={13} /> {t('common.refresh')}
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="text-[12px] rounded-lg" style={{
            marginBottom: 12, padding: '8px 12px',
            background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)',
            color: 'var(--color-error)',
          }}>{error}</div>
        )}
        {success && (
          <div className="text-[12px] rounded-lg" style={{
            marginBottom: 12, padding: '8px 12px',
            background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.20)',
            color: 'var(--color-success)',
          }}>{success}</div>
        )}

        {/* 4-stat grid */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 12, marginBottom: 28 }}>
            <StatCard
              label={t('admin.totalUsers')}
              value={stats.user_count}
              sub={t('admin.subPerWeek')}
              color="#4ade80"
            />
            <StatCard
              label={t('admin.activeSessions')}
              value={stats.total_kernels}
              sub={t('admin.subSession')}
              color="#60a5fa"
            />
            <StatCard
              label={t('admin.totalMemory')}
              value={stats.total_memory_mb >= 1024
                ? `${(stats.total_memory_mb / 1024).toFixed(1)} GB`
                : `${stats.total_memory_mb} MB`}
              sub={`${stats.total_kernels} ${t('admin.kernels').toLowerCase()}`}
              color="var(--color-accent)"
            />
            <StatCard
              label={t('admin.groups')}
              value={groups.length}
              sub={`${groups.reduce((a, g) => a + g.max_memory_mb_per_user, 0)} MB max/user`}
              color="#a78bfa"
            />
          </div>
        )}

        {/* Members card */}
        <section style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 10px)',
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          {/* Card header — stacks vertically on <md so 180px search and the
              Create button stop fighting the title for row space. */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center" style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}>
            <div style={{ fontSize: 14, color: 'var(--color-text)', fontWeight: 600 }}>
              {t('admin.members')}
            </div>
            <div className="flex items-center md:ml-auto" style={{ gap: 8 }}>
              <div className="relative flex-1 md:flex-none">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('admin.searchMembers')}
                  className="w-full md:w-[180px]"
                  style={{
                    height: 28, paddingLeft: 28, paddingRight: 8,
                    borderRadius: 6, fontSize: 12,
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                    outline: 'none',
                  }}
                />
              </div>
              {/* Create user button — opens the modal that delegates to the
                  existing auth register endpoint (admin call path is not yet
                  separate; see backend-gaps memory). */}
              <button
                onClick={() => {
                  setNewUsername(''); setNewDisplayName(''); setNewPassword('');
                  setNewRole('user'); setCreateError('');
                  setShowCreateUser(true);
                }}
                style={{
                  padding: '6px 12px',
                  background: 'var(--color-accent)',
                  border: 'none', borderRadius: 6,
                  color: 'var(--color-accent-fg)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                <Plus size={12} /> {t('admin.createUser')}
              </button>
            </div>
          </div>

          {/* Column headers — hidden on <md (rows there use card layout). */}
          <div className="hidden md:grid items-center text-[11px] font-medium uppercase tracking-[0.04em] text-text-muted"
            style={{
              gridTemplateColumns: '40px 1.4fr 1fr 1fr 80px 1.4fr 100px 40px',
              padding: '10px 18px',
              background: 'var(--color-bg-elevated)',
              borderBottom: '1px solid var(--color-border)',
            }}>
            <span></span>
            <span>{t('admin.usersSection').toUpperCase() === 'USERS' ? 'Username' : 'Username'}</span>
            <span>{t('admin.role')}</span>
            <span>{t('admin.createdBy')}</span>
            <span>{t('admin.notebooksCol')}</span>
            <span>{t('admin.resources')}</span>
            <span>{t('admin.lastSeen')}</span>
            <span></span>
          </div>

          {/* Rows */}
          {filteredUsers.map((u, i) => {
            const memUsed = memByUser.get(u.username) ?? 0;
            const memPct = Math.min(100, Math.round((memUsed / 8192) * 100));
            const cpuPct = Math.min(100, Math.round(cpuByUser.get(u.username) ?? 0));
            const palette = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
            return (
              <div
                key={u.username}
                className="grid items-center grid-cols-[40px_1fr_40px] md:grid-cols-[40px_1.4fr_1fr_1fr_80px_1.4fr_100px_40px]"
                style={{
                  padding: '12px 18px',
                  borderTop: '1px solid var(--color-border-subtle)',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: palette,
                  color: '#1a1815',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600,
                }}>
                  {u.username[0].toUpperCase()}
                </div>
                {/* Username + (on mobile) role + meta sub-line */}
                <div className="min-w-0">
                  <div className="font-mono flex items-center gap-2" style={{ fontSize: 13, color: 'var(--color-text)' }}>
                    <span className="truncate">{u.username}</span>
                    {/* Role pill — inline next to username on <md, full column on md+ */}
                    <span className="md:hidden" style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: 10,
                      background: u.is_admin
                        ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                        : 'var(--color-bg-hover)',
                      color: u.is_admin ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    }}>
                      {u.is_admin ? 'admin' : 'user'}
                    </span>
                  </div>
                  {/* Mobile-only meta sub-line — folds created_by/notebooks/
                      last_seen into one truncated row. CPU/MEM bars are
                      omitted on phone — too narrow to be readable. */}
                  <div className="md:hidden text-[10px] text-text-muted truncate" style={{ marginTop: 2 }}>
                    {[
                      u.created_by ? `@${u.created_by}` : null,
                      `${u.notebook_count} nb`,
                      timeAgo(u.last_seen_at ?? u.created_at),
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {/* Role pill — desktop column */}
                <div className="hidden md:block">
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    background: u.is_admin
                      ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                      : 'var(--color-bg-hover)',
                    color: u.is_admin ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  }}>
                    {u.is_admin ? 'admin' : 'user'}
                  </span>
                </div>
                {/* Created by */}
                <div className="hidden md:block font-mono" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
                  title={u.created_by || 'bootstrap admin'}>
                  {u.created_by ? `@${u.created_by}` : '—'}
                </div>
                {/* Notebooks count */}
                <div className="hidden md:block" style={{ fontSize: 13, color: 'var(--color-text)' }}
                  title={`${formatBytes(u.storage_bytes)} stored`}>
                  {u.notebook_count}
                </div>
                {/* Resources — MEM bar from kernel sum, CPU bar at 0 (not tracked) */}
                <div className="hidden md:block" style={{ fontSize: 11 }}>
                  <FFBar value={cpuPct} label="CPU" />
                  <FFBar value={memPct} label="MEM" />
                </div>
                {/* Last seen */}
                <div className="hidden md:block" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {timeAgo(u.last_seen_at ?? u.created_at)}
                </div>
                {/* Kebab — dropdown is portalled to document.body so it
                    escapes the table's overflow:hidden clip on bottom rows. */}
                <div className="flex justify-end">
                  <button
                    ref={(el: HTMLButtonElement | null) => {
                      if (el) triggerRefs.current.set(u.username, el);
                      else triggerRefs.current.delete(u.username);
                    }}
                    onClick={() => toggleMenu(u.username)}
                    className="p-1 rounded inline-flex items-center justify-center min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 text-text-muted hover:text-text hover:bg-bg-hover"
                    aria-label="More"
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {/* Groups — hub-mode only. The /admin/groups API is gated by
            require_hub on the backend, so rendering it without --hub would
            just show an empty list and 403 on every POST/PUT/DELETE. */}
        {hubMode && (
        <section style={{ marginBottom: 24 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-muted">
              {t('admin.groups')}
            </h2>
            <button onClick={() => setShowNewGroup(v => !v)} className="btn btn-sm btn-secondary gap-1.5">
              <Plus size={12} /> {t('admin.newGroup')}
            </button>
          </div>

          {showNewGroup && (
            <div style={{
              padding: 18, marginBottom: 12,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
            }}>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('common.name')}</label>
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="field" placeholder="e.g. students" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('common.description')}</label>
                  <input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} className="field" placeholder="Optional" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('admin.maxKernelsPerUser')}</label>
                  <input value={newGroupMaxKernels} onChange={e => setNewGroupMaxKernels(e.target.value)} type="number" className="field" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('admin.maxMemoryPerUser')}</label>
                  <input value={newGroupMaxMemory} onChange={e => setNewGroupMaxMemory(e.target.value)} type="number" className="field" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={createGroup} className="btn btn-sm btn-primary">{t('common.create')}</button>
                <button onClick={() => setShowNewGroup(false)} className="btn btn-sm btn-ghost">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {groups.length > 0 ? (
            <div style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
              overflow: 'hidden',
            }}>
              {groups.map((g, i) => (
                <div key={g.name} className="flex items-center hover:bg-bg-hover transition-colors"
                  style={{
                    gap: 16, padding: '12px 18px',
                    borderTop: i ? '1px solid var(--color-border-subtle)' : 'none',
                  }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Layers size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-text font-medium">{g.name}</p>
                    <p className="text-[11px] text-text-muted">{g.description || 'No description'}</p>
                  </div>
                  <div className="text-[11px] text-text-muted">{g.max_kernels_per_user} kernels</div>
                  <div className="text-[11px] text-text-muted">{g.max_memory_mb_per_user} MB</div>
                  <button onClick={() => deleteGroup(g.name)} className="btn btn-sm btn-ghost text-error hover:bg-error/10">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-[12px] text-text-muted" style={{
              padding: '24px 0',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
            }}>
              {t('admin.noGroups')}
            </div>
          )}
        </section>
        )}

        {/* Running kernels — hub-mode only. /admin/kernels{,/stop,/stop-idle}
            require_hub on the backend; without --hub the section would just
            be a dead "no kernels" stub. */}
        {hubMode && (
        <section>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-muted">
              {t('admin.runningKernelsSection')}
            </h2>
            {kernels.length > 0 && (
              <button onClick={stopAllIdle} className="btn btn-sm btn-danger gap-1.5">
                <Square size={12} /> {t('admin.stopAllIdle')}
              </button>
            )}
          </div>

          {kernels.length > 0 ? (
            <div style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
              overflow: 'hidden',
            }}>
              {kernels.map((k, i) => {
                const color = langColor(k.language ?? '');
                return (
                  <div key={k.id} className="flex items-center group hover:bg-bg-hover transition-colors"
                    style={{
                      gap: 12, padding: '12px 18px',
                      borderTop: i ? '1px solid var(--color-border-subtle)' : 'none',
                    }}>
                    <div className="relative">
                      <div style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: `color-mix(in srgb, ${color} 14%, transparent)`,
                        color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Cpu size={14} />
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-secondary ${k.status === 'busy' ? 'bg-warning animate-pulse' : 'bg-success'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-text font-medium">{k.notebook_path?.split('/').pop() ?? k.kernel_spec}</span>
                        <span className="font-medium" style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: 10,
                          background: `color-mix(in srgb, ${color} 18%, transparent)`,
                          color,
                        }}>{k.language}</span>
                      </div>
                      <p className="text-[11px] text-text-muted">@{k.username} &middot; {k.status} &middot; {k.memory_mb} MB</p>
                    </div>
                    <button onClick={() => stopKernel(k.id)}
                      className="opacity-0 group-hover:opacity-100 btn btn-sm btn-ghost text-error hover:bg-error/10 transition-all">
                      <Square size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-[12px] text-text-muted" style={{
              padding: '24px 0',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
            }}>
              No running kernels.
            </div>
          )}
        </section>
        )}
      </div>

      {/* Portalled kebab dropdown — single instance, opens for whichever
          username is currently in `openMenu`. The destructive items below
          (demote, delete) only show when the caller is the bootstrap
          super-admin AND the target isn't the super-admin themselves. */}
      {openMenu && menuPos && (() => {
        const target = users.find(u => u.username === openMenu);
        if (!target) return null;
        const canDemote =
          callerIsSuperAdmin && target.is_admin && !target.is_super_admin;
        const canDelete =
          !target.is_super_admin
          && (callerIsSuperAdmin || !target.is_admin);
        return createPortal(
          <div
            ref={menuRef}
            className="fixed py-1 w-48 rounded-lg shadow-2xl shadow-black/60"
            style={{
              top: menuPos.top, left: menuPos.left, zIndex: 60,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            <button
              onClick={() => {
                setEditUser(openMenu); setEditMaxKernels(''); setEditMaxMemory(''); setEditMaxStorage(''); setEditGroup('');
                setOpenMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2"
            >
              <Settings2 size={13} /> {t('admin.limits')}
            </button>
            {/* Reset password — admin can change anyone's; backend gates
                non-self changes on `is_admin` so this is always reachable. */}
            <button
              onClick={() => {
                setPwUser(target.username); setPwNew(''); setPwError('');
                setOpenMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2"
            >
              <Key size={13} /> Reset password
            </button>
            {canDemote && (
              <button
                onClick={() => { void changeRole(target.username, false); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2"
              >
                <Shield size={13} /> Demote to user
              </button>
            )}
            {callerIsSuperAdmin && !target.is_admin && (
              <button
                onClick={() => { void changeRole(target.username, true); }}
                className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover flex items-center gap-2"
              >
                <Shield size={13} /> Promote to admin
              </button>
            )}
            {canDelete && (
              <>
                <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} className="my-1" />
                <button
                  onClick={() => { setDeleteTarget(target); setOpenMenu(null); }}
                  className="w-full text-left px-3 py-2 text-[13px] text-error hover:bg-error/10 flex items-center gap-2"
                >
                  <Trash2 size={13} /> Delete user
                </button>
              </>
            )}
          </div>,
          document.body,
        );
      })()}

      {/* Edit user limits modal */}
      {showCreateUser && (
        <FFModalShell
          title="Create user"
          subtitle="Admin-only. The new user signs in with this username and password."
          width={500}
          primaryLabel="Create user"
          primaryDisabled={!newUsername.trim() || !newPassword}
          onClose={() => setShowCreateUser(false)}
          onPrimary={createUser}
        >
          <FFInput
            label="Username"
            value={newUsername}
            onChange={setNewUsername}
            mono
            autoFocus
            placeholder="m.kowalski"
            hint="3–32 chars, lowercase, dot or hyphen allowed."
          />
          <FFInput
            label="Display name"
            value={newDisplayName}
            onChange={setNewDisplayName}
            placeholder="Optional"
          />
          <FFInput
            label="Temporary password"
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            mono
            hint="Tell the user to change this on first login."
          />
          <FFSelect
            label="Role"
            value={newRole}
            onChange={(v) => setNewRole(v as 'user' | 'admin')}
            options={[
              { value: 'user', label: 'User' },
              { value: 'admin', label: 'Admin' },
            ]}
            hint="Admins can manage users, groups and quotas. Demoting an admin invalidates their existing JWTs."
          />
          {createError && (
            <div className="text-[12px] rounded-lg" style={{
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.20)',
              color: 'var(--color-error)',
            }}>{createError}</div>
          )}
        </FFModalShell>
      )}

      {editUser && (
        <FFModalShell
          title="Edit limits"
          subtitle={`@${editUser} · per-user kernel and memory caps.`}
          width={440}
          primaryLabel={t('common.save')}
          onClose={() => setEditUser(null)}
          onPrimary={saveUserLimits}
        >
          <FFInput
            label="Max kernels"
            value={editMaxKernels}
            onChange={setEditMaxKernels}
            placeholder="Default (5)"
            type="number"
          />
          <FFInput
            label="Max memory (MB)"
            value={editMaxMemory}
            onChange={setEditMaxMemory}
            placeholder="Default (4096)"
            type="number"
          />
          <FFInput
            label="Max storage (MB)"
            value={editMaxStorage}
            onChange={setEditMaxStorage}
            placeholder="0 = unlimited"
            type="number"
            hint="Total bytes the user's workspace dir can hold (notebooks + uploads). 0 = no cap."
          />
          <FFSelect
            label="Group"
            value={editGroup}
            onChange={setEditGroup}
            options={[
              { value: '', label: 'No group' },
              ...groups.map(g => ({ value: g.name, label: g.name })),
            ]}
          />
        </FFModalShell>
      )}

      {deleteTarget && (
        <FFModalShell
          title={`Delete @${deleteTarget.username}?`}
          subtitle="Permanent — there's no recycle bin. Run this only when you're sure."
          width={480}
          primaryLabel="Delete forever"
          danger
          onClose={() => setDeleteTarget(null)}
          onPrimary={confirmDeleteMember}
        >
          <div style={{
            padding: 12,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 7,
            fontSize: 12, color: '#fca5a5',
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#fff' }}>
              This will remove, permanently:
            </div>
            <ul style={{ paddingLeft: 16, lineHeight: 1.6 }}>
              <li>The account row (login disabled, sessions invalidated).</li>
              <li>
                Workspace directory on disk —{' '}
                <span className="font-mono" style={{ color: '#fff' }}>
                  {deleteTarget.notebook_count} notebook{deleteTarget.notebook_count === 1 ? '' : 's'},{' '}
                  {(deleteTarget.storage_bytes / 1024 / 1024).toFixed(1)} MB
                </span>
                .
              </li>
              <li>All running kernel sessions, share rows, history, activity log entries.</li>
            </ul>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            If you only want to lock them out without losing their work, deactivate the account
            instead (Edit limits → Active off).
          </p>
        </FFModalShell>
      )}

      {pwUser && (
        <FFModalShell
          title="Reset password"
          subtitle={`@${pwUser} · their existing JWTs are invalidated and they'll need to sign in again.`}
          width={440}
          primaryLabel="Set new password"
          primaryDisabled={pwNew.length < 8}
          onClose={() => { setPwUser(null); setPwNew(''); setPwError(''); }}
          onPrimary={changeUserPassword}
        >
          <FFInput
            label="New password"
            value={pwNew}
            onChange={setPwNew}
            type="password"
            mono
            autoFocus
            hint="Minimum 8 characters. Tell the user out-of-band — there's no email on file."
          />
          {pwError && (
            <div className="text-[12px] rounded-lg" style={{
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.20)',
              color: 'var(--color-error)',
            }}>{pwError}</div>
          )}
        </FFModalShell>
      )}
    </div>
  );
}
