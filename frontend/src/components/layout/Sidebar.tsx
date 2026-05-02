import { useEffect, useRef, useState } from 'react';
import { Variable, FolderTree, ListTree, History, Network, X, Plug, Bot, GitBranch, Rows2 } from 'lucide-react';
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

/** Merge built-in tabs with plugin-contributed sidebar panels. AI is hidden
 *  unless the user has actually configured a provider. */
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

/**
 * Notebook sidebar — thin vertical icon rail (56px) plus a resizable content
 * panel. Right-clicking a rail icon promotes/demotes that tab as a secondary
 * split panel below the active one. Whether the rail sits left-of or
 * right-of the panel is decided by the caller via the `side` prop, so it
 * cooperates with the user's `sidebarSide` preference.
 */
export function Sidebar({ side }: { side: 'left' | 'right' }) {
  const tabs = useTabs();
  const sidebarTab = useUIStore(s => s.sidebarTab);
  const secondaryTab = useUIStore(s => s.sidebarSecondaryTab);
  const setTab = useUIStore(s => s.setSidebarTab);
  const setSecondary = useUIStore(s => s.setSidebarSecondaryTab);
  const width = useUIStore(s => s.sidebarWidth);
  const setWidth = useUIStore(s => s.setSidebarWidth);
  const splitRatio = useUIStore(s => s.sidebarSplitRatio);
  const setSplitRatio = useUIStore(s => s.setSidebarSplitRatio);

  // Width drag — direction depends on which side the sidebar lives on.
  // Handle sits on the inner edge (right edge when side='left', left edge
  // when side='right'). Dragging towards the centre always grows the panel.
  function onWidthDragStart(e: React.MouseEvent) {
    const startX = e.clientX;
    const startW = width;
    function onMove(ev: MouseEvent) {
      const delta = side === 'right' ? (startX - ev.clientX) : (ev.clientX - startX);
      setWidth(startW + delta);
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

  const dragHandle = (
    <div
      onMouseDown={onWidthDragStart}
      className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
    />
  );

  const iconRail = (
    <IconRail
      tabs={tabs}
      current={sidebarTab}
      secondary={secondaryTab}
      onSelect={setTab}
      onToggleSplit={setSecondary}
    />
  );

  const panel = (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
  );

  // Layout: when the sidebar is on the LEFT, drag handle sits on its right
  // edge (between panel and main content). On the RIGHT, drag handle is on
  // its left edge. Icon rail always renders adjacent to the page edge.
  return (
    <div className="flex h-full min-h-0 w-full">
      {side === 'left' ? (
        <>
          {iconRail}
          {panel}
          {dragHandle}
        </>
      ) : (
        <>
          {dragHandle}
          {panel}
          {iconRail}
        </>
      )}
    </div>
  );
}

function IconRail({
  tabs, current, secondary, onSelect, onToggleSplit,
}: {
  tabs: TabDef[];
  current: string;
  secondary: SidebarTab | null;
  onSelect: (t: SidebarTab) => void;
  onToggleSplit: (t: SidebarTab | null) => void;
}) {
  return (
    <div
      className="flex flex-col items-center shrink-0"
      style={{
        width: 56,
        background: 'var(--color-bg-secondary)',
        padding: '12px 0',
        gap: 4,
        borderLeft: '1px solid var(--color-border-subtle)',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const isPrimary = current === id;
        const isSecondary = secondary === id;
        const active = isPrimary || isSecondary;
        return (
          <div
            key={id}
            className="group relative"
            style={{ width: 36, height: 36 }}
          >
            <button
              onClick={() => onSelect(id as SidebarTab)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (id === current) return;
                onToggleSplit(isSecondary ? null : id as SidebarTab);
              }}
              title={label}
              style={{
                width: 36, height: 36, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isPrimary ? 'var(--color-bg-hover)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: 'none', cursor: 'pointer',
                transition: 'background 120ms ease, color 120ms ease',
              }}
            >
              <Icon size={17} />
            </button>

            {/* Split-view affordance — hover-revealed mini button at the
                bottom-right corner. Clicking pins this panel as the
                secondary half of a split view (or unpins it). Right-click on
                the icon itself does the same thing for keyboard-free users. */}
            {!isPrimary && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSplit(isSecondary ? null : id as SidebarTab);
                }}
                title={isSecondary ? 'Remove from split view' : 'Add as split view'}
                className={`absolute -bottom-0.5 -right-0.5 transition-opacity ${
                  isSecondary ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: isSecondary
                    ? 'var(--color-accent)'
                    : 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  color: isSecondary
                    ? 'var(--color-accent-fg)'
                    : 'var(--color-text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Rows2 size={9} />
              </button>
            )}
          </div>
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
        className="h-1 shrink-0 cursor-row-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
        style={{
          background: 'var(--color-bg-elevated)',
          borderTop: '1px solid var(--color-border-subtle)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      />

      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-muted shrink-0"
        style={{
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
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
