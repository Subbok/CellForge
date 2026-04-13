/**
 * Plugin frontend module loader.
 *
 * For every installed plugin that declares `contributes.widgets`, the loader
 * dynamic-imports the plugin's JS module from the backend asset-serving
 * endpoint (`/api/plugins/{scope}/{name}/frontend/{module}`). The module's
 * default export must be a `register(ctx)` function where `ctx` provides:
 *
 *   ctx.registerMimeRenderer(mimeType, renderFn)
 *
 * Rendering functions receive a container HTMLElement and the MIME payload
 * and can do whatever they want — create DOM, mount a framework component,
 * lazy-load a CDN library, etc.
 */

import type { PluginEntry } from './types';
import { registerMimeRenderer, registerCommand, registerPanelRenderer } from './registry';

export interface PluginContext {
  /** Register a renderer for a custom MIME type in cell outputs. */
  registerMimeRenderer: typeof registerMimeRenderer;
  /** Register a named command that buttons/keybindings can invoke. */
  registerCommand: typeof registerCommand;
  /** Register a renderer for a sidebar panel. */
  registerPanelRenderer: typeof registerPanelRenderer;
}

const ctx: PluginContext = {
  registerMimeRenderer,
  registerCommand,
  registerPanelRenderer,
};

/** Tracks which plugin modules we've already loaded so we don't double-register. */
const loaded = new Set<string>();

/** Load JS modules for all plugins that have widget or panel contributions.
 *  Safe to call multiple times — already-loaded plugins are skipped. */
export async function loadPluginModules(plugins: PluginEntry[]): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const entry of plugins) {
    const key = `${entry.scope}/${entry.manifest.name}`;
    if (loaded.has(key)) continue;

    // a plugin needs its JS loaded if it has widgets, sidebar panels,
    // or any other contribution that requires registerCommand/registerMimeRenderer
    const c = entry.manifest.contributes;
    const needsJs =
      (c?.widgets?.length ?? 0) > 0 ||
      (c?.sidebar_panels?.some(p => p.module) ?? false) ||
      (c?.toolbar_buttons?.length ?? 0) > 0 ||
      (c?.cell_actions?.length ?? 0) > 0 ||
      (c?.keybindings?.length ?? 0) > 0 ||
      (c?.export_formats?.length ?? 0) > 0 ||
      (c?.status_bar_items?.some(s => s.command) ?? false);

    if (!needsJs) continue;

    // find the first module path — widgets[0].module, or sidebar_panels[0].module
    const modulePath =
      c?.widgets?.[0]?.module ??
      c?.sidebar_panels?.find(p => p.module)?.module;
    if (!modulePath) continue;

    const url = `/api/plugins/${entry.scope}/${entry.manifest.name}/frontend/${modulePath}`;
    loaded.add(key);
    promises.push(loadSingleModule(url, entry.manifest.name));
  }

  await Promise.allSettled(promises);
}

/**
 * Convenience: re-fetch the plugin list, update the store, and load any
 * NEW plugin JS modules. Call this after upload/delete in Settings so the
 * user doesn't need to reload the page.
 */
export async function refreshPlugins(): Promise<void> {
  const { useUIStore } = await import('../stores/uiStore');
  try {
    const { api } = await import('../services/api');
    const list = await api.listPlugins();
    useUIStore.getState().setPlugins(list);
    await loadPluginModules(list);
  } catch (e) {
    console.warn('[plugins] refresh failed:', e);
  }
}

async function loadSingleModule(url: string, pluginName: string): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ url);
    const register = mod.default ?? mod.register;
    if (typeof register === 'function') {
      await register(ctx);
      console.log(`[plugins] loaded module from ${pluginName}`);
    } else {
      console.warn(`[plugins] ${pluginName}: module has no default export or register()`);
    }
  } catch (e) {
    console.error(`[plugins] failed to load module from ${pluginName} (${url}):`, e);
  }
}
