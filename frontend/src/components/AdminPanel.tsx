import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { ArrowLeft, RefreshCw, Square, Trash2, Users, Cpu, HardDrive, Shield, Plus, Settings2, Layers } from 'lucide-react';

interface Props { onBack: () => void; }

interface AdminStats { user_count: number; total_kernels: number; total_memory_mb: number; }
interface AdminUser { username: string; display_name: string; is_admin: boolean; created_at: string; kernel_count: number; }
interface AdminGroup { name: string; description: string; max_kernels_per_user: number; max_memory_mb_per_user: number; }
interface AdminKernel { id: string; username: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number; }

import { langColor } from '../lib/languages';

export function AdminPanel({ onBack }: Props) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [kernels, setKernels] = useState<AdminKernel[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupMaxKernels, setNewGroupMaxKernels] = useState('3');
  const [newGroupMaxMemory, setNewGroupMaxMemory] = useState('2048');
  const [showNewGroup, setShowNewGroup] = useState(false);

  const [editUser, setEditUser] = useState<string | null>(null);
  const [editMaxKernels, setEditMaxKernels] = useState('');
  const [editMaxMemory, setEditMaxMemory] = useState('');
  const [editGroup, setEditGroup] = useState('');

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [s, u, g, k] = await Promise.all([
        api.getAdminStats(), api.getAdminUsers(), api.getAdminGroups(), api.getAdminKernels(),
      ]);
      setStats(s); setUsers(u); setGroups(g); setKernels(k);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

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

  async function saveUserLimits() {
    if (!editUser) return;
    try {
      await api.updateAdminUser(editUser, {
        max_kernels: editMaxKernels ? Number(editMaxKernels) : undefined,
        max_memory_mb: editMaxMemory ? Number(editMaxMemory) : undefined,
        group_name: editGroup || undefined,
      });
      setEditUser(null); flash(`Limits updated for ${editUser}`);
      await refresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (loading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted text-sm">{t('admin.loadingAdmin')}</div>;
  }

  return (
    <div className="min-h-screen bg-bg relative overflow-auto">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 600px 300px at 50% 0%, rgba(248,113,113,0.05), transparent)' }} />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="btn btn-sm btn-ghost gap-1.5">
              <ArrowLeft size={14} /> {t('common.back')}
            </button>
            <div className="w-px h-5 bg-border/50" />
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-error" />
              <span className="font-semibold text-text text-sm">{t('admin.title')}</span>
            </div>
          </div>
          <button onClick={refresh} className="btn btn-sm btn-secondary gap-1.5 rounded-xl">
            <RefreshCw size={13} /> {t('common.refresh')}
          </button>
        </div>
      </header>

      <div className="relative max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Notifications */}
        {error && <div className="px-4 py-2.5 bg-error/10 border border-error/20 text-error text-xs rounded-xl">{error}</div>}
        {success && <div className="px-4 py-2.5 bg-success/10 border border-success/20 text-success text-xs rounded-xl">{success}</div>}

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-bg-secondary/60 border border-border/50 rounded-2xl p-5">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
                <Users size={18} className="text-accent" />
              </div>
              <p className="text-2xl font-bold text-text">{stats.user_count}</p>
              <p className="text-xs text-text-muted mt-0.5">{t('admin.totalUsers')}</p>
            </div>
            <div className="bg-bg-secondary/60 border border-border/50 rounded-2xl p-5">
              <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center mb-3">
                <Cpu size={18} className="text-success" />
              </div>
              <p className="text-2xl font-bold text-text">{stats.total_kernels}</p>
              <p className="text-xs text-text-muted mt-0.5">{t('admin.runningKernels')}</p>
            </div>
            <div className="bg-bg-secondary/60 border border-border/50 rounded-2xl p-5">
              <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center mb-3">
                <HardDrive size={18} className="text-warning" />
              </div>
              <p className="text-2xl font-bold text-text">{stats.total_memory_mb} <span className="text-sm font-normal text-text-muted">{t('admin.mb')}</span></p>
              <p className="text-xs text-text-muted mt-0.5">{t('admin.totalMemory')}</p>
            </div>
          </div>
        )}

        {/* Users */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-text-muted" />
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('admin.usersSection')}</h2>
          </div>
          <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-medium">{t('settings.user')}</th>
                  <th className="text-left px-5 py-3 font-medium">{t('admin.role')}</th>
                  <th className="text-left px-5 py-3 font-medium">{t('admin.kernels')}</th>
                  <th className="text-left px-5 py-3 font-medium">{t('admin.joined')}</th>
                  <th className="text-right px-5 py-3 font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {users.map(u => (
                  <tr key={u.username} className="hover:bg-bg-hover/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center">
                          {(u.display_name || u.username).slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-text font-medium">{u.display_name || u.username}</p>
                          <p className="text-[11px] text-text-muted">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {u.is_admin ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-error/10 text-error text-[10px] font-medium rounded-full">
                          <Shield size={10} /> Admin
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">User</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-text">{u.kernel_count}</td>
                    <td className="px-5 py-3 text-text-muted text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => { setEditUser(u.username); setEditMaxKernels(''); setEditMaxMemory(''); setEditGroup(''); }}
                        className="btn btn-sm btn-ghost gap-1 text-xs">
                        <Settings2 size={12} /> {t('admin.limits')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Groups */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('admin.groups')}</h2>
            </div>
            <button onClick={() => setShowNewGroup(v => !v)} className="btn btn-sm btn-secondary gap-1.5 rounded-xl">
              <Plus size={13} /> {t('admin.newGroup')}
            </button>
          </div>

          {showNewGroup && (
            <div className="bg-bg-secondary/60 border border-border/50 rounded-2xl p-5 mb-4">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('common.name')}</label>
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="field rounded-xl" placeholder="e.g. students" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('common.description')}</label>
                  <input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} className="field rounded-xl" placeholder="Optional" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('admin.maxKernelsPerUser')}</label>
                  <input value={newGroupMaxKernels} onChange={e => setNewGroupMaxKernels(e.target.value)} type="number" className="field rounded-xl" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted mb-1 block">{t('admin.maxMemoryPerUser')}</label>
                  <input value={newGroupMaxMemory} onChange={e => setNewGroupMaxMemory(e.target.value)} type="number" className="field rounded-xl" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={createGroup} className="btn btn-sm btn-primary rounded-xl">{t('common.create')}</button>
                <button onClick={() => setShowNewGroup(false)} className="btn btn-sm btn-ghost">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {groups.length > 0 ? (
            <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
              {groups.map(g => (
                <div key={g.name} className="flex items-center gap-4 px-5 py-3.5 hover:bg-bg-hover/30 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-accent/8 flex items-center justify-center">
                    <Layers size={15} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text font-medium">{g.name}</p>
                    <p className="text-[11px] text-text-muted">{g.description || 'No description'}</p>
                  </div>
                  <div className="text-xs text-text-muted">{g.max_kernels_per_user} kernels</div>
                  <div className="text-xs text-text-muted">{g.max_memory_mb_per_user} MB</div>
                  <button onClick={() => deleteGroup(g.name)} className="btn btn-sm btn-ghost text-error hover:bg-error/10">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-text-muted bg-bg-secondary/20 rounded-2xl border border-border/30">
              {t('admin.noGroups')}
            </div>
          )}
        </section>

        {/* Running kernels */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-text-muted" />
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('admin.runningKernelsSection')}</h2>
            </div>
            {kernels.length > 0 && (
              <button onClick={stopAllIdle} className="btn btn-sm btn-danger gap-1.5 rounded-xl">
                <Square size={12} /> {t('admin.stopAllIdle')}
              </button>
            )}
          </div>

          {kernels.length > 0 ? (
            <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/30">
              {kernels.map(k => {
                const color = langColor(k.language ?? '');
                return (
                  <div key={k.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-bg-hover/30 transition-colors group">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}12` }}>
                        <Cpu size={15} style={{ color }} />
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg ${k.status === 'busy' ? 'bg-warning animate-pulse' : 'bg-success'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text font-medium">{k.notebook_path?.split('/').pop() ?? k.kernel_spec}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${color}15`, color }}>{k.language}</span>
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
            <div className="text-center py-8 text-sm text-text-muted bg-bg-secondary/20 rounded-2xl border border-border/30">
              No running kernels.
            </div>
          )}
        </section>
      </div>

      {/* Edit user limits modal */}
      {editUser && (
        <div className="modal-backdrop" onClick={() => setEditUser(null)}>
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl shadow-black/40 w-[380px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-accent/10 text-accent text-sm font-bold flex items-center justify-center">
                {editUser.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text">Edit limits</h3>
                <p className="text-[11px] text-text-muted">@{editUser}</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Max kernels</label>
                <input value={editMaxKernels} onChange={e => setEditMaxKernels(e.target.value)} placeholder="Default (5)" type="number" className="field rounded-xl" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Max memory (MB)</label>
                <input value={editMaxMemory} onChange={e => setEditMaxMemory(e.target.value)} placeholder="Default (4096)" type="number" className="field rounded-xl" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-muted mb-1 block">Group</label>
                <select value={editGroup} onChange={e => setEditGroup(e.target.value)} className="field rounded-xl">
                  <option value="">No group</option>
                  {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveUserLimits} className="btn btn-md btn-primary flex-1 rounded-xl">{t('common.save')}</button>
              <button onClick={() => setEditUser(null)} className="btn btn-md btn-ghost rounded-xl">{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
