import { Play, PlayCircle, RotateCcw, Square, Save, Eraser, Download, PanelRightClose, PanelRightOpen, LayoutTemplate, Code2, Cpu, ChevronDown, Plug } from 'lucide-react';
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

function kernelDot(status: string) {
  if (status === 'idle') return 'bg-success';
  if (status === 'busy' || status === 'starting' || status === 'restarting') return 'bg-warning';
  if (status === 'dead') return 'bg-error';
  return 'bg-text-muted';
}

function Btn({ title, onClick, children, disabled, primary }: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** Primary gets a tinted accent background so it stands out in the toolbar. */
  primary?: boolean;
}) {
  const base = 'p-1.5 rounded transition-colors disabled:opacity-30';
  const color = primary
    ? 'bg-accent/15 text-accent hover:bg-accent/25'
    : 'hover:bg-bg-hover text-text-secondary';
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

export function TopBar({ onGoHome, onExport, onSwitchKernel }: {
  onGoHome: () => void; onExport: () => void; onSwitchKernel: () => void;
}) {
  const { cells, activeCellId, dirty } = useNotebookStore();
  const { status, spec, availableSpecs } = useKernelStore();
  const { sidebarOpen, toggleSidebar, appMode, toggleAppMode } = useUIStore();
  const pluginButtons = useUIStore(s => s.pluginToolbarButtons);
  const execute = useExecuteCell();

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
    broadcastSaved();
  }

  return (
    <header className="h-11 flex items-center px-4 border-b border-border/60 bg-bg/90 backdrop-blur-sm gap-3 shrink-0">
      <button onClick={onGoHome} className="font-semibold text-accent text-sm tracking-tight hover:text-accent-hover transition-colors">
        CellForge
      </button>
      <div className="h-4 w-px bg-border/50" />

      <FileName />

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {/* primary action — tinted so Run stands out from the rest of the cluster */}
        <Btn title="Run cell (Shift+Enter)" onClick={runActiveCell} primary><Play size={16} /></Btn>
        <Btn title="Run all cells" onClick={runAllCells}><PlayCircle size={16} /></Btn>
        <Btn title="Clear all outputs" onClick={clearAllOutputs}><Eraser size={16} /></Btn>
        <Btn title="Restart kernel" onClick={() => {
          useKernelStore.getState().setStatus('restarting');
          useVariableStore.getState().clearAll();
          clearQueue();
          ws.reconnect(spec ?? 'python3', useNotebookStore.getState().filePath ?? undefined);
        }}><RotateCcw size={16} /></Btn>
        <Btn title="Interrupt" onClick={() => {
          ws.send('interrupt');
          clearQueue();
        }}><Square size={16} /></Btn>
        <div className="h-4 w-px bg-border/50 mx-0.5" />
        <Btn title="Save (Ctrl+S)" onClick={save} disabled={!dirty}><Save size={16} /></Btn>
        <Btn title="Export" onClick={onExport}><Download size={16} /></Btn>
        <div className="h-4 w-px bg-border/50 mx-0.5" />
        <button
          onClick={toggleAppMode}
          title={appMode ? 'Switch to Editor Mode' : 'Switch to App Mode'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
            appMode
              ? 'bg-accent/10 border-accent text-accent'
              : 'bg-bg-elevated border-border text-text-secondary hover:border-text-secondary/30'
          }`}
        >
          {appMode ? <LayoutTemplate size={14} /> : <Code2 size={14} />}
          {appMode ? 'App' : 'Code'}
        </button>
      </div>

      {/* plugin-contributed toolbar buttons */}
      {pluginButtons.length > 0 && (
        <>
          <div className="h-4 w-px bg-border/50" />
          <div className="flex items-center gap-1">
            {pluginButtons.map(btn => (
              <button
                key={btn.id}
                onClick={() => executeCommand(btn.command)}
                title={btn.label}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium
                  text-text-secondary hover:bg-bg-hover hover:text-text transition-colors"
              >
                <Plug size={12} />
                {btn.label}
              </button>
            ))}
          </div>
        </>
      )}

      <PresenceIndicator />

      <div className="h-4 w-px bg-border/50" />

      {/* kernel switcher — styled as a chip so it reads as interactive */}
      <button
        onClick={onSwitchKernel}
        title="Click to switch kernel"
        className="group flex items-center gap-2 px-2.5 h-7 rounded-lg border border-border bg-bg-elevated
          hover:border-text-muted/50 hover:bg-bg-hover transition-colors"
      >
        <Cpu size={13} className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0" />
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${kernelDot(status)}`} />
        <span className="text-xs text-text truncate max-w-[14ch]">
          {availableSpecs.find(s => s.name === spec)?.display_name ?? spec ?? 'No kernel'}
        </span>
        <span className="text-[9px] uppercase tracking-wider font-semibold text-text-muted px-1 py-0.5 rounded bg-bg-hover/60">
          {status}
        </span>
        <ChevronDown size={11} className="text-text-muted shrink-0" />
      </button>

      <Btn title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} onClick={toggleSidebar}>
        {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </Btn>
    </header>
  );
}
