import { useNotebookStore } from '../../stores/notebookStore';
import { useNotebookKeys } from '../../hooks/useNotebookKeys';
import { useDragState } from '../../hooks/useCellDrag';
import { CellContainer } from './CellContainer';

export function Notebook() {
  const cells = useNotebookStore(s => s.cells);
  const drag = useDragState();

  useNotebookKeys();

  return (
    <div data-notebook-root className="max-w-5xl mx-auto py-6 px-6 relative bg-bg min-h-full my-1">
      {cells.map((cell, index) => (
        <div key={cell.id} data-cell-idx={index} data-cell-id={cell.id}>
          {/* drop indicator line */}
          {drag.dragging && drag.dropIdx === index && drag.fromIdx !== index && (
            <div className="h-0.5 bg-accent rounded-full mx-4 mb-1 shadow-[0_0_6px_rgba(108,140,255,0.5)]" />
          )}
          <CellContainer cell={cell} index={index} />
        </div>
      ))}

      {/* drop indicator at the very end */}
      {drag.dragging && drag.dropIdx === cells.length && (
        <div className="h-0.5 bg-accent rounded-full mx-4 mb-2 shadow-[0_0_6px_rgba(108,140,255,0.5)]" />
      )}

      {/* ghost preview floating at cursor */}
      {drag.dragging && (
        <div
          className="fixed pointer-events-none z-50 bg-bg-elevated border border-accent/40
            rounded-lg px-4 py-2 shadow-xl text-xs font-mono text-text-secondary max-w-xs truncate"
          style={{ top: drag.mouseY - 16, left: '50%', transform: 'translateX(-50%)' }}
        >
          {drag.ghostLabel}
        </div>
      )}
    </div>
  );
}
