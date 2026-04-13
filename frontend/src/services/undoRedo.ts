import { useNotebookStore } from '../stores/notebookStore';
import type { Cell } from '../lib/types';

// simple undo/redo for cell-level operations.
// we snapshot the entire cells array — good enough for notebook scale.

const MAX_HISTORY = 50;
const undoStack: Cell[][] = [];
const redoStack: Cell[][] = [];

let lastSnapshot = '';

/// Take a snapshot of current state if it changed.
export function snapshot() {
  const cells = useNotebookStore.getState().cells;
  const key = JSON.stringify(cells.map(c => ({ id: c.id, source: c.source, type: c.cell_type })));
  if (key === lastSnapshot) return; // nothing changed
  lastSnapshot = key;

  undoStack.push(structuredClone(cells));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

export function undo() {
  if (undoStack.length === 0) return;

  const current = useNotebookStore.getState().cells;
  redoStack.push(structuredClone(current));

  const prev = undoStack.pop()!;
  useNotebookStore.setState({ cells: prev, dirty: true });
  lastSnapshot = JSON.stringify(prev.map(c => ({ id: c.id, source: c.source, type: c.cell_type })));
}

export function redo() {
  if (redoStack.length === 0) return;

  const current = useNotebookStore.getState().cells;
  undoStack.push(structuredClone(current));

  const next = redoStack.pop()!;
  useNotebookStore.setState({ cells: next, dirty: true });
  lastSnapshot = JSON.stringify(next.map(c => ({ id: c.id, source: c.source, type: c.cell_type })));
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastSnapshot = '';
}

// auto-snapshot on structural cell changes

export function setupAutoSnapshot() {
  useNotebookStore.subscribe((state, prev) => {
    // only snapshot on STRUCTURAL changes: add, delete, reorder, type change.
    // source edits are handled by Monaco's own undo.
    const structural =
      state.cells.length !== prev.cells.length
      || state.cells.some((c, i) => prev.cells[i]?.id !== c.id || prev.cells[i]?.cell_type !== c.cell_type);
    if (!structural) return;

    snapshot();
  });
}
