import { GripVertical, Trash2, Play, Square, Wand2, SkipForward, ArrowDownToLine, ChevronDown, ChevronRight } from 'lucide-react';
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
import { CellLanguageSelector } from './CellLanguageSelector';
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

  return (
    <div
      data-cell-active={active && !appMode ? 'true' : undefined}
      className={`group relative mb-0.5 rounded-lg border transition-colors cell-animate ${
        paused ? 'border-warning/40 shadow-sm'
        : busy ? 'cell-running-border'
        : (active && !appMode) ? 'border-cell-active/40 shadow-sm'
        : 'border-transparent hover:border-border'
      } ${appMode ? 'border-none shadow-none' : ''}`}
      onClick={() => !appMode && setActive(cell.id)}
    >
      {/* left accent bar */}
      {!appMode && (
        <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full transition-colors ${
          paused ? 'bg-warning' : busy ? 'bg-cell-running animate-pulse' : active ? 'bg-cell-active' : statusColor(cell.status)
        }`} />
      )}

      {/* drag grip handle */}
      {!appMode && (
        <div
          onMouseDown={e => {
            e.preventDefault();
            const label = cell.source.split('\n')[0]?.slice(0, 50) || (cell.cell_type === 'markdown' ? 'Markdown' : 'Code');
            startDrag(index, label, e.clientY);
          }}
          className="absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100
            cursor-grab text-text-muted/40 hover:text-text-secondary transition-opacity p-0.5"
        >
          <GripVertical size={14} />
        </div>
      )}
      <div className={`${appMode ? 'px-0' : 'pl-5 pr-2'}`}>
        {/* toolbar — hidden for rendered markdown, shown on hover/active for code */}
        {!appMode && (cell.cell_type === 'code' || active) && (
          <div className="flex items-center h-7 gap-1.5">
            {busy && (
              <span className="text-[10px] text-cell-running animate-pulse font-medium">
                {running ? 'running...' : 'queued'}
              </span>
            )}
            {paused && (
              <span className="text-[10px] text-warning font-medium">paused at breakpoint</span>
            )}
            {timeLabel && <span className="text-[10px] text-text-muted">{timeLabel}</span>}
            <div className="flex-1" />
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
            {!appMode && (
              <div className={`bg-bg-elevated border border-border ${cell.outputs.length > 0 && !codeCollapsed ? 'rounded-t-lg border-b-0' : 'rounded-lg'}`}>
                <button
                  onClick={() => setCodeCollapsed(c => !c)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-muted hover:text-text-secondary w-full text-left"
                >
                  {codeCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                  {codeCollapsed ? `${cell.source.split('\n').length} lines hidden` : 'code'}
                </button>
                {!codeCollapsed && <CodeCell cell={cell} index={index} />}
                {!codeCollapsed && (
                  <div className="flex justify-end px-2 py-0.5">
                    <CellLanguageSelector
                      language={((cell.metadata?.language as string | undefined) ?? availableSpecs.find(sp => sp.name === currentSpec)?.language ?? 'python').toLowerCase()}
                      onChange={(lang) => {
                        useNotebookStore.getState().setCellMetadata(cell.id, { language: lang });
                      }}
                      availableLanguages={[...new Set(availableSpecs.map(sp => sp.language.toLowerCase()))]}
                    />
                  </div>
                )}
              </div>
            )}
            {/* inline diff panel */}
            {!appMode && showDiff && diffView && (
              <InlineDiff oldSource={diffView.oldSource} newSource={cell.source}
                onClose={() => useNotebookStore.getState().setDiffView(null)} />
            )}

            {cell.outputs.length > 0 && (
              <div 
                ref={outputRef}
                style={{ minHeight: running && minHeight ? minHeight : undefined }}
                className={`${appMode ? '' : `cell-output-block bg-bg-output rounded-b-lg border border-border border-l-2 border-l-accent/30 ${codeCollapsed ? '' : 'border-t-0'}`} ${running ? 'opacity-50 grayscale-[0.5] transition-opacity duration-500' : 'opacity-100 transition-opacity'}`}
              >
                {!appMode && (
                  <button
                    onClick={() => setOutputCollapsed(c => !c)}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-muted hover:text-text-secondary w-full text-left"
                  >
                    {outputCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    {outputCollapsed ? `${cell.outputs.length} output${cell.outputs.length > 1 ? 's' : ''} hidden` : 'output'}
                  </button>
                )}
                {!outputCollapsed && (
                  <div
                    className={appMode ? '' : 'px-3 pb-1'}
                    onContextMenu={e => outputContextMenu(e, e.currentTarget as HTMLElement)}
                  >
                    {cell.outputs.map((out, i) => <CellOutput key={i} output={out} cellId={cell.id} searchQuery={searchQuery} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="pb-0.5">
            {cell.cell_type === 'markdown' && <MarkdownCellComponent cell={cell} isActive={active && !appMode} />}
            {cell.cell_type === 'raw' && !appMode && <div className="text-xs text-text-muted p-2">Raw cell</div>}
          </div>
        )}
      </div>

      {/* add cell divider — shows on hover between cells */}
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

