import { Trash2, Play, Square, Wand2, SkipForward, ArrowDownToLine, ChevronRight } from 'lucide-react';
import { startDrag } from '../../hooks/useCellDrag';
import { useNotebookStore } from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';
import { useExecuteCell } from '../../hooks/useKernel';
import { ws } from '../../services/websocket';
import { continueExecution, stepExecution } from '../../hooks/useKernel';
import { formatPythonCode } from '../../services/formatCode';
import { addCellSynced, deleteCellSynced } from '../../services/notebookOps';
import { executeCommand } from '../../plugins/registry';
import { outputContextMenu } from '../ContextMenu';
import { lineDiff } from '../../lib/diff';
import { CodeCell } from './CodeCell';
import { MarkdownCellComponent } from './MarkdownCell';
import { CellOutput } from './CellOutput';
import { useKernelStore } from '../../stores/kernelStore';
import type { Cell, CellType } from '../../lib/types';

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-cell-running';
    case 'success': return 'bg-success';
    case 'error': return 'bg-error';
    case 'stale': return 'bg-cell-stale';
    case 'queued': return 'bg-cell-running opacity-50';
    default: return 'bg-transparent';
  }
}

// small icon button used in the cell toolbar
function CellBtn({ onClick, title, danger, children }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e); }}
      className={`p-1 rounded hover:bg-bg-hover text-text-muted ${danger ? 'hover:text-error' : 'hover:text-accent'}`}
      title={title}
    >
      {children}
    </button>
  );
}

import { memo, useState, useRef, useLayoutEffect } from 'react';

