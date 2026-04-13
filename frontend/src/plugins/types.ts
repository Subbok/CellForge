// Plugin data model, mirroring crates/cellforge-server/src/plugins/manifest.rs.
// Keep these types in sync when the backend manifest grows.

export type PluginScope = 'system' | 'user';

export interface ThemeContribution {
  id: string;
  name?: string;
  /** Map of CSS variable name → value, e.g. "--color-accent" → "#b58900". */
  vars: Record<string, string>;
}

export interface WidgetContribution {
  tag_name: string;
  module: string;
  stateful?: boolean;
}

export interface ToolbarButtonContribution {
  id: string;
  label: string;
  /** Lucide icon name (e.g. "timer", "rocket", "shield"). */
  icon?: string;
  /** Named command to invoke on click (registered in plugin JS). */
  command: string;
  /** Where in the toolbar: "left" (after Run) or "right" (before kernel chip). Default: "right". */
  position?: 'left' | 'right';
}

export interface SidebarPanelContribution {
  id: string;
  title: string;
  icon?: string;
  /** JS module path (relative to frontend/) exporting a panel render function. */
  module?: string;
}

export interface CellActionContribution {
  id: string;
  label: string;
  icon?: string;
  command: string;
}

export interface KeybindingContribution {
  /** Key combo string, e.g. "ctrl+shift+m". */
  key: string;
  /** Named command to invoke. */
  command: string;
  /** Only active in command mode (not while editing a cell)? Default: true. */
  command_mode_only?: boolean;
}

export interface ExportFormatContribution {
  id: string;
  label: string;
  /** File extension without dot, e.g. "md", "docx". */
  extension: string;
  /** Named command that performs the export. Gets the notebook JSON as argument. */
  command: string;
}

export interface StatusBarItemContribution {
  id: string;
  /** Static label text. Plugin can update it via a command. */
  label?: string;
  icon?: string;
  /** If set, clicking the item invokes this command. */
  command?: string;
  /** "left" or "right" side of the status bar. Default: "right". */
  position?: 'left' | 'right';
}

export interface PluginContributes {
  themes?: ThemeContribution[];
  widgets?: WidgetContribution[];
  pylib?: string[];
  toolbar_buttons?: ToolbarButtonContribution[];
  sidebar_panels?: SidebarPanelContribution[];
  cell_actions?: CellActionContribution[];
  keybindings?: KeybindingContribution[];
  export_formats?: ExportFormatContribution[];
  status_bar_items?: StatusBarItemContribution[];
}

export interface PluginManifest {
  name: string;
  version?: string;
  display_name?: string;
  description?: string;
  author?: string;
  contributes?: PluginContributes;
}

/** Plugin as returned from GET /api/plugins — manifest + where it's installed. */
export interface PluginEntry {
  manifest: PluginManifest;
  scope: PluginScope;
}

export interface PluginSettings {
  allow_user_plugins: boolean;
}

/**
 * A theme entry the Settings picker can display.
 * Built-in Crisp is represented with an empty vars map — selecting it
 * clears any inline CSS variable overrides so @theme defaults win.
 */
export interface ThemeEntry {
  id: string;
  name: string;
  /** Empty map = built-in theme (just clear overrides). */
  vars: Record<string, string>;
  source: 'builtin' | PluginScope;
  /** Plugin name, if this theme came from a plugin. */
  plugin?: string;
}

export const BUILTIN_THEME: ThemeEntry = {
  id: 'crisp',
  name: 'Crisp Dark',
  vars: {},
  source: 'builtin',
};

export const BUILTIN_LIGHT_THEME: ThemeEntry = {
  id: 'crisp-light',
  name: 'Crisp Light',
  vars: {
    '--color-bg': '#f8f9fc',
    '--color-bg-secondary': '#ffffff',
    '--color-bg-hover': '#e8eaf0',
    '--color-bg-elevated': '#ffffff',
    '--color-bg-output': '#f1f3f8',
    '--color-border': '#d4d7e0',
    '--color-text': '#1a1a2e',
    '--color-text-secondary': '#4a5568',
    '--color-text-muted': '#718096',
    '--color-accent': '#4a6cf7',
    '--color-accent-hover': '#3b5de7',
    '--color-accent-fg': '#ffffff',
    '--color-success': '#16a34a',
    '--color-warning': '#d97706',
    '--color-error': '#dc2626',
    '--color-cell-active': '#4a6cf7',
    '--color-cell-stale': '#d97706',
    '--color-cell-running': '#7c3aed',
  },
  source: 'builtin',
};
