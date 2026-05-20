import { useEffect, useRef, useState } from 'react';
import {
  Play, RotateCcw, Square, Save, Eraser, Download, PanelRightClose,
  PanelRightOpen, LayoutTemplate, Code2, ChevronDown, Plug, Share2,
  MoreHorizontal,
} from 'lucide-react';
import { useNotebookStore } from '../../stores/notebookStore';
import { useKernelStore } from '../../stores/kernelStore';
import { useUIStore } from '../../stores/uiStore';
import { executeCommand } from '../../plugins/registry';
import { useVariableStore } from '../../stores/variableStore';
import { useExecuteCell } from '../../hooks/useKernel';
import { queueCells, clearQueue } from '../../services/executionQueue';
import { ws } from '../../services/websocket';
import { api } from '../../services/api';
import { broadcastCellOp, broadcastSaved, isActive as isCollabActive } from '../../services/collaboration';
import { FileName } from './FileName';
import { PresenceIndicator } from './PresenceIndicator';
import { ShareModal } from '../ShareModal';
import { FFModalShell, FFCheckRow } from '../modals/FFModalShell';

function kernelDotColor(status: string) {
  if (status === 'idle') return '#4ade80';
  if (status === 'busy' || status === 'starting' || status === 'restarting') return '#fbbf24';
  if (status === 'dead') return '#ef4444';
  return 'var(--color-text-muted)';
}

