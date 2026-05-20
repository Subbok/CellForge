import { useNotebookStore } from '../../stores/notebookStore';
import { useNotebookKeys } from '../../hooks/useNotebookKeys';
import { useDragState } from '../../hooks/useCellDrag';
import { CellContainer } from './CellContainer';

export function Notebook() {
  const cells = useNotebookStore(s => s.cells);
  const drag = useDragState();

  useNotebookKeys();

  return (
    <div data-notebook-root className="max-w-5xl mx-auto py-4 px-3 sm:px-5 relative bg-bg min-h-full my-1">
      {cells.map((cell, index) => (
        <div key={cell.id} data-cell-idx={index} data-cell-id={cell.id}>
          {/* Drop indicator line. The key is critical — without it React
              reconciles the two sibling children (indicator + CellContainer)
              by position; when the indicator appears/disappears during drag
              it shifts CellContainer's position and React unmounts+remounts
              it, disposing Monaco mid-render → "InstantiationService disposed". */}
          {drag.dragging && drag.dropIdx === index && drag.fromIdx !== index && (
            <div key="drop-indicator" className="h-0.5 bg-accent rounded-full mx-4 mb-1 shadow-[0_0_6px_rgba(108,140,255,0.5)]" />
          )}
          <CellContainer key="cell" cell={cell} index={index} />
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
