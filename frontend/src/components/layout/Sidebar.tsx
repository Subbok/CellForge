import { useEffect, useRef, useState } from 'react';
import { Variable, FolderTree, ListTree, History, Network, X, Plug, Bot, GitBranch } from 'lucide-react';
import { useUIStore, type SidebarTab } from '../../stores/uiStore';
import { VariableExplorer } from '../sidebar/VariableExplorer';
import { SidebarFiles } from '../sidebar/SidebarFiles';
import { SidebarDeps } from '../sidebar/SidebarDeps';
import { SidebarToc } from '../sidebar/SidebarToc';
import { SidebarHistory } from '../sidebar/SidebarHistory';
import { SidebarAI } from '../sidebar/SidebarAI';
import { SidebarGit } from '../sidebar/SidebarGit';
import { getPanelRenderer } from '../../plugins/registry';

type TabDef = { id: string; label: string; Icon: React.ComponentType<{ size?: number }> };

const BUILTIN_TABS: TabDef[] = [
  { id: 'variables',    label: 'Variables',    Icon: Variable },
  { id: 'files',        label: 'Files',        Icon: FolderTree },
  { id: 'toc',          label: 'TOC',          Icon: ListTree },
  { id: 'history',      label: 'History',      Icon: History },
  { id: 'dependencies', label: 'Dependencies', Icon: Network },
  { id: 'git',          label: 'Git',          Icon: GitBranch },
  { id: 'ai',           label: 'AI',           Icon: Bot },
];

/** Merge built-in tabs with plugin-contributed sidebar panels. */
function useTabs(): TabDef[] {
  const pluginPanels = useUIStore(s => s.pluginSidebarPanels);
  const aiKey = useUIStore(s => s.aiApiKey);
  const aiProvider = useUIStore(s => s.aiProvider);
  const aiConfigured = aiProvider === 'ollama' || aiKey.length > 0;

  return [
    ...BUILTIN_TABS.filter(t => t.id !== 'ai' || aiConfigured),
    ...pluginPanels.map(p => ({
      id: p.id,
      label: p.title,
      Icon: Plug as React.ComponentType<{ size?: number }>,
    })),
  ];
}

/** Renders built-in panel or a plugin-contributed panel via its render function. */
function PanelBody({ tab }: { tab: string }) {
  switch (tab) {
    case 'variables':    return <VariableExplorer />;
    case 'files':        return <SidebarFiles />;
    case 'toc':          return <SidebarToc />;
    case 'history':      return <SidebarHistory />;
    case 'dependencies': return <SidebarDeps />;
    case 'git':          return <SidebarGit />;
    case 'ai':           return <SidebarAI />;
    default:             return <PluginPanelHost panelId={tab} />;
  }
}

/** Mount a plugin-provided panel into a container div. */
function PluginPanelHost({ panelId }: { panelId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = getPanelRenderer(panelId);
    if (!render) {
      el.replaceChildren();
      const msg = document.createElement('div');
      msg.className = 'text-xs text-text-muted p-4 text-center';
      msg.textContent = `Panel "${panelId}" has no renderer registered.`;
      el.appendChild(msg);
      return;
    }
    const cleanup = render(el);
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [panelId]);

  return <div ref={ref} className="h-full" />;
}

