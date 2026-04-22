import type { Notebook } from '../lib/types';

const BASE = '/api';

/** Trigger a file download from a blob URL. Appending to DOM ensures
 *  the download attribute is respected across all browsers. */
function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
  return res.json();
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
}

export interface AuthUser {
  username: string;
  display_name?: string;
  is_admin: boolean;
  role?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
}

export const api = {
  // auth
  authStatus: () => get<{ has_users: boolean }>('/auth/status'),
  authMe: () => get<{ ok: boolean; user?: AuthUser; error?: string }>('/auth/me'),
  login: (username: string, password: string) => post<{ ok: boolean; user?: AuthUser; error?: string }>('/auth/login', { username, password }),
  register: (username: string, password: string, display_name?: string) => post<{ ok: boolean; user?: AuthUser; error?: string }>('/auth/register', { username, password, display_name }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  listUsers: () => get<AuthUser[]>('/auth/users'),
  deleteUser: (username: string) => fetch(`${BASE}/auth/users/${username}`, { method: 'DELETE' }),
  // file ops
  uploadFiles: async (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.webkitRelativePath || f.name);
    await fetch(`${BASE}/files/upload`, { method: 'POST', body: form });
  },
  downloadFile: async (path: string) => {
    const res = await fetch(`${BASE}/files/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const name = path.split('/').pop() || 'file';
    const url = URL.createObjectURL(blob);
    triggerDownload(url, name);
  },
  downloadZip: async (paths: string[]) => {
    const res = await fetch(`${BASE}/files/download-zip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    return res.blob();
  },
  fileHistory: (path: string) => post<{ id: number; username: string; action: string; changed_cells: string; created_at: string }[]>('/files/history', { path }),
  historySnapshot: (id: number) => get<Record<string, unknown>>(`/files/history/${id}`),
  createFolder: async (path: string) => {
    const res = await fetch(`${BASE}/files/mkdir`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  },
  deleteFile: async (path: string) => {
    const res = await fetch(`${BASE}/files/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  },
  renameFile: async (oldPath: string, newName: string) => {
    const res = await fetch(`${BASE}/files/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_path: oldPath, new_name: newName }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  },
  extractZip: async (path: string) => {
    const res = await fetch(`${BASE}/files/extract-zip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Extract failed: ${res.status}`);
  },
  shareFile: async (filePath: string, toUser: string) => {
    const res = await fetch(`${BASE}/files/share`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, to_user: toUser }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  },
  sharedFiles: () => get<{ id: number; from_user: string; file_name: string; shared_at: string }[]>('/files/shared'),
  sharesByMe: (fileName: string) =>
    get<{ id: number; to_user: string }[]>(`/files/shares-by-me?file_name=${encodeURIComponent(fileName)}`),
  unshareFile: (shareId: number) => post<void>('/files/unshare', { share_id: shareId }),
  shareUsers: () => get<{ username: string; display_name: string }[]>('/files/share-users'),
  getConfig: () => get<{ notebook_dir: string; initial_notebook: string | null }>('/config'),
  listNotebooks: () => get<{ name: string; path: string }[]>('/notebooks'),
  getNotebook: (path: string) => get<Notebook>(`/notebooks/${path}`),
  openNotebookPath: (path: string) => post<Notebook>('/notebooks/open', { path }),
  saveNotebook: (path: string, nb: unknown) => put(`/notebooks/${path}`, nb),
  createNotebook: (name?: string) => post<{ name: string; path: string }>('/notebooks', { name }),
  renameNotebook: (oldPath: string, newName: string) => post<{ path: string }>('/notebooks/rename', { old_path: oldPath, new_name: newName }),
  listFiles: (path?: string) => get<FileEntry[]>(path ? `/files/${path}` : '/files'),
  listTemplates: () => get<{ name: string; variables: { key: string; default_value: string }[] }[]>('/templates'),
  uploadTemplate: async (name: string, typContent: string, assets: File[]) => {
    const form = new FormData();
    form.append('name', name);
    form.append('template', typContent);
    for (const file of assets) form.append('asset', file, file.name);
    const res = await fetch(`${BASE}/templates`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  },
  deleteTemplate: (name: string) => fetch(`${BASE}/templates/${name}`, { method: 'DELETE' }).then(() => {}),
  uploadTemplateAssets: async (name: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('asset', file, file.name);
    const res = await fetch(`${BASE}/templates/${name}/assets`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  },
  changePassword: (newPassword: string, username?: string) =>
    post<{ ok: boolean; error?: string }>('/auth/change-password', { new_password: newPassword, username }),

  // AI
  aiChat: (provider: string, apiKey: string, messages: { role: string; content: string }[], opts?: {
    model?: string; baseUrl?: string; system?: string;
  }) => post<{ ok: boolean; content?: string; error?: string }>('/ai/chat', {
    provider, api_key: apiKey, messages,
    model: opts?.model, base_url: opts?.baseUrl, system: opts?.system,
  }),
  exportPdf: async (nb: unknown, template?: string, vars?: Record<string, string>) => {
    const res = await fetch(`${BASE}/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebook: nb, template, variables: vars }),
    });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const blob = await res.blob();
    // Ensure blob has correct PDF MIME type for download
    return new Blob([blob], { type: 'application/pdf' });
  },
  listKernelSpecs: () => get<{
    name: string;
    display_name: string;
    language: string;
    env_name?: string;
    env_path?: string;
    spec_name: string;
  }[]>('/kernelspecs'),

  // ── plugins ──
  listPlugins: () =>
    get<import('../plugins/types').PluginEntry[]>('/plugins'),
  getPluginConfig: () =>
    get<import('../plugins/types').PluginSettings>('/plugins/config'),
  setPluginConfig: (settings: import('../plugins/types').PluginSettings) =>
    post<import('../plugins/types').PluginSettings>('/plugins/config', settings),
  uploadPlugin: async (file: File, scope: import('../plugins/types').PluginScope) => {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${BASE}/plugins/upload?scope=${scope}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<import('../plugins/types').PluginManifest>;
  },
  deletePlugin: async (scope: import('../plugins/types').PluginScope, name: string) => {
    const res = await fetch(`${BASE}/plugins/${scope}/${name}`, { method: 'DELETE' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Delete failed: ${res.status}`);
    }
  },

  // Update check
  checkForUpdate: () => get<{
    current: string;
    latest: string;
    has_update: boolean;
    download_url: string;
  }>('/update-check'),

  // Dashboard
  getDashboard: () => get<{
    username: string;
    display_name: string;
    is_admin: boolean;
    stats: { recent_notebooks_count: number; running_kernels_count: number; shared_files_count: number };
    recent_notebooks: { file_path: string; last_opened: string }[];
    shared_files: { id: number; from_user: string; file_name: string }[];
    running_kernels: { id: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number; started_at: string }[];
  }>('/dashboard'),
  getDashboardKernels: () => get<{
    id: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number;
  }[]>('/dashboard/kernels'),
  stopKernel: (id: string) => post<void>(`/kernels/${id}/stop`),

  // Admin
  getAdminStats: () => get<{ user_count: number; total_kernels: number; total_memory_mb: number }>('/admin/stats'),
  getAdminUsers: () => get<{ username: string; display_name: string; is_admin: boolean; created_at: string; kernel_count: number }[]>('/admin/users'),
  updateAdminUser: (username: string, data: { max_kernels?: number; max_memory_mb?: number; group_name?: string; is_active?: boolean }) =>
    put(`/admin/users/${username}`, data),
  getAdminGroups: () => get<{ name: string; description: string; max_kernels_per_user: number; max_memory_mb_per_user: number }[]>('/admin/groups'),
  createAdminGroup: (data: { name: string; description?: string; max_kernels_per_user?: number; max_memory_mb_per_user?: number }) =>
    post<void>('/admin/groups', data),
  updateAdminGroup: (name: string, data: { description?: string; max_kernels_per_user?: number; max_memory_mb_per_user?: number }) =>
    put(`/admin/groups/${name}`, data),
  deleteAdminGroup: (name: string) => del(`/admin/groups/${name}`),
  getAdminKernels: () => get<{ id: string; username: string; kernel_spec: string; language: string; notebook_path: string | null; status: string; memory_mb: number }[]>('/admin/kernels'),
  adminStopKernel: (id: string) => post<void>(`/admin/kernels/${id}/stop`),
  adminStopAllIdle: () => post<{ stopped: number }>('/admin/kernels/stop-idle'),
};
