import { create } from 'zustand';
import {
  BUILTIN_THEME,
  BUILTIN_LIGHT_THEME,
  type ThemeEntry,
  type PluginEntry,
  type ToolbarButtonContribution,
  type SidebarPanelContribution,
  type CellActionContribution,
  type KeybindingContribution,
  type ExportFormatContribution,
  type StatusBarItemContribution,
} from '../plugins/types';

export type SidebarTab = 'variables' | 'files' | 'toc' | 'history' | 'dependencies';

const LS_KEY = 'cellforge.ui';

/** Default accent — matches the Crisp blue that ships in index.css @theme. */
export const DEFAULT_ACCENT = '#7a99ff';

function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

interface Persisted {
  sidebarWidth: number;
  sidebarSplitRatio: number;
  sidebarSecondaryTab: SidebarTab | null;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  reactiveEnabled: boolean;
  accentColor: string;
  currentThemeId: string;
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
}

function loadPersisted(): Partial<Persisted> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePersisted(state: Persisted) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* ignored */ }
}

interface UIState {
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  /** If set, a second panel is shown below the main one. */
  sidebarSecondaryTab: SidebarTab | null;
  /** Width of the whole sidebar column in px. */
  sidebarWidth: number;
  /** Fraction of the sidebar column height given to the TOP panel (0..1). */
  sidebarSplitRatio: number;
  theme: 'light' | 'dark';
  /** Accent color as a 6-digit hex string (e.g. "#7a99ff"). Drives
   *  --color-accent, --color-accent-hover, --color-cell-active. */
  accentColor: string;
  searchQuery: string;
  autoSaveInterval: number; // seconds, 0 = disabled
  reactiveEnabled: boolean;
  appMode: boolean;
  /** Monotonically increasing counter; bump to trigger a file listing refresh. */
  filesRefreshToken: number;

  // ── AI assistant ──
  aiProvider: string; // 'anthropic' | 'openai' | 'ollama' | 'custom'
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string; // custom endpoint URL

  // ── plugin system ──
  availableThemes: ThemeEntry[];
  plugins: PluginEntry[];
  isAdmin: boolean;
  allowUserPlugins: boolean;
  currentThemeId: string;
  /** Aggregated contributions from all loaded plugins — UI components read these. */
  pluginToolbarButtons: ToolbarButtonContribution[];
  pluginSidebarPanels: SidebarPanelContribution[];
  pluginCellActions: CellActionContribution[];
  pluginKeybindings: KeybindingContribution[];
  pluginExportFormats: ExportFormatContribution[];
  pluginStatusBarItems: StatusBarItemContribution[];

  toggleSidebar: () => void;
  toggleAppMode: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarSecondaryTab: (tab: SidebarTab | null) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarSplitRatio: (r: number) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setAccentColor: (c: string) => void;
  setSearchQuery: (q: string) => void;
  setAutoSaveInterval: (s: number) => void;
  setReactiveEnabled: (v: boolean) => void;
  bumpFilesRefresh: () => void;

  setAiProvider: (v: string) => void;
  setAiApiKey: (v: string) => void;
  setAiModel: (v: string) => void;
  setAiBaseUrl: (v: string) => void;

  // plugin setters
  setPlugins: (plugins: PluginEntry[]) => void;
  setAllowUserPlugins: (allow: boolean) => void;
  setIsAdmin: (admin: boolean) => void;
  setCurrentThemeId: (id: string) => void;
}