/** The whole sidebar column: resize handle → content. */
export function Sidebar() {
  const tabs = useTabs();
  const sidebarTab = useUIStore(s => s.sidebarTab);
  const secondaryTab = useUIStore(s => s.sidebarSecondaryTab);
  const setTab = useUIStore(s => s.setSidebarTab);
  const setSecondary = useUIStore(s => s.setSidebarSecondaryTab);
  const width = useUIStore(s => s.sidebarWidth);
  const setWidth = useUIStore(s => s.setSidebarWidth);
  const splitRatio = useUIStore(s => s.sidebarSplitRatio);
  const setSplitRatio = useUIStore(s => s.setSidebarSplitRatio);

  // horizontal (width) resize
  function onWidthDragStart(e: React.MouseEvent) {
    const startX = e.clientX;
    const startW = width;
    function onMove(ev: MouseEvent) {
      // dragging LEFT grows the sidebar (the handle sits on the left edge)
      setWidth(startW + (startX - ev.clientX));
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
    e.preventDefault();
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* drag handle to resize sidebar width */}
      <div
        onMouseDown={onWidthDragStart}
        className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
      />

      <div className="flex flex-col h-full min-h-0 flex-1 min-w-0">
        {/* tab strip — icon-only to fit 5 tabs in any width */}
        <TabStrip
          tabs={tabs}
          current={sidebarTab}
          secondary={secondaryTab}
          onSelect={setTab}
          onToggleSplit={setSecondary}
        />

        {/* stacked panels */}
        {secondaryTab
          ? <SplitPanels
              top={sidebarTab}
              bottom={secondaryTab}
              ratio={splitRatio}
              setRatio={setSplitRatio}
              onCloseBottom={() => setSecondary(null)}
            />
          : <div className="flex-1 min-h-0 overflow-y-auto p-3"><PanelBody tab={sidebarTab} /></div>
        }
      </div>
    </div>
  );
}

function TabStrip({
  tabs, current, secondary, onSelect, onToggleSplit,
}: {
  tabs: TabDef[];
  current: string;
  secondary: SidebarTab | null;
  onSelect: (t: SidebarTab) => void;
  onToggleSplit: (t: SidebarTab | null) => void;
}) {
  return (
    <div className="flex border-b border-border shrink-0">
      {tabs.map(({ id, label, Icon }) => {
        const isPrimary = current === id;
        const isSecondary = secondary === id;
        const active = isPrimary || isSecondary;
        return (
          <button
            key={id}
            onClick={() => onSelect(id as SidebarTab)}
            onContextMenu={(e) => {
              // right-click adds/removes the panel as a secondary split panel
              e.preventDefault();
              if (id === current) return; // can't split the same panel as itself
              onToggleSplit(isSecondary ? null : id as SidebarTab);
            }}
            title={`${label}${id === current ? '' : '  (right-click: split view)'}`}
            className={`flex-1 flex items-center justify-center h-9 text-xs font-medium transition-colors
              ${active ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}
              ${isPrimary ? 'border-b-2 border-accent' : ''}
              ${isSecondary && !isPrimary ? 'border-b-2 border-accent/40' : ''}
            `}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

function SplitPanels({
  top, bottom, ratio, setRatio, onCloseBottom,
}: {
  top: SidebarTab;
  bottom: SidebarTab;
  ratio: number;
  setRatio: (r: number) => void;
  onCloseBottom: () => void;
}) {
  const tabs = useTabs();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const r = (e.clientY - rect.top) / rect.height;
      setRatio(r);
    }
    function onUp() { setDragging(false); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, setRatio]);

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
      <div
        className="overflow-y-auto p-3"
        style={{ flex: `${ratio} 1 0`, minHeight: 0 }}
      >
        <PanelBody tab={top} />
      </div>

      <div
        onMouseDown={() => setDragging(true)}
        className="h-1 shrink-0 cursor-row-resize hover:bg-accent/40 active:bg-accent/60 border-y border-border bg-bg-elevated transition-colors"
      />

      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted border-b border-border bg-bg-elevated/40 shrink-0">
        <span>{tabs.find(t => t.id === bottom)?.label}</span>
        <button
          onClick={onCloseBottom}
          className="p-0.5 rounded hover:text-accent hover:bg-accent/10"
          title="Close split"
        >
          <X size={11} />
        </button>
      </div>
      <div
        className="overflow-y-auto p-3"
        style={{ flex: `${1 - ratio} 1 0`, minHeight: 0 }}
      >
        <PanelBody tab={bottom} />
      </div>
    </div>
  );
}
