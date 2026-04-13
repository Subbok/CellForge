import { useNotebookStore } from '../../stores/notebookStore';
import type { DagEdge } from '../../lib/types';

export function SidebarDeps() {
  const cells = useNotebookStore(s => s.cells);
  const dagEdges = useNotebookStore(s => s.dagEdges);
  const staleCells = useNotebookStore(s => s.staleCells);

  const codeCells = cells.filter(c => c.cell_type === 'code');

  if (codeCells.length === 0) {
    return <p className="text-xs text-text-muted py-4 text-center">No code cells yet.</p>;
  }

  // build lookup: cellId -> incoming edges (who does this cell depend on)
  const incoming = new Map<string, DagEdge[]>();
  // build lookup: cellId -> outgoing edges (who depends on this cell)
  const outgoing = new Map<string, DagEdge[]>();

  for (const edge of dagEdges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  return (
    <div className="text-xs space-y-0.5">
      {dagEdges.length === 0 && codeCells.length > 0 && (
        <p className="text-text-muted py-2 text-center mb-2">
          Run some cells to see dependencies.
        </p>
      )}

      {codeCells.map(cell => {
        const firstLine = cell.source.split('\n')[0]?.trim() || '(empty)';
        const label = firstLine.length > 35 ? firstLine.slice(0, 35) + '...' : firstLine;
        const isStale = staleCells.includes(cell.id);
        const deps = incoming.get(cell.id) ?? [];
        const dependents = outgoing.get(cell.id) ?? [];

        const statusColor = cell.status === 'success' ? 'bg-success'
          : cell.status === 'error' ? 'bg-error'
          : cell.status === 'running' ? 'bg-cell-running animate-pulse'
          : isStale ? 'bg-cell-stale'
          : 'bg-text-muted/30';

        return (
          <div key={cell.id}>
            <button
              onClick={() => {
                useNotebookStore.getState().setActiveCell(cell.id);
                setTimeout(() => {
                  document.querySelector('[data-cell-active="true"]')
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }, 50);
              }}
              className="w-full text-left px-2 py-2 rounded hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
                <span className="font-mono text-text-secondary break-all leading-tight">{label}</span>
                {cell.execTimeMs != null && (
                  <span className="text-text-muted ml-auto shrink-0">
                    {cell.execTimeMs < 1000 ? `${cell.execTimeMs}ms` : `${(cell.execTimeMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>

              {/* incoming deps: what this cell uses */}
              {deps.length > 0 && (
                <div className="mt-1 ml-4 flex flex-wrap gap-1">
                  <span className="text-text-muted">uses:</span>
                  {deps.map((d, i) => (
                    <span key={i} className="inline-flex gap-0.5">
                      {d.names.map(n => (
                        <code key={n} className="px-1 py-0.5 bg-accent/10 text-accent rounded text-[10px] break-all">{n}</code>
                      ))}
                    </span>
                  ))}
                </div>
              )}

              {/* outgoing deps: what depends on this cell */}
              {dependents.length > 0 && (
                <div className="mt-1 ml-4 flex flex-wrap gap-1">
                  <span className="text-text-muted">defines:</span>
                  {[...new Set(dependents.flatMap(d => d.names))].map(n => (
                    <code key={n} className="px-1 py-0.5 bg-success/10 text-success rounded text-[10px] break-all">{n}</code>
                  ))}
                </div>
              )}

              {isStale && (
                <div className="mt-1 ml-4 text-cell-stale">needs re-run</div>
              )}
            </button>
          </div>
        );
      })}

      {dagEdges.length > 0 && (
        <div className="border-t border-border mt-3 pt-2 text-text-muted text-center">
          {dagEdges.length} dependency {dagEdges.length === 1 ? 'link' : 'links'}
        </div>
      )}
    </div>
  );
}
