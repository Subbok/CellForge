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

export function clearQueue() {
  const store = useNotebookStore.getState();
  for (const id of queue) {
    if (store.cells.find(c => c.id === id)?.status === 'queued') {
      store.setCellStatus(id, 'idle');
    }
  }
  queue = [];
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
