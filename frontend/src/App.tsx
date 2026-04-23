import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './components/Dashboard';
import { KernelPicker } from './components/KernelPicker';
import { SaveModal } from './components/SaveModal';
import { ExportModal } from './components/ExportModal';
import { Settings as SettingsPage } from './components/Settings';
import { ws } from './services/websocket';
import { setupMessageHandlers } from './services/messageHandler';
import { setupCompletionHandler } from './services/kernelComplete';
import { setupFormatHandler } from './services/formatCode';
import { setupAutoSnapshot } from './services/undoRedo';
import { initCollaboration, cleanup as cleanupCollab, broadcastSaved } from './services/collaboration';
import { useNotebookStore } from './stores/notebookStore';
import { useKernelStore } from './stores/kernelStore';
import { useUIStore } from './stores/uiStore';
import { registerBuiltinRenderers } from './plugins/builtins';
import { loadPluginModules } from './plugins/loader';
import { useTabStore } from './stores/tabStore';
import { saveCurrentTab } from './services/tabManager';
import { api } from './services/api';
import type { Notebook } from './lib/types';
import { LoginPage } from './components/LoginPage';
import { HomeDashboard } from './components/HomeDashboard';
import { AdminPanel } from './components/AdminPanel';
import { UpdateNotice } from './components/UpdateNotice';

type Stage = 'loading' | 'login' | 'home' | 'browse' | 'kernel' | 'ready' | 'settings' | 'admin';

function stageFromUrl(): Stage {
  const path = window.location.pathname;
  if (path === '/settings') return 'settings';
  if (path.startsWith('/notebook/')) return 'kernel';
  if (path === '/browse') return 'browse';
  return 'home';
}

function notebookPathFromUrl(): string | null {
  const path = window.location.pathname;
  if (path.startsWith('/notebook/')) {
    const raw = path.slice('/notebook/'.length);
    // strip query params if present
    return decodeURIComponent(raw.split('?')[0]);
  }
  return null;
}

function kernelFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('kernel');
}

/**
 * Pick a foreground color (white or near-black) for text sitting on top of
 * the given accent hex. Uses the YIQ formula — simple, fast, and produces
 * the same practical result as WCAG relative luminance for our use case.
 */
function pickAccentFg(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // YIQ luma
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y > 150 ? '#0c0d13' : '#ffffff';
}

