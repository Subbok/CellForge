import { ws } from './websocket';
import { useNotebookStore } from '../stores/notebookStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUIStore } from '../stores/uiStore';
import { useVariableStore } from '../stores/variableStore';
import { onCellDone } from './executionQueue';
import { onExecuteReply } from '../hooks/useKernel';
import type { WsMessage, KernelStatus, CellOutput, VariableInfo, DagEdge } from '../lib/types';
import type { DataFramePreview } from '../stores/variableStore';

function cellId(msg: WsMessage): string {
  return (msg.payload?.cell_id as string) ?? '';
}

// track when cells started executing so we can show elapsed time
const execStart = new Map<string, number>();

export function trackExecution(_msgId: string, cellId: string) {
  execStart.set(cellId, Date.now());
}

let _setup = false;

export function setupMessageHandlers() {
  if (_setup) return; // don't double-register (React StrictMode calls effects twice)
  _setup = true;

  const nb = useNotebookStore;
  const kernel = useKernelStore;

  ws.on('kernel_status', (msg) => {
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const state = (content?.execution_state as string)
      ?? (msg.payload?.status as string)
      ?? 'idle';
    kernel.getState().setStatus(state as KernelStatus);
    // When kernel restarts, clear variables for all clients
    if (state === 'starting' || state === 'restarting') {
      useVariableStore.getState().setVars({});
    }
  });

  // execute_input — kernel started executing a cell. Clear old outputs so they
  // don't accumulate when another user re-runs the same cell.
  ws.on('execute_input', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    nb.getState().clearOutputs(id);
    nb.getState().setCellStatus(id, 'running');
  });

  ws.on('stream', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    nb.getState().appendOutput(id, {
      output_type: 'stream',
      name: (content?.name as CellOutput['name']) ?? 'stdout',
      text: (content?.text as string) ?? '',
    });
  });

  ws.on('execute_result', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    nb.getState().appendOutput(id, {
      output_type: 'execute_result',
      data: content?.data as Record<string, unknown> | undefined,
      metadata: content?.metadata as Record<string, unknown> | undefined,
      execution_count: content?.execution_count as number | null | undefined,
    });
  });

  ws.on('display_data', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const transient = msg.payload?.transient as Record<string, unknown> | undefined;
    const displayId = transient?.display_id as string | undefined;
    nb.getState().appendOutput(id, {
      output_type: 'display_data',
      data: content?.data as Record<string, unknown> | undefined,
      metadata: content?.metadata as Record<string, unknown> | undefined,
      _display_id: displayId,
    } as CellOutput & { _display_id?: string });
  });

  ws.on('error', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    nb.getState().appendOutput(id, {
      output_type: 'error',
      ename: (content?.ename as string) ?? 'Error',
      evalue: (content?.evalue as string) ?? '',
      traceback: (content?.traceback as string[]) ?? [],
    });
    nb.getState().setCellStatus(id, 'error');
  });

  ws.on('execute_reply', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const status = content?.status as string | undefined;

    // backend sends the actual elapsed time (measured server-side, accurate)
    const elapsed = msg.payload?.elapsed_ms as number | undefined;

    nb.getState().setExecCount(id, (content?.execution_count as number | null) ?? null);
    nb.getState().setCellStatus(id, status === 'ok' ? 'success' : 'error');
    if (elapsed != null) {
      nb.getState().setExecTime(id, elapsed);
    }
    kernel.getState().setExecutingCell(null);
    onCellDone(id);
    onExecuteReply(id);
    // a cell just finished — it may have written files to the notebook's cwd,
    // so tell the file sidebar to refresh its listing
    useUIStore.getState().bumpFilesRefresh();
  });

  // clear_output — kernel asks us to wipe cell outputs (used by progress bars)
  // wait=true means "don't clear until the next output arrives" — we implement
  // this by adding the cell to pendingFirstOutput so appendOutput replaces
  // instead of appending.
  ws.on('clear_output', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const wait = (content?.wait as boolean) ?? false;
    if (wait) {
      // defer: next appendOutput will replace everything
      nb.setState(s => {
        const next = new Set(s.pendingFirstOutput);
        next.add(id);
        return { pendingFirstOutput: next };
      });
    } else {
      // immediate clear
      nb.getState().clearOutputs(id);
    }
  });

  // update_display_data — replace an existing output with matching display_id
  // Falls back to append if no matching output is found.
  ws.on('update_display_data', (msg) => {
    const id = cellId(msg);
    if (!id) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const transient = msg.payload?.transient as Record<string, unknown> | undefined;
    const displayId = transient?.display_id as string | undefined;

    const output: CellOutput & { _display_id?: string } = {
      output_type: 'display_data',
      data: content?.data as Record<string, unknown> | undefined,
      metadata: content?.metadata as Record<string, unknown> | undefined,
      _display_id: displayId,
    };

    if (displayId) {
      // try to find and replace existing output with this display_id
      const cell = nb.getState().cells.find(c => c.id === id);
      const idx = cell?.outputs.findIndex((o) => (o as CellOutput & { _display_id?: string })._display_id === displayId) ?? -1;
      if (idx >= 0) {
        nb.setState(s => ({
          cells: s.cells.map(c =>
            c.id === id
              ? { ...c, outputs: c.outputs.map((o, j: number) => j === idx ? output : o) }
              : c
          ),
        }));
        return;
      }
    }
    // fallback: append as new
    nb.getState().appendOutput(id, output);
  });

  ws.on('variables_update', (msg) => {
    const vars = msg.payload?.variables as Record<string, VariableInfo> | undefined;
    if (vars) useVariableStore.getState().setVars(vars);
  });

  ws.on('variable_detail', (msg) => {
    const preview = msg.payload?.preview as DataFramePreview | undefined;
    if (preview) useVariableStore.getState().setPreview(preview);
  });

  ws.on('dependency_update', (msg) => {
    const staleCells = (msg.payload?.stale_cells as string[]) ?? [];
    const dag = msg.payload?.dag as Record<string, unknown> | undefined;
    const dagEdges = (dag?.edges as DagEdge[]) ?? [];
    nb.getState().setDag(dagEdges, staleCells);

    // Reactive execution! If there are stale cells, run them automatically
    // in the order provided by the backend (only if enabled in settings).
    // Skip cells that are already running or queued to prevent cascade loops.
    const isReactive = useUIStore.getState().reactiveEnabled;
    if (isReactive && staleCells.length > 0) {
      const cells = nb.getState().cells;
      const toRun = staleCells.filter(id => {
        const cell = cells.find(c => c.id === id);
        return cell && cell.status !== 'running' && cell.status !== 'queued';
      });
      if (toRun.length > 0) {
        import('./executionQueue').then(eq => {
          eq.queueCells(toRun);
        });
      }
    }
  });
}