export const CellContainer = memo(function CellContainer({ cell, index }: { cell: Cell; index: number }) {
  const activeCellId = useNotebookStore(s => s.activeCellId);
  const setActive = useNotebookStore(s => s.setActiveCell);
  const execute = useExecuteCell();
  const searchQuery = useUIStore(s => s.searchQuery);
  const appMode = useUIStore(s => s.appMode);
  const pluginCellActions = useUIStore(s => s.pluginCellActions);
  const diffView = useNotebookStore(s => s.diffView);
  const availableSpecs = useKernelStore(s => s.availableSpecs);
  const currentSpec = useKernelStore(s => s.spec);
  const active = cell.id === activeCellId;
  const showDiff = diffView?.cellId === cell.id;
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | undefined>(0);

  const running = cell.status === 'running';
  const queued = cell.status === 'queued';
  const paused = cell.status === 'paused';
  const busy = running || queued;

  // Stable outputs: capture height before/during run to prevent jumping
  useLayoutEffect(() => {
    if (running) {
      if (outputRef.current) {
        setMinHeight(outputRef.current.offsetHeight);
      }
    } else {
      const timer = setTimeout(() => setMinHeight(0), 150);
      return () => clearTimeout(timer);
    }
  }, [running]);

  let timeLabel = '';
  if (cell.execTimeMs != null && !busy) {
    const ms = cell.execTimeMs;
    timeLabel = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  // Forge state model: idle ("Done") / running ("Running …") / stale.
  // We map our existing cell.status onto these three so the header pill
  // matches the JSX baseline visually without duplicating state.
  const ffState: 'idle' | 'running' | 'stale' | 'error' | 'paused' = paused
    ? 'paused'
    : running
      ? 'running'
      : cell.status === 'stale'
        ? 'stale'
        : cell.status === 'error'
          ? 'error'
          : 'idle';
  const stateMeta = {
    idle:    { label: timeLabel ? `Done · ${timeLabel}` : 'Done',          dot: '#4ade80', color: 'var(--color-text-muted)' },
    running: { label: timeLabel ? `Running ${timeLabel}` : 'Running…',     dot: '#60a5fa', color: '#60a5fa' },
    stale:   { label: 'Stale — needs rerun',                                dot: 'var(--color-accent)', color: 'var(--color-accent)' },
    error:   { label: 'Error',                                              dot: 'var(--color-error)', color: 'var(--color-error)' },
    paused:  { label: 'Paused at breakpoint',                               dot: 'var(--color-warning)', color: 'var(--color-warning)' },
  }[ffState];
  const lang = ((cell.metadata?.language as string | undefined)
    ?? availableSpecs.find(sp => sp.name === currentSpec)?.language
    ?? 'python').toLowerCase();
  const execLabel = cell.execution_count != null
    ? String(cell.execution_count)
    : busy ? '*' : '·';

  return (
    <div className="cell-animate" style={{ marginBottom: 14 }}>
    <div
      data-cell-active={active && !appMode ? 'true' : undefined}
      className={`group relative transition-colors ${
        busy ? 'cell-running-border' : ''
      }`}
      style={{
        background: appMode ? 'transparent' : 'var(--color-bg-secondary)',
        border: appMode
          ? 'none'
          : `1px solid ${
              paused ? 'rgba(251,191,36,0.40)'
              : (active ? 'var(--color-cell-active)' : 'var(--color-border)')
            }`,
        borderRadius: appMode ? 0 : 'var(--radius-lg, 10px)',
        overflow: 'hidden',
      }}
      onClick={() => !appMode && setActive(cell.id)}
    >
      {/* left accent bar — keeps the at-a-glance state read on the gutter.
          z-index lifts it above the code area's full-width bg-elevated and
          the output area's bg, otherwise the bar would only peek through
          the header padding strip. */}
      {!appMode && (
        <div className={`absolute left-0 top-0 bottom-0 w-0.5 z-10 pointer-events-none transition-colors ${
          paused ? 'bg-warning' : busy ? 'bg-cell-running animate-pulse' : active ? 'bg-cell-active' : statusColor(cell.status)
        }`} />
      )}

      {/* The exec-count chip in the header doubles as the drag handle —
          dragging by it reorders the cell. We attach the mousedown handler
          there rather than on a separate grip icon to stop the gutter from
          looking cluttered. See exec-chip span below. */}
      <div>
        {/* Forge header row — exec chip · lang · status pill · actions.
            Matches JSX `[N] python • Done · 2ms`. The lang label shrinks
            before the status pill when the cell column is narrow. */}
        {!appMode && (cell.cell_type === 'code' || active) && (
          <div className="flex items-center min-w-0"
            style={{
              padding: '6px 8px 6px 12px',
              gap: 10,
              overflow: 'hidden',
              borderBottom: cell.cell_type === 'code'
                ? '1px solid var(--color-border-subtle)'
                : 'none',
            }}>
            {/* Execution count chip — also the cell drag handle.
                mousedown anywhere on the chip starts the drag; click still
                propagates to the parent so selecting the cell works. */}
            <span
              onMouseDown={e => {
                if (appMode) return;
                e.preventDefault();
                const label = cell.source.split('\n')[0]?.slice(0, 50)
                  || (cell.cell_type === 'markdown' ? 'Markdown' : 'Code');
                startDrag(index, label, e.clientY);
              }}
              title="Drag to reorder"
              style={{
                minWidth: 26, height: 18, borderRadius: 4,
                padding: '0 5px',
                background: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
                fontSize: 10,
                fontFamily: '"JetBrains Mono", monospace',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                cursor: 'grab',
              }}
            >{execLabel}</span>

            {/* Language label — truncates before the status pill so the
                primary state read survives narrower columns. */}
            {cell.cell_type === 'code' && (
              <span className="font-mono truncate"
                style={{
                  fontSize: 11, color: 'var(--color-text-muted)',
                  minWidth: 0,
                  flexShrink: 2,
                }}
                title={lang}
              >
                {lang}
              </span>
            )}

            {/* Status pill — collapses to just the dot when there's no room
                for the label (very narrow notebook columns). */}
            <span className="inline-flex items-center min-w-0"
              style={{ gap: 6, fontSize: 11, color: stateMeta.color, flexShrink: 1 }}
              title={stateMeta.label}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: stateMeta.dot,
                flexShrink: 0,
                ...(ffState === 'running'
                  ? { animation: 'cell-running-glow 1.5s ease-in-out infinite' }
                  : {}),
              }} />
              <span className="truncate">{stateMeta.label}</span>
            </span>

            <div className="flex-1" />

            {/* Action buttons — paused-state always visible, running shows
                interrupt, otherwise hover-revealed cluster. */}
            {paused && (
              <>
                <CellBtn onClick={() => stepExecution(cell.id)} title="Step (next line)">
                  <ArrowDownToLine size={13} />
                </CellBtn>
                <CellBtn onClick={() => continueExecution(cell.id)} title="Continue (run all remaining)">
                  <SkipForward size={13} />
                </CellBtn>
              </>
            )}
            {running && (
              <CellBtn onClick={() => ws.send('interrupt')} title="Stop execution" danger>
                <Square size={13} fill="currentColor" />
              </CellBtn>
            )}
            {!busy && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {cell.cell_type === 'code' && <CellBtn onClick={() => execute(cell.id, cell.source)} title="Run cell"><Play size={13} /></CellBtn>}
                {cell.cell_type === 'code' && (
                  <CellBtn onClick={() => formatPythonCode(cell.source).then(r => { if (r) useNotebookStore.getState().updateSource(cell.id, r); })} title="Format"><Wand2 size={13} /></CellBtn>
                )}
                <CellBtn onClick={() => deleteCellSynced(cell.id)} title="Delete" danger><Trash2 size={13} /></CellBtn>
                {pluginCellActions.map(action => (
                  <CellBtn
                    key={action.id}
                    onClick={() => executeCommand(action.command, { cellId: cell.id, source: cell.source })}
                    title={action.label}
                  >
                    <span className="text-[9px] font-medium">{action.label.slice(0, 3)}</span>
                  </CellBtn>
                ))}
              </div>
            )}
          </div>
        )}

        {/* cell body */}
        {cell.cell_type === 'code' ? (
          <div>
            {!appMode && !codeCollapsed && (
              <div style={{ background: 'var(--color-bg-elevated)' }}>
                <CodeCell cell={cell} index={index} />
              </div>
            )}
            {!appMode && codeCollapsed && (
              // Compact placeholder when the user has collapsed the code via
              // the More menu. Click to re-expand.
              <button
                onClick={() => setCodeCollapsed(false)}
                className="w-full text-left flex items-center hover:bg-bg-hover transition-colors"
                style={{
                  gap: 6, padding: '6px 14px',
                  background: 'var(--color-bg-elevated)',
                  fontSize: 11, color: 'var(--color-text-muted)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <ChevronRight size={11} />
                {cell.source.split('\n').length} lines hidden
              </button>
            )}
            {/* inline diff panel */}
            {!appMode && showDiff && diffView && (
              <InlineDiff oldSource={diffView.oldSource} newSource={cell.source}
                onClose={() => useNotebookStore.getState().setDiffView(null)} />
            )}

            {cell.outputs.length > 0 && !outputCollapsed && (
              <div
                ref={outputRef}
                style={{
                  minHeight: running && minHeight ? minHeight : undefined,
                  background: appMode ? 'transparent' : 'var(--color-bg)',
                  borderTop: appMode ? 'none' : '1px solid var(--color-border-subtle)',
                }}
                className={`${running ? 'opacity-50 grayscale-[0.5] transition-opacity duration-500' : 'opacity-100 transition-opacity'}`}
                onContextMenu={e => outputContextMenu(e, e.currentTarget as HTMLElement)}
              >
                <div className={appMode ? '' : 'px-3 py-2'}>
                  {cell.outputs.map((out, i) => <CellOutput key={i} output={out} cellId={cell.id} searchQuery={searchQuery} />)}
                </div>
              </div>
            )}
            {!appMode && cell.outputs.length > 0 && outputCollapsed && (
              <button
                onClick={() => setOutputCollapsed(false)}
                className="w-full text-left flex items-center hover:bg-bg-hover transition-colors"
                style={{
                  gap: 6, padding: '6px 14px',
                  background: 'var(--color-bg)',
                  borderTop: '1px solid var(--color-border-subtle)',
                  fontSize: 11, color: 'var(--color-text-muted)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <ChevronRight size={11} />
                {cell.outputs.length} output{cell.outputs.length > 1 ? 's' : ''} hidden
              </button>
            )}
          </div>
        ) : (
          <div className="pb-0.5">
            {cell.cell_type === 'markdown' && <MarkdownCellComponent cell={cell} isActive={active && !appMode} />}
            {cell.cell_type === 'raw' && !appMode && <div className="text-xs text-text-muted p-2">Raw cell</div>}
          </div>
        )}
      </div>

      </div>
      {/* Add-cell divider lives in the OUTER wrapper (outside the card's
          overflow:hidden) so the hover popup pill isn't clipped at the
          bottom edge of the cell. */}
      {!appMode && <AddCellDivider index={index + 1} />}
    </div>
  );
});

function InlineDiff({ oldSource, newSource, onClose }: {
  oldSource: string; newSource: string; onClose: () => void;
}) {
  const diff = lineDiff(oldSource, newSource);

  return (
    <div className="border border-warning/30 rounded-lg mt-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 bg-warning/10">
        <span className="text-[10px] text-warning font-medium">Changes</span>
        <button onClick={onClose} className="text-[10px] text-text-muted hover:text-text-secondary">close</button>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border text-[10px] font-mono leading-relaxed max-h-60 overflow-y-auto">
        <div className="bg-bg">
          <div className="px-2 py-0.5 text-text-muted bg-bg-elevated border-b border-border">Previous</div>
          {diff.map((line, i) => (
            line.type !== 'add' ? (
              <div key={`o${i}`} className={`px-2 ${line.type === 'del' ? 'bg-error/10 text-error' : 'text-text-secondary'}`}>
                {line.text || '\u00A0'}
              </div>
            ) : null
          ))}
        </div>
        <div className="bg-bg">
          <div className="px-2 py-0.5 text-text-muted bg-bg-elevated border-b border-border">Current</div>
          {diff.map((line, i) => (
            line.type !== 'del' ? (
              <div key={`n${i}`} className={`px-2 ${line.type === 'add' ? 'bg-success/10 text-success' : 'text-text-secondary'}`}>
                {line.text || '\u00A0'}
              </div>
            ) : null
          ))}
        </div>
      </div>
    </div>
  );
}

function AddCellDivider({ index }: { index: number }) {
  function addAndBroadcast(type: CellType) {
    addCellSynced(type, index);
  }

  return (
    <div className="group/add relative h-3 -mb-1 flex items-center justify-center cursor-pointer">
      {/* line across the full width */}
      <div className="absolute inset-x-4 top-1/2 h-px bg-border/0 group-hover/add:bg-border transition-colors" />
      <div className="relative z-10">
        <div className="hidden group-hover/add:flex items-center gap-1 bg-bg-secondary border border-border
          rounded-full px-1 py-0.5 shadow-lg">
          <button
            onClick={() => addAndBroadcast('code')}
            className="px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-accent
              hover:bg-accent/10 rounded-full transition-colors"
          >
            + Code
          </button>
          <div className="w-px h-3 bg-border" />
          <button
            onClick={() => addAndBroadcast('markdown')}
            className="px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-accent
              hover:bg-accent/10 rounded-full transition-colors"
          >
            + Markdown
          </button>
        </div>
      </div>
    </div>
  );
}

