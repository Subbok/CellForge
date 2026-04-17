// High-level notebook operations that also handle collab broadcast.
// Call these from UI code instead of store.addCell / store.deleteCell
// directly — that way both peers stay in sync and no one adds a ghost cell.

import { useNotebookStore } from '../stores/notebookStore';
import { uuid } from '../lib/uuid';
import { broadcastCellOp, isActive as isCollabActive, clearCellText, unbindEditor } from './collaboration';
import { ws } from './websocket';
import type { CellType } from '../lib/types';

export function addCellSynced(type: CellType, index?: number): string {
  const id = uuid();
  useNotebookStore.getState().addCell(type, index, id);
  if (isCollabActive()) {
    const store = useNotebookStore.getState();
    // resolve the index we actually inserted at so remote peers land the same spot
    let resolvedIndex = index;
    if (resolvedIndex == null) {
      resolvedIndex = store.cells.findIndex(c => c.id === id);
      if (resolvedIndex < 0) resolvedIndex = store.cells.length - 1;
    }
    broadcastCellOp({ type: 'add', cellType: type, index: resolvedIndex, cellId: id });
  }
  return id;
}

export function deleteCellSynced(id: string) {
  const before = useNotebookStore.getState().cells.length;
  useNotebookStore.getState().deleteCell(id);
  const after = useNotebookStore.getState().cells.length;
  if (after < before) {
    // the cell is gone from the store — release its Y.Text + Monaco binding
    // so stale content doesn't come back on rejoin
    unbindEditor(id);
    clearCellText(id);
    // tell the server to prune per-cell state (cell_sources used by reactive DAG)
    // so long-running sessions don't leak one entry per deleted cell
    ws.send('cell_deleted', { cell_id: id });
    if (isCollabActive()) {
      broadcastCellOp({ type: 'delete', cellId: id });
    }
  }
}
