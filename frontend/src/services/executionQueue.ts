import { ws } from './websocket';
import { useNotebookStore } from '../stores/notebookStore';
import { useKernelStore } from '../stores/kernelStore';
import { trackExecution } from './messageHandler';

// sequential execution queue — run cells one at a time,
// waiting for each to finish before starting the next.

let queue: string[] = [];
let running = false;

export function queueCells(cellIds: string[]) {
  queue.push(...cellIds);
  // mark them all as queued
  const store = useNotebookStore.getState();
  for (const id of cellIds) {
    store.setCellStatus(id, 'queued');
  }
  drain();
}

/**
 * Clear the run queue. Pass `abortRunning = true` (the restart path does
 * this) to also flip any currently-`running` cell back to `idle` and
 * clear the kernel store's executingCell. Without that, the user sees
 * "Running…" stuck on the in-flight cell forever after a restart —
 * the kernel is dead and the execute_reply will never arrive.
 */
export function clearQueue(abortRunning: boolean = false) {
  const store = useNotebookStore.getState();
  for (const id of queue) {
    if (store.cells.find(c => c.id === id)?.status === 'queued') {
      store.setCellStatus(id, 'idle');
    }
  }
  queue = [];
  if (abortRunning) {
    for (const cell of store.cells) {
      if (cell.status === 'running') {
        store.setCellStatus(cell.id, 'idle');
      }
    }
    useKernelStore.getState().setExecutingCell(null);
    // Reset the queue's internal "we have a cell in flight" flag —
    // without this, the next queueCells() call gets stuck on a
    // phantom running cell that no kernel will ever ack.
    running = false;
  }
}

function drain() {
  if (running || queue.length === 0) return;

  const cellId = queue.shift()!;
  const store = useNotebookStore.getState();
  const cell = store.cells.find(c => c.id === cellId);
  if (!cell || cell.cell_type !== 'code') {
    // skip non-code cells
    drain();
    return;
  }

  running = true;
  // Don't clearOutputs immediately (prevents layout jump). Instead mark as
  // pending so the FIRST new output atomically replaces all old outputs.
  store.setCellStatus(cellId, 'running');
  useNotebookStore.setState(s => {
    const next = new Set(s.pendingFirstOutput);
    next.add(cellId);
    return { pendingFirstOutput: next };
  });
  useKernelStore.getState().setExecutingCell(cellId);

  const idx = store.cells.findIndex(c => c.id === cellId);
  const cellLanguage = (cell.metadata?.language as string | undefined)
    ?? useKernelStore.getState().availableSpecs.find(sp => sp.name === useKernelStore.getState().spec)?.language
    ?? 'python';
  const msgId = ws.send('execute_request', {
    cell_id: cellId,
    cell_index: idx,
    code: cell.source,
    language: cellLanguage.toLowerCase(),
  });
  trackExecution(msgId, cellId);
}

// called by messageHandler when execute_reply arrives
export function onCellDone(_cellId: string) {
  if (running) {
    running = false;
    drain();
  }
}
