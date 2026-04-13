import { useCallback } from 'react';
import { ws } from '../services/websocket';
import { trackExecution } from '../services/messageHandler';
import { useNotebookStore } from '../stores/notebookStore';
import { useKernelStore } from '../stores/kernelStore';
import * as bp from '../services/breakpoints';

// stores remaining code when paused at breakpoint
const pausedCode = new Map<string, string>();
// stores current line number in original code (1-indexed)
const pausedAt = new Map<string, number>();

export function useExecuteCell() {
  const clearOutputs = useNotebookStore(s => s.clearOutputs);
  const setCellStatus = useNotebookStore(s => s.setCellStatus);
  const setExecutingCell = useKernelStore(s => s.setExecutingCell);

  return useCallback((cellId: string, code: string) => {
    if (!code.trim()) return;

    const cells = useNotebookStore.getState().cells;
    const idx = cells.findIndex(c => c.id === cellId);

    // check for breakpoints
    const [before, after] = bp.splitAtBreakpoint(cellId, code);

    if (after !== null && before.trim()) {
      // has breakpoint — execute code before breakpoint, then pause
      clearOutputs(cellId);
      setCellStatus(cellId, 'running');
      setExecutingCell(cellId);

      const msgId = ws.send('execute_request', {
        cell_id: cellId,
        cell_index: idx,
        code: before,
      });
      trackExecution(msgId, cellId);

      pausedCode.set(cellId, after);
      const bpLine = before.split('\n').length + 1;
      pausedAt.set(cellId, bpLine);
      bp.setPausedLine(cellId, bpLine);
      // messageHandler will call onExecuteReply which sets paused
    } else if (after !== null && !before.trim()) {
      // breakpoint on first line — just pause immediately
      clearOutputs(cellId);
      setCellStatus(cellId, 'paused');
      pausedCode.set(cellId, after);
      pausedAt.set(cellId, 1);
      bp.setPausedLine(cellId, 1);
    } else {
      // no breakpoints — normal execution
      clearOutputs(cellId);
      setCellStatus(cellId, 'running');
      setExecutingCell(cellId);

      const msgId = ws.send('execute_request', {
        cell_id: cellId,
        cell_index: idx,
        code,
      });
      trackExecution(msgId, cellId);
    }
  }, [clearOutputs, setCellStatus, setExecutingCell]);
}

/// Execute one line from remaining code, pause again after.
export function stepExecution(cellId: string) {
  const remaining = pausedCode.get(cellId);
  if (!remaining) return;

  const lines = remaining.split('\n');
  const firstLine = lines[0];
  const rest = lines.slice(1).join('\n');

  const store = useNotebookStore.getState();
  const idx = store.cells.findIndex(c => c.id === cellId);

  const currentLine = pausedAt.get(cellId) ?? 1;

  if (rest.trim()) {
    pausedCode.set(cellId, rest);
    pausedAt.set(cellId, currentLine + 1);
    bp.setPausedLine(cellId, currentLine + 1);
  } else {
    pausedCode.delete(cellId);
    pausedAt.delete(cellId);
    bp.clearPausedLine(cellId);
  }

  if (!firstLine.trim()) {
    // empty line — skip, step again
    if (rest.trim()) {
      store.setCellStatus(cellId, 'paused');
    } else {
      store.setCellStatus(cellId, 'success');
    }
    return;
  }

  store.setCellStatus(cellId, 'running');
  useKernelStore.getState().setExecutingCell(cellId);

  const msgId = ws.send('execute_request', {
    cell_id: cellId,
    cell_index: idx,
    code: firstLine,
  });
  trackExecution(msgId, cellId);
  // onExecuteReply will set paused if pausedCode still has content
}

/// Run all remaining code without stopping.
export function continueExecution(cellId: string) {
  const remaining = pausedCode.get(cellId);
  if (!remaining) return;
  pausedCode.delete(cellId);
  pausedAt.delete(cellId);
  bp.clearPausedLine(cellId);

  const store = useNotebookStore.getState();
  const idx = store.cells.findIndex(c => c.id === cellId);

  store.setCellStatus(cellId, 'running');
  useKernelStore.getState().setExecutingCell(cellId);

  const msgId = ws.send('execute_request', {
    cell_id: cellId,
    cell_index: idx,
    code: remaining,
  });
  trackExecution(msgId, cellId);
}

export function isPaused(cellId: string): boolean {
  return pausedCode.has(cellId);
}

// called by messageHandler when execute_reply arrives
export function onExecuteReply(cellId: string) {
  if (pausedCode.has(cellId)) {
    useNotebookStore.getState().setCellStatus(cellId, 'paused');
    useKernelStore.getState().setExecutingCell(null);
  }
}
