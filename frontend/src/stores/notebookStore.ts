import { create } from 'zustand';
import type { Cell, CellOutput, CellType, DagEdge, Notebook, NotebookMetadata } from '../lib/types';
import { uuid } from '../lib/uuid';

function makeCell(type: CellType, id?: string): Cell {
  return {
    id: id ?? uuid(),
    cell_type: type,
    source: '',
    metadata: {},
    outputs: [],
    execution_count: null,
    status: 'idle',
    execTimeMs: null,
  };
}

function patchCell(cells: Cell[], id: string, patch: Partial<Cell>): Cell[] {
  return cells.map(c => c.id === id ? { ...c, ...patch } : c);
}

interface NotebookState {
  filePath: string | null;
  metadata: NotebookMetadata;
  cells: Cell[];
  activeCellId: string | null;
  dirty: boolean;
  dagEdges: DagEdge[];
  staleCells: string[];
  diffView: { cellId: string; oldSource: string } | null;
  /** IDs of cells that have started executing but haven't received their first new output yet. */
  pendingFirstOutput: Set<string>;

  loadNotebook(path: string, nb: Notebook): void;
  addCell(type: CellType, index?: number, cellId?: string): void;
  deleteCell(id: string): void;
  /** Swap a cell's type in place — preserves id and source, clears outputs. */
  changeCellType(id: string, newType: CellType): void;
  moveCell(id: string, dir: 'up' | 'down'): void;
  reorderCell(fromIdx: number, toIdx: number): void;
  updateSource(id: string, src: string): void;
  setCellOutputs(id: string, outputs: CellOutput[]): void;
  appendOutput(id: string, output: CellOutput): void;
  clearOutputs(id: string): void;
  setExecCount(id: string, n: number | null): void;
  setCellStatus(id: string, status: Cell['status']): void;
  setExecTime(id: string, ms: number): void;
  setCellMetadata(cellId: string, meta: Record<string, unknown>): void;
  setActiveCell(id: string | null): void;
  setDag(edges: DagEdge[], stale: string[]): void;
  setDiffView(diff: { cellId: string; oldSource: string } | null): void;
}

export const useNotebookStore = create<NotebookState>((set) => ({
  filePath: null,
  metadata: {},
  cells: [makeCell('code')],
  activeCellId: null,
  dirty: false,
  dagEdges: [],
  staleCells: [],
  diffView: null,
  pendingFirstOutput: new Set(),

  loadNotebook: (path, nb) => set({
    filePath: path,
    metadata: nb.metadata,
    cells: nb.cells.map(c => ({
      ...c,
      source: Array.isArray(c.source) ? (c.source as string[]).join('') : c.source,
      outputs: c.outputs ?? [],
      execution_count: c.execution_count ?? null,
      status: 'idle' as const,
      execTimeMs: null,
    })),
    activeCellId: nb.cells[0]?.id ?? null,
    dirty: false,
  }),

  addCell: (type, index, cellId) => set(s => {
    if (cellId && s.cells.some(c => c.id === cellId)) {
      return { activeCellId: cellId };
    }
    const cell = makeCell(type, cellId);
    const next = [...s.cells];
    next.splice(index ?? next.length, 0, cell);
    return { cells: next, activeCellId: cell.id, dirty: true };
  }),

  changeCellType: (id, newType) => set(s => ({
    cells: s.cells.map(c =>
      c.id === id
        ? {
            ...c,
            cell_type: newType,
            // clear execution state when switching types — markdown/raw don't
            // have outputs, and even code→code should reset
            outputs: [],
            execution_count: null,
            status: 'idle' as const,
            execTimeMs: null,
          }
        : c
    ),
    dirty: true,
  })),

  deleteCell: (id) => set(s => {
    if (s.cells.length <= 1) return s;
    const idx = s.cells.findIndex(c => c.id === id);
    const next = s.cells.filter(c => c.id !== id);
    return {
      cells: next,
      activeCellId: s.activeCellId === id
        ? (next[Math.min(idx, next.length - 1)]?.id ?? null)
        : s.activeCellId,
      dirty: true,
    };
  }),

  reorderCell: (from, to) => set(s => {
    if (from === to || from < 0 || to < 0 || from >= s.cells.length || to >= s.cells.length) return s;
    const next = [...s.cells];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { cells: next, dirty: true };
  }),

  moveCell: (id, dir) => set(s => {
    const i = s.cells.findIndex(c => c.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= s.cells.length) return s;
    const next = [...s.cells];
    [next[i], next[j]] = [next[j], next[i]];
    return { cells: next, dirty: true };
  }),

  updateSource: (id, src) => set(s => ({
    cells: patchCell(s.cells, id, { source: src }),
    dirty: true,
  })),

  setCellOutputs: (id, outputs) => set(s => ({
    cells: patchCell(s.cells, id, { outputs }),
  })),

  appendOutput: (id, output) => set(s => {
    // Atomic replacement logic.
    // If this is the FIRST output since execution started, clear old ones first.
    const isPending = s.pendingFirstOutput.has(id);
    const newPending = new Set(s.pendingFirstOutput);
    newPending.delete(id);

    return {
      pendingFirstOutput: newPending,
      cells: s.cells.map(c =>
        c.id === id 
          ? { ...c, outputs: isPending ? [output] : [...c.outputs, output] } 
          : c
      ),
    };
  }),

  clearOutputs: (id) => set(s => ({
    cells: patchCell(s.cells, id, { outputs: [], execution_count: null }),
    dirty: true,
  })),

  setExecCount: (id, n) => set(s => ({
    cells: patchCell(s.cells, id, { execution_count: n }),
  })),

  setCellStatus: (id, status) => set(s => {
    // If starting to run, mark as pending first output to enable atomic swap
    const newPending = new Set(s.pendingFirstOutput);
    let cells = s.cells;

    if (status === 'running') {
      newPending.add(id);
    } else {
      // If we finished (success/error) but never got a new output, clear the old ones now
      if (newPending.has(id)) {
        cells = patchCell(cells, id, { outputs: [] });
      }
      newPending.delete(id);
    }
    
    return {
      cells: patchCell(cells, id, { status }),
      pendingFirstOutput: newPending,
    };
  }),

  setExecTime: (id, ms) => set(s => ({
    cells: patchCell(s.cells, id, { execTimeMs: ms }),
  })),

  setCellMetadata: (cellId, meta) => set(s => ({
    cells: s.cells.map(c =>
      c.id === cellId ? { ...c, metadata: { ...c.metadata, ...meta } } : c
    ),
    dirty: true,
  })),

  setActiveCell: (id) => set({ activeCellId: id }),
  setDiffView: (diff) => set({ diffView: diff }),

  setDag: (edges, stale) => set(s => ({
    dagEdges: edges,
    staleCells: stale,
    cells: s.cells.map(c =>
      stale.includes(c.id) && c.status !== 'running' && c.status !== 'queued'
        ? { ...c, status: 'stale' as const }
        : c
    ),
  })),
}));