function App() {
  const { t } = useTranslation();
  const [stage, setStageRaw] = useState<Stage>('loading');
  const [user, setUser] = useState<{ username: string; is_admin: boolean } | null>(null);
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [pending, setPending] = useState<{ path: string; nb: Notebook } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showKernelSwitch, setShowKernelSwitch] = useState(false);

  // sync stage → URL (include kernel in query param)
  function setStage(s: Stage, notebookPath?: string, kernelName?: string) {
    setStageRaw(s);
    if (s === 'home') window.history.pushState(null, '', '/');
    else if (s === 'browse') window.history.pushState(null, '', '/browse');
    else if (s === 'settings') window.history.pushState(null, '', '/settings');
    else if (s === 'ready' && notebookPath) {
      const k = kernelName ?? useKernelStore.getState().spec;
      const q = k ? `?kernel=${encodeURIComponent(k)}` : '';
      window.history.pushState(null, '', `/notebook/${encodeURIComponent(notebookPath)}${q}`);
    }
  }

  // handle browser back/forward
  useEffect(() => {
    function onPop() { setStageRaw(stageFromUrl()); }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Register built-in MIME renderers (mermaid, etc.) that ship with CellForge
  // itself, before any user plugins load. One-shot on mount.
  useEffect(() => { registerBuiltinRenderers(); }, []);

  // One-shot plugin loader on mount: pulls /api/plugins + /api/plugins/config,
  // seeds uiStore, then dynamic-imports every plugin's JS module so their
  // MIME renderers are available when notebook outputs start flowing.
  const setPlugins = useUIStore(s => s.setPlugins);
  const setAllowUserPlugins = useUIStore(s => s.setAllowUserPlugins);
  const setIsAdmin = useUIStore(s => s.setIsAdmin);
  useEffect(() => {
    (async () => {
      let pluginList: import('./plugins/types').PluginEntry[] = [];
      try {
        pluginList = await api.listPlugins();
        setPlugins(pluginList);
      } catch (e) {
        console.warn('plugin list fetch failed:', e);
      }
      try {
        const cfg = await api.getPluginConfig();
        setAllowUserPlugins(cfg.allow_user_plugins);
      } catch (e) {
        console.warn('plugin config fetch failed:', e);
      }
      // load frontend JS modules from plugins that declare widgets
      if (pluginList.length > 0) {
        await loadPluginModules(pluginList);
      }
    })();
  }, [setPlugins, setAllowUserPlugins]);

  // Keep `isAdmin` in the store in sync with the currently-authenticated user,
  // so plugin admin surfaces can flip visibility without threading user props.
  useEffect(() => {
    setIsAdmin(Boolean(user?.is_admin));
  }, [user, setIsAdmin]);

  // Apply the active theme's CSS variables to <html>.
  // Tracks previously-set var names in a ref so switching themes reliably
  // clears stale vars (e.g. going from a plugin theme back to built-in Crisp).
  const currentThemeId = useUIStore(s => s.currentThemeId);
  const availableThemes = useUIStore(s => s.availableThemes);
  const lastAppliedThemeVars = useRef<string[]>([]);
  useEffect(() => {
    const root = document.documentElement;
    // 1) clear anything the previous theme installed
    for (const key of lastAppliedThemeVars.current) {
      root.style.removeProperty(key);
    }
    // 2) apply the new theme's vars, if any
    const theme = availableThemes.find(t => t.id === currentThemeId) ?? availableThemes[0];
    const applied: string[] = [];
    if (theme) {
      for (const [key, value] of Object.entries(theme.vars)) {
        // only accept custom-property names — defense against malicious plugin manifests
        if (key.startsWith('--')) {
          root.style.setProperty(key, value);
          applied.push(key);
        }
      }
    }
    lastAppliedThemeVars.current = applied;
  }, [currentThemeId, availableThemes]);

  // sync accent color → CSS variables on <html>. Runs *after* the theme
  // effect, so user-chosen accent always wins over a plugin theme's accent.
  const accentColor = useUIStore(s => s.accentColor);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-accent', accentColor);
    root.style.setProperty('--color-cell-active', accentColor);
    // hover: ~18% darker mix of the accent
    root.style.setProperty(
      '--color-accent-hover',
      `color-mix(in srgb, ${accentColor} 82%, black)`,
    );
    // foreground: pick white or near-black based on accent luminance (YIQ),
    // so light accents (amber / cyan / emerald) still have readable button labels
    root.style.setProperty('--color-accent-fg', pickAccentFg(accentColor));
  }, [accentColor]);

  // warn before refresh/close if there are unsaved changes OR kernel is busy
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const isDirty = useNotebookStore.getState().dirty;
      const isBusy = useKernelStore.getState().status === 'busy';
      
      if (isDirty || isBusy) {
        e.preventDefault();
        // Modern browsers require returning a string or setting returnValue
        const msg = isBusy
          ? t('app.kernelRunningWarning')
          : t('app.unsavedChanges');
        e.returnValue = msg;
        return msg;
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [t]);

  // check auth on mount, then load notebook if URL points to one
  useEffect(() => {
    setupMessageHandlers(); setupCompletionHandler(); setupFormatHandler(); setupAutoSnapshot();

    async function init() {
      // check if logged in
      try {
        const meRes = await api.authMe();
        if (meRes.ok && meRes.user) {
          setUser(meRes.user);
          // authenticated — proceed with URL-based routing
          loadFromUrl(meRes.user.username);
          return;
        }
      } catch { /* ignored */ }

      // not logged in — check if first user
      try {
        const status = await api.authStatus();
        setIsFirstUser(!status.has_users);
      } catch { /* ignored */ }

      setStageRaw('login');
    }

    function loadFromUrl(username?: string) {
      const nbPath = notebookPathFromUrl();
      const savedKernel = kernelFromUrl();
      if (nbPath) {
        api.getNotebook(nbPath).then(nb => {
          if (savedKernel) {
            ws.connect(savedKernel, nbPath);
            useKernelStore.getState().setSpec(savedKernel);
            useNotebookStore.getState().loadNotebook(nbPath, nb);
            const name = nbPath.split('/').pop() ?? 'Untitled';
            useTabStore.getState().addTab(nbPath, name, savedKernel);
            // always start collab so multiple users can edit together
            initCollaboration(nbPath, username ?? 'anonymous');
            setStageRaw('ready');
          } else {
            setPending({ path: nbPath, nb });
            setStageRaw('kernel');
          }
        }).catch(() => setStageRaw('home'));
      } else {
        setStageRaw(stageFromUrl());
      }
    }

    init();
  }, []);

  const leaveEditor = useCallback(() => {
    cleanupCollab();
    ws.disconnect();
    useNotebookStore.setState({
      filePath: null, cells: [], activeCellId: null, dirty: false,
    });
    setStage('home');
  }, []);

  const goHome = useCallback(() => {
    const { dirty } = useNotebookStore.getState();
    if (dirty) {
      setShowSaveModal(true);
    } else {
      leaveEditor();
    }
  }, [leaveEditor]);

  if (stage === 'loading') {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted text-sm">Loading...</div>;
  }

  if (stage === 'login') {
    return (
      <LoginPage
        isFirstUser={isFirstUser}
        onSuccess={(u) => {
          setUser(u);
          setStageRaw(stageFromUrl() === 'login' ? 'home' : stageFromUrl());
        }}
      />
    );
  }

  if (stage === 'settings') {
    return <>
      <SettingsPage onBack={() => setStage('home')} user={user ?? undefined} />
      <UpdateNotice />
    </>;
  }

  if (stage === 'home') {
    return (
      <>
        <HomeDashboard
          onOpenNotebook={(path, nb) => {
            setPending({ path, nb });
            setStage('kernel');
          }}
          onBrowseFiles={() => setStage('browse')}
          onSettings={() => setStage('settings')}
          onAdmin={user?.is_admin ? () => setStage('admin') : undefined}
          onLogout={async () => {
            await api.logout().catch(() => {});
            setUser(null);
            setIsFirstUser(false);
            setStageRaw('login');
            window.history.pushState(null, '', '/');
          }}
        />
        <UpdateNotice />
      </>
    );
  }

  if (stage === 'admin') {
    return (
      <>
        <AdminPanel onBack={() => setStage('home')} />
        <UpdateNotice />
      </>
    );
  }

  if (stage === 'browse') {
    return (
      <>
        <Dashboard onOpenNotebook={(path, nb) => {
          setPending({ path, nb });
          setStage('kernel');
        }}
          onSettings={() => setStage('settings')}
          onBack={() => setStage('home')}
        />
        <UpdateNotice />
      </>
    );
  }

  if (stage === 'kernel') {
    return (
      <KernelPicker
        onSelect={(kernelName) => {
          ws.connect(kernelName, pending?.path);
          const path = pending?.path;
          if (pending) {
            saveCurrentTab();
            useNotebookStore.getState().loadNotebook(pending.path, pending.nb);
            const name = pending.path.split('/').pop() ?? 'Untitled';
            useTabStore.getState().addTab(pending.path, name, kernelName);
            // always start collab so multiple users can edit together
            initCollaboration(pending.path, user?.username ?? 'anonymous');
            setPending(null);
          }
          setStage('ready', path ?? undefined);
        }}
        onSkip={() => {
          const path = pending?.path;
          if (pending) {
            saveCurrentTab();
            useNotebookStore.getState().loadNotebook(pending.path, pending.nb);
            const name = pending.path.split('/').pop() ?? 'Untitled';
            useTabStore.getState().addTab(pending.path, name);
            setPending(null);
          }
          setStage('ready', path ?? undefined);
        }}
        onCancel={() => {
          setPending(null);
          setStage('home');
        }}
      />
    );
  }

  return (
    <>
      <AppLayout
        onGoHome={goHome}
        onExport={() => setShowExport(true)}
        onSwitchKernel={() => setShowKernelSwitch(true)}
        username={user?.username ?? 'anonymous'}
      />
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showKernelSwitch && (
        <KernelPicker
          onSelect={(kernelName) => {
            ws.reconnect(kernelName, useNotebookStore.getState().filePath ?? undefined);
            useKernelStore.getState().setSpec(kernelName);
            setShowKernelSwitch(false);
            // update URL with new kernel
            const path = useNotebookStore.getState().filePath;
            if (path) {
              const q = `?kernel=${encodeURIComponent(kernelName)}`;
              window.history.replaceState(null, '', `/notebook/${encodeURIComponent(path)}${q}`);
            }
          }}
          onCancel={() => setShowKernelSwitch(false)}
        />
      )}
      {showSaveModal && (
        <SaveModal
          onSave={async () => {
            await saveNotebook();
            setShowSaveModal(false);
            leaveEditor();
          }}
          onDiscard={() => {
            setShowSaveModal(false);
            leaveEditor();
          }}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </>
  );
}

async function saveNotebook() {
  const { filePath, metadata, cells } = useNotebookStore.getState();
  if (!filePath) return;
  await api.saveNotebook(filePath, {
    metadata,
    nbformat: 4,
    nbformat_minor: 5,
    cells: cells.map(c => ({
      cell_type: c.cell_type,
      id: c.id,
      source: c.source,
      metadata: c.metadata,
      ...(c.cell_type === 'code' ? { outputs: c.outputs, execution_count: c.execution_count } : {}),
    })),
  });
  useNotebookStore.setState({ dirty: false });
  broadcastSaved();
}

export default App;
