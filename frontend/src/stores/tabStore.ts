import { create } from 'zustand';
import { uuid } from '../lib/uuid';

export interface Tab {
  id: string;
  path: string;
  name: string;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  addTab(path: string, name: string): string; // returns tab id
  closeTab(id: string): void;
  setActiveTab(id: string): void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (path, name) => {
    // don't duplicate
    const existing = get().tabs.find(t => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const id = uuid();
    set(s => ({
      tabs: [...s.tabs, { id, path, name }],
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
}));
