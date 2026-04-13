import { useNotebookStore } from '../stores/notebookStore';
import { useTabStore } from '../stores/tabStore';
import type { Cell, NotebookMetadata, DagEdge } from '../lib/types';

// saves/restores notebook state when switching tabs

interface TabSnapshot {
  filePath: string | null;
  metadata: NotebookMetadata;
  cells: Cell[];
  activeCellId: string | null;
  dirty: boolean;
  dagEdges: DagEdge[];
  staleCells: string[];
}

const snapshots = new Map<string, TabSnapshot>();

export function saveCurrentTab() {
  const activeId = useTabStore.getState().activeTabId;
  if (!activeId) return;

  const s = useNotebookStore.getState();
  snapshots.set(activeId, {
    filePath: s.filePath,
    metadata: s.metadata,
    cells: s.cells,
    activeCellId: s.activeCellId,
    dirty: s.dirty,
    dagEdges: s.dagEdges,
    staleCells: s.staleCells,
  });
}

export function restoreTab(tabId: string) {
  const snap = snapshots.get(tabId);
  if (!snap) return false;

  useNotebookStore.setState({
    filePath: snap.filePath,
    metadata: snap.metadata,
    cells: snap.cells,
    activeCellId: snap.activeCellId,
    dirty: snap.dirty,
    dagEdges: snap.dagEdges,
    staleCells: snap.staleCells,
  });
  return true;
}

export function removeTabSnapshot(tabId: string) {
  snapshots.delete(tabId);
}