/** Compact pill button — secondary chrome, optional accent variant. */
function ChipButton({
  title, onClick, children, primary, disabled,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        gap: 6,
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 12, fontWeight: primary ? 600 : 500,
        background: primary ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
        border: primary ? 'none' : '1px solid var(--color-border)',
        color: primary ? 'var(--color-accent-fg)' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function TopBar({ onExport, onSwitchKernel }: {
  onExport: () => void; onSwitchKernel: () => void;
}) {
  // Per-field selectors instead of destructuring the whole store — pulling
  // the whole store via `useNotebookStore()` re-renders TopBar on every
  // keystroke (every Yjs cell-edit update bumps the store reference even
  // when none of these three fields actually changed).
  const cells = useNotebookStore(s => s.cells);
  const activeCellId = useNotebookStore(s => s.activeCellId);
  const dirty = useNotebookStore(s => s.dirty);
  const status = useKernelStore(s => s.status);
  const spec = useKernelStore(s => s.spec);
  const availableSpecs = useKernelStore(s => s.availableSpecs);
  const sidebarOpen = useUIStore(s => s.sidebarOpen);
  const toggleSidebar = useUIStore(s => s.toggleSidebar);
  const sidebarSide = useUIStore(s => s.sidebarSide);
  const appMode = useUIStore(s => s.appMode);
  const toggleAppMode = useUIStore(s => s.toggleAppMode);
  const pluginButtons = useUIStore(s => s.pluginToolbarButtons);
  const execute = useExecuteCell();

  const [shareOpen, setShareOpen] = useState(false);
  const [shareUsers, setShareUsers] = useState<{ username: string; display_name: string }[]>([]);
  const [outboundShares, setOutboundShares] = useState<{ id: number; to_user: string }[]>([]);
  const [shareError, setShareError] = useState<string>('');

  const [restartOpen, setRestartOpen] = useState(false);
  const [restartRunAll, setRestartRunAll] = useState(false);

  // Track last successful save so we can surface "Saved 12s ago" in the
  // header chip — matches the JSX baseline.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // `nowMs` is bumped from the interval below so `savedAgoLabel` can read it
  // instead of calling `Date.now()` in render. react-hooks/purity forbids
  // impure calls in the render path; sampling the clock from an effect and
  // reading a state value during render is the supported alternative.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!savedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [savedAt]);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function doRestart() {
    useKernelStore.getState().setStatus('restarting');
    useVariableStore.getState().clearAll();
    clearQueue();
    ws.reconnect(spec ?? 'python3', useNotebookStore.getState().filePath ?? undefined);
    setRestartOpen(false);
    if (restartRunAll) {
      const codeIds = useNotebookStore.getState().cells
        .filter(c => c.cell_type === 'code')
        .map(c => c.id);
      queueCells(codeIds);
    }
  }

  async function openShare() {
    const filePath = useNotebookStore.getState().filePath;
    if (!filePath) return;
    setShareError('');
    setShareOpen(true);
    api.shareUsers().then(setShareUsers).catch(() => {});
  }

  function runActiveCell() {
    const cell = cells.find(c => c.id === activeCellId);
    if (cell?.cell_type === 'code') execute(cell.id, cell.source);
  }

  function runAllCells() {
    const codeCellIds = cells.filter(c => c.cell_type === 'code').map(c => c.id);
    queueCells(codeCellIds);
  }

  function clearAllOutputs() {
    for (const cell of cells) {
      if (cell.cell_type === 'code') {
        useNotebookStore.getState().clearOutputs(cell.id);
      }
    }
    if (isCollabActive()) broadcastCellOp({ type: 'clear_outputs' });
  }

  async function save() {
    const nb = useNotebookStore.getState();
    if (!nb.filePath) return;
    await api.saveNotebook(nb.filePath, {
      metadata: nb.metadata,
      nbformat: 4,
      nbformat_minor: 5,
      cells: nb.cells.map(c => ({
        cell_type: c.cell_type,
        id: c.id,
        source: c.source,
        metadata: c.metadata,
        ...(c.cell_type === 'code' ? { outputs: c.outputs, execution_count: c.execution_count } : {}),
      })),
    });
    useNotebookStore.setState({ dirty: false });
    const now = Date.now();
    setSavedAt(now);
    setNowMs(now); // align with savedAt so the chip immediately shows "Saved 0s ago" instead of the stale interval tick
    broadcastSaved();
  }

  function savedAgoLabel(): string {
    if (dirty) return 'Unsaved';
    if (!savedAt) return 'Saved';
    const diff = nowMs - savedAt;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `Saved ${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Saved ${minutes}m ago`;
    return 'Saved a while ago';
  }

  const kernelLabel =
    availableSpecs.find(s => s.name === spec)?.display_name ?? spec ?? 'No kernel';
  const dotColor = kernelDotColor(status);

  return (
    <header
      className="flex items-center shrink-0 px-2 md:pl-5 md:pr-4 gap-2 md:gap-3"
      style={{
        height: 48,
        background: 'var(--color-bg)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <FileName />

      {/* Kernel chip — strips parenthesised qualifiers ("(ipykernel)" etc.)
          for a cleaner short label. Full name remains in the tooltip. */}
      <button
        onClick={onSwitchKernel}
        title={`${kernelLabel} · click to switch`}
        className="inline-flex items-center shrink-0 transition-colors"
        style={{
          gap: 6, padding: '4px 10px',
          borderRadius: 4, fontSize: 11,
          background: `color-mix(in srgb, ${dotColor} 12%, transparent)`,
          color: dotColor,
          border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0,
          ...(status === 'busy' ? { animation: 'cell-running-glow 1.5s ease-in-out infinite' } : {}),
        }} />
        <span style={{ whiteSpace: 'nowrap' }}>
          {kernelLabel.replace(/\s*\([^)]*\)\s*$/, '').trim() || kernelLabel}
        </span>
        <ChevronDown size={10} style={{ opacity: 0.7, flexShrink: 0 }} />
      </button>

      {/* Saved chip — hidden on <md since TopBar action chips already
          eat the available horizontal room and the chip's role is purely
          informational (no click target). */}
      <span
        title={dirty ? 'Notebook has unsaved changes' : 'All changes saved'}
        className="hidden md:inline"
        style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 11,
          background: dirty
            ? 'color-mix(in srgb, var(--color-warning) 14%, transparent)'
            : 'var(--color-bg-hover)',
          color: dirty ? 'var(--color-warning)' : 'var(--color-text-muted)',
        }}
      >
        {savedAgoLabel()}
      </span>

      <div className="flex-1" />

      {/* Collaborators */}
      <PresenceIndicator />

      {/* App / Code mode toggle — hidden on <md entirely (mobile use case is
          "preview + Run All", not switching edit modes). Lives in the More
          menu on phone for power users. */}
      <button
        onClick={toggleAppMode}
        title={appMode ? 'Switch to Editor Mode' : 'Switch to App Mode'}
        className="hidden md:inline-flex items-center justify-center transition-colors"
        style={{
          gap: 5, padding: '5px 10px',
          borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: appMode
            ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
            : 'var(--color-bg-elevated)',
          border: appMode ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
          color: appMode ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        {appMode ? <LayoutTemplate size={12} /> : <Code2 size={12} />}
        <span className="hidden md:inline">{appMode ? 'App' : 'Code'}</span>
      </button>

      {/* Action cluster: Run all · (Clear · Restart · Share — desktop only) · Export · More.
          On <md only Run all + Export stay visible; Clear/Restart/Share fold into More. */}
      <div className="flex items-center" style={{ gap: 6 }}>
        <ChipButton title="Run all cells" onClick={runAllCells}>
          <Play size={12} /> <span className="hidden md:inline">Run all</span>
        </ChipButton>
        <div className="hidden md:contents">
          <ChipButton title="Clear all outputs" onClick={clearAllOutputs}>
            <Eraser size={12} /> Clear
          </ChipButton>
          <ChipButton
            title="Restart kernel"
            onClick={() => { setRestartRunAll(false); setRestartOpen(true); }}
          >
            <RotateCcw size={12} /> Restart
          </ChipButton>
          <ChipButton title="Share" onClick={openShare}>
            <Share2 size={12} /> Share
          </ChipButton>
        </div>
        <ChipButton title="Export" onClick={onExport} primary>
          <Download size={12} /> <span className="hidden md:inline">Export</span>
        </ChipButton>

        {/* More — secondary actions tucked away. On <md also holds the
            chips hidden above (Clear/Restart/Share). */}
        <div className="relative" ref={moreRef}>
          <button
            onClick={() => setMoreOpen(v => !v)}
            title="More actions"
            className="inline-flex items-center justify-center w-9 h-9 md:w-7 md:h-7"
            style={{
              borderRadius: 6,
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {moreOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-30 py-1 w-52 rounded-lg shadow-2xl shadow-black/60"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              {/* Mobile-only block — folds in the chips hidden on <md. */}
              <div className="md:hidden">
                <MoreItem icon={<Eraser size={13} />} label="Clear outputs"
                  onClick={() => { setMoreOpen(false); clearAllOutputs(); }} />
                <MoreItem icon={<RotateCcw size={13} />} label="Restart kernel"
                  onClick={() => { setMoreOpen(false); setRestartRunAll(false); setRestartOpen(true); }} />
                <MoreItem icon={<Share2 size={13} />} label="Share"
                  onClick={() => { setMoreOpen(false); openShare(); }} />
                <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} className="my-1" />
              </div>
              <MoreItem icon={<Play size={13} />} label="Run cell" hint="⇧↵"
                onClick={() => { setMoreOpen(false); runActiveCell(); }} />
              <MoreItem icon={<Save size={13} />} label="Save" hint="⌘S" disabled={!dirty}
                onClick={() => { setMoreOpen(false); save(); }} />
              <MoreItem icon={<Square size={13} />} label="Interrupt"
                onClick={() => { setMoreOpen(false); ws.send('interrupt'); clearQueue(); }} />
              {pluginButtons.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} className="my-1" />
                  {pluginButtons.map(btn => (
                    <MoreItem
                      key={btn.id}
                      icon={<Plug size={13} />}
                      label={btn.label}
                      onClick={() => { setMoreOpen(false); executeCommand(btn.command); }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        className="inline-flex items-center justify-center w-9 h-9 md:w-7 md:h-7"
        style={{
          borderRadius: 6,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        {sidebarOpen
          ? (sidebarSide === 'right' ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} className="rotate-180" />)
          : (sidebarSide === 'right' ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} className="rotate-180" />)}
      </button>

      {shareOpen && (() => {
        const fp = useNotebookStore.getState().filePath ?? '';
        const fileName = fp.split('/').pop() ?? '';
        return (
          <ShareModal
            fileName={fileName}
            filePath={fp}
            shareUsers={shareUsers}
            outboundShares={outboundShares}
            onClose={() => setShareOpen(false)}
            onError={setShareError}
            onRefresh={async () => {
              try { setOutboundShares(await api.sharesByMe(fileName)); }
              catch { setOutboundShares([]); }
            }}
          />
        );
      })()}
      {shareError && (
        <div className="fixed bottom-4 right-4 px-3 py-2 bg-error/10 border border-error/30 text-error text-xs rounded-lg shadow-lg z-50">
          {shareError}
        </div>
      )}

      {restartOpen && (
        <FFModalShell
          title="Restart kernel?"
          subtitle="All variables, imports and loaded data will be cleared. Cell outputs are preserved."
          width={440}
          primaryLabel="Restart kernel"
          danger
          onClose={() => setRestartOpen(false)}
          onPrimary={doRestart}
        >
          <div className="flex" style={{
            gap: 10, padding: 12,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 7,
            fontSize: 12, color: '#fca5a5',
          }}>
            <RotateCcw size={14} className="shrink-0 mt-px" />
            <span>
              Kernel <span className="font-mono" style={{ color: 'var(--color-text)' }}>
                {useKernelStore.getState().spec ?? 'python3'}
              </span> is currently {status}.
              {' '}{cells.filter(c => c.cell_type === 'code' && c.execution_count != null).length} cell(s) have outputs in memory.
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <FFCheckRow
              label="Run all cells after restart"
              checked={restartRunAll}
              onChange={setRestartRunAll}
            />
          </div>
        </FFModalShell>
      )}
    </header>
  );
}

function MoreItem({
  icon, label, hint, onClick, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left flex items-center hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        gap: 8, padding: '7px 12px',
        fontSize: 13,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--color-text)',
      }}
    >
      <span className="text-text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{hint}</span>
      )}
    </button>
  );
}
