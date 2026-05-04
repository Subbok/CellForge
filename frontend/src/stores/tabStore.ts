import { create } from 'zustand';
import { uuid } from '../lib/uuid';

export type TabKind = 'notebook' | 'data';

export interface Tab {
  id: string;
  path: string;
  name: string;
  /** What's rendered for this tab. Defaults to notebook for backward
   * compatibility — old persisted tab lists won't have this field. */
  kind: TabKind;
  /** Kernel the notebook was opened with; used when switching back to this
   *  tab to reconnect WS to the right kernel. Only meaningful for
   *  `kind === 'notebook'`. */
  kernelName?: string;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  addTab(path: string, name: string, kernelName?: string): string; // returns tab id
  /** Open a data viewer tab (CSV/TSV/JSONL/Parquet later). Path is relative
   *  to the user's workspace, same convention as notebook tabs. */
  addDataTab(path: string, name: string): string;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  /** Drag-and-drop reorder: insert `dragId` immediately before `overId`. */
  reorderTabs(dragId: string, overId: string): void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (path, name, kernelName) => {
    // don't duplicate; refresh kernel if the caller provided one
    const existing = get().tabs.find(t => t.path === path);
    if (existing) {
      set(s => ({
        tabs: s.tabs.map(t => t.id === existing.id && kernelName
          ? { ...t, kernelName }
          : t),
        activeTabId: existing.id,
      }));
      return existing.id;
    }

    const id = uuid();
    set(s => ({
      tabs: [...s.tabs, { id, path, name, kind: 'notebook', kernelName }],
      activeTabId: id,
    }));
    return id;
  },

  addDataTab: (path, name) => {
    const existing = get().tabs.find(t => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = uuid();
    set(s => ({
      tabs: [...s.tabs, { id, path, name, kind: 'data' }],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => set(s => {
    const tabs = s.tabs.filter(t => t.id !== id);
    let activeTabId = s.activeTabId;
    if (activeTabId === id) {
      const idx = s.tabs.findIndex(t => t.id === id);
      activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
    }
    return { tabs, activeTabId };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),

  reorderTabs: (dragId, overId) => set(s => {
    if (dragId === overId) return s;
    const tabs = [...s.tabs];
    const fromIdx = tabs.findIndex(t => t.id === dragId);
    const toIdx = tabs.findIndex(t => t.id === overId);
    if (fromIdx === -1 || toIdx === -1) return s;
    const [moved] = tabs.splice(fromIdx, 1);
    // Splice index shifts when fromIdx < toIdx — recompute against the
    // current array so the dragged tab lands *before* the over-target.
    const insertAt = tabs.findIndex(t => t.id === overId);
    tabs.splice(insertAt, 0, moved);
    return { tabs };
  }),
}));