const persisted = loadPersisted();

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: persisted.sidebarOpen ?? true,
  sidebarTab: persisted.sidebarTab ?? 'variables',
  sidebarSecondaryTab: persisted.sidebarSecondaryTab ?? null,
  sidebarWidth: Math.max(200, Math.min(800, persisted.sidebarWidth ?? 288)),
  sidebarSplitRatio: Math.max(0.15, Math.min(0.85, persisted.sidebarSplitRatio ?? 0.55)),
  theme: 'dark',
  accentColor: isHexColor(persisted.accentColor) ? persisted.accentColor : DEFAULT_ACCENT,
  searchQuery: '',
  autoSaveInterval: 30,
  reactiveEnabled: persisted.reactiveEnabled ?? true,
  appMode: false,
  filesRefreshToken: 0,

  aiProvider: persisted.aiProvider ?? 'anthropic',
  aiApiKey: persisted.aiApiKey ?? '',
  aiModel: persisted.aiModel ?? '',
  aiBaseUrl: persisted.aiBaseUrl ?? '',

  availableThemes: [BUILTIN_THEME, BUILTIN_LIGHT_THEME],
  plugins: [],
  isAdmin: false,
  allowUserPlugins: true,
  currentThemeId: persisted.currentThemeId ?? BUILTIN_THEME.id,
  pluginToolbarButtons: [],
  pluginSidebarPanels: [],
  pluginCellActions: [],
  pluginKeybindings: [],
  pluginExportFormats: [],
  pluginStatusBarItems: [],

  toggleSidebar: () => {
    set(s => ({ sidebarOpen: !s.sidebarOpen }));
    persist(get());
  },
  toggleAppMode: () => set(s => ({ appMode: !s.appMode })),
  setSidebarTab: (tab) => {
    set(s => ({
      sidebarTab: tab,
      sidebarOpen: true,
      // if the new tab is the same as the secondary, clear secondary so we
      // don't end up with the same panel in both slots
      sidebarSecondaryTab: s.sidebarSecondaryTab === tab ? null : s.sidebarSecondaryTab,
    }));
    persist(get());
  },
  setSidebarSecondaryTab: (tab) => {
    set(s => ({
      sidebarSecondaryTab: tab === s.sidebarTab ? null : tab,
      sidebarOpen: true,
    }));
    persist(get());
  },
  setSidebarWidth: (w) => {
    set({ sidebarWidth: Math.max(200, Math.min(800, w)) });
    persist(get());
  },
  setSidebarSplitRatio: (r) => {
    set({ sidebarSplitRatio: Math.max(0.15, Math.min(0.85, r)) });
    persist(get());
  },
  setTheme: (theme) => set({ theme }),
  setAccentColor: (c) => {
    // Only accept 6-digit hex; silently ignore bad input.
    if (!isHexColor(c)) return;
    set({ accentColor: c });
    persist(get());
  },
  setSearchQuery: (q) => set({ searchQuery: q }),
  setAutoSaveInterval: (s) => set({ autoSaveInterval: s }),
  setReactiveEnabled: (v) => {
    set({ reactiveEnabled: v });
    persist(get());
  },
  bumpFilesRefresh: () => set(s => ({ filesRefreshToken: s.filesRefreshToken + 1 })),

  setAiProvider: (v) => { set({ aiProvider: v }); persist(get()); },
  setAiApiKey: (v) => { set({ aiApiKey: v }); persist(get()); },
  setAiModel: (v) => { set({ aiModel: v }); persist(get()); },
  setAiBaseUrl: (v) => { set({ aiBaseUrl: v }); persist(get()); },

  setPlugins: (plugins) => {
    // rebuild all aggregated contribution lists from loaded plugins
    const themes: ThemeEntry[] = [BUILTIN_THEME, BUILTIN_LIGHT_THEME];
    const toolbarButtons: ToolbarButtonContribution[] = [];
    const sidebarPanels: SidebarPanelContribution[] = [];
    const cellActions: CellActionContribution[] = [];
    const keybindings: KeybindingContribution[] = [];
    const exportFormats: ExportFormatContribution[] = [];
    const statusBarItems: StatusBarItemContribution[] = [];

    for (const p of plugins) {
      const c = p.manifest.contributes;
      if (!c) continue;
      for (const t of c.themes ?? []) {
        themes.push({
          id: t.id, name: t.name ?? t.id, vars: t.vars ?? {},
          source: p.scope, plugin: p.manifest.name,
        });
      }
      for (const b of (c.toolbar_buttons ?? []) as ToolbarButtonContribution[]) toolbarButtons.push(b);
      for (const s of (c.sidebar_panels ?? []) as SidebarPanelContribution[]) sidebarPanels.push(s);
      for (const a of (c.cell_actions ?? []) as CellActionContribution[]) cellActions.push(a);
      for (const k of (c.keybindings ?? []) as KeybindingContribution[]) keybindings.push(k);
      for (const e of (c.export_formats ?? []) as ExportFormatContribution[]) exportFormats.push(e);
      for (const s of (c.status_bar_items ?? []) as StatusBarItemContribution[]) statusBarItems.push(s);
    }

    set({
      plugins, availableThemes: themes,
      pluginToolbarButtons: toolbarButtons,
      pluginSidebarPanels: sidebarPanels,
      pluginCellActions: cellActions,
      pluginKeybindings: keybindings,
      pluginExportFormats: exportFormats,
      pluginStatusBarItems: statusBarItems,
    });

    const current = get().currentThemeId;
    if (!themes.some(t => t.id === current)) {
      set({ currentThemeId: BUILTIN_THEME.id });
      persist(get());
    }
  },
  setAllowUserPlugins: (allow) => set({ allowUserPlugins: allow }),
  setIsAdmin: (admin) => set({ isAdmin: admin }),
  setCurrentThemeId: (id) => {
    set({ currentThemeId: id });
    persist(get());
  },
}));

function persist(s: UIState) {
  savePersisted({
    sidebarWidth: s.sidebarWidth,
    sidebarSplitRatio: s.sidebarSplitRatio,
    sidebarSecondaryTab: s.sidebarSecondaryTab,
    sidebarTab: s.sidebarTab,
    sidebarOpen: s.sidebarOpen,
    reactiveEnabled: s.reactiveEnabled,
    accentColor: s.accentColor,
    currentThemeId: s.currentThemeId,
    aiProvider: s.aiProvider,
    aiApiKey: s.aiApiKey,
    aiModel: s.aiModel,
    aiBaseUrl: s.aiBaseUrl,
  });
}
