import { useNotebookStore } from '../stores/notebookStore';
import { useTabStore } from '../stores/tabStore';
import { ws } from './websocket';
import { initCollaboration, cleanup as cleanupCollab } from './collaboration';
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
  // Don't snapshot an empty store — this happens right after leaveEditor
  // cleared the notebook and before the new one is loaded, and would
  // otherwise overwrite the previous tab's snapshot with nothing.
  if (!s.filePath) return;

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

/**
 * Switch to another tab: snapshot the current tab, swap notebook state,
 * reconnect the WS to the target tab's kernel, and restart collaboration.
 * Without the ws/collab steps the new tab appears dead — messages go to
 * the previous tab's kernel and edits aren't shared with other users.
 */
export function switchToTab(id: string, username: string) {
  saveCurrentTab();
  useTabStore.getState().setActiveTab(id);

  const tab = useTabStore.getState().tabs.find(t => t.id === id);
  if (!tab) return;

  // Non-notebook tabs (data previews, Typst documents) don't own a kernel or
  // yjs notebook document, so we deliberately skip the WS/collab/notebook-
  // restore dance. Doing it anyway would launch a Python kernel and tear down
  // the kernel session of whatever notebook the user was editing before.
  if (tab.kind !== 'notebook') {
    window.history.pushState(null, '', `/notebook/${encodeURIComponent(tab.path)}`);
    return;
  }

  restoreTab(id);

  // reconnect WS + collab to the target tab. Without a kernel name we can't
  // know which kernel to attach, so fall back to the notebook metadata's
  // kernelspec, then to python3 as last resort.
  const nb = useNotebookStore.getState();
  const kernel = tab.kernelName
    ?? (nb.metadata.kernelspec?.name as string | undefined)
    ?? 'python3';
  ws.reconnect(kernel, tab.path);

  cleanupCollab();
  initCollaboration(tab.path, username);

  window.history.pushState(null, '', `/notebook/${encodeURIComponent(tab.path)}`);
}
