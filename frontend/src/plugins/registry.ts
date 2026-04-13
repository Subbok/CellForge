/**
 * Plugin registry — MIME renderers, commands, and panel renderers.
 *
 * The central runtime state for everything plugins contribute that
 * requires JS code (as opposed to manifest-only declarations like
 * toolbar buttons and keybindings, which are handled purely from
 * manifest data in the UI stores).
 */

// ── MIME renderers ──

export type MimeRenderFn = (container: HTMLElement, data: unknown) => void | Promise<void>;

const mimeHandlers = new Map<string, MimeRenderFn>();

export function registerMimeRenderer(mimeType: string, fn: MimeRenderFn) {
  mimeHandlers.set(mimeType, fn);
}

export function getMimeRenderer(mimeType: string): MimeRenderFn | undefined {
  return mimeHandlers.get(mimeType);
}

export function findPluginMime(
  data: Record<string, unknown>,
): [string, unknown] | undefined {
  for (const [mime, payload] of Object.entries(data)) {
    if (mimeHandlers.has(mime)) return [mime, payload];
  }
  return undefined;
}

// ── Commands ──
// Named functions that toolbar buttons, keybindings, cell actions, and
// context menu items invoke. Plugins register commands in their JS module
// via `ctx.registerCommand('my-plugin.do-thing', () => {...})`.

export type CommandFn = (...args: unknown[]) => void | Promise<void>;

const commands = new Map<string, CommandFn>();

export function registerCommand(name: string, fn: CommandFn) {
  commands.set(name, fn);
}

export function executeCommand(name: string, ...args: unknown[]): void {
  const fn = commands.get(name);
  if (fn) {
    Promise.resolve(fn(...args)).catch(e =>
      console.error(`[plugins] command '${name}' failed:`, e),
    );
  } else {
    console.warn(`[plugins] unknown command: ${name}`);
  }
}

export function hasCommand(name: string): boolean {
  return commands.has(name);
}

// ── Panel renderers ──
// Sidebar panels provided by plugins. Plugin JS registers a render function
// that mounts content into a container div.

export type PanelRenderFn = (container: HTMLElement) => void | (() => void);

const panelRenderers = new Map<string, PanelRenderFn>();

export function registerPanelRenderer(panelId: string, fn: PanelRenderFn) {
  panelRenderers.set(panelId, fn);
}

export function getPanelRenderer(panelId: string): PanelRenderFn | undefined {
  return panelRenderers.get(panelId);
}
