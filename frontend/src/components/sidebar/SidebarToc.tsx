import { useNotebookStore } from '../../stores/notebookStore';

interface TocEntry {
  level: number;
  text: string;
  cellId: string;
}

export function SidebarToc() {
  const cells = useNotebookStore(s => s.cells);

  // extract headings from markdown cells
  const entries: TocEntry[] = [];
  for (const cell of cells) {
    if (cell.cell_type !== 'markdown') continue;
    for (const line of cell.source.split('\n')) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        entries.push({
          level: match[1].length,
          text: match[2].trim(),
          cellId: cell.id,
        });
      }
    }
  }

  if (entries.length === 0) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">
        No headings found. Add <code className="bg-bg-elevated px-1 rounded"># Heading</code> in a markdown cell.
      </p>
    );
  }

  // find min level for normalization
  const minLevel = Math.min(...entries.map(e => e.level));

  return (
    <nav className="space-y-0.5">
      {entries.map((entry, i) => {
        const indent = (entry.level - minLevel) * 12;
        return (
          <button
            key={`${entry.cellId}-${i}`}
            onClick={() => {
              useNotebookStore.getState().setActiveCell(entry.cellId);
              setTimeout(() => {
                document.querySelector('[data-cell-active="true"]')
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }, 50);
            }}
            className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-bg-hover transition-colors"
            style={{ paddingLeft: `${8 + indent}px` }}
          >
            <span className={entry.level <= minLevel ? 'font-semibold text-text' : 'text-text-secondary'}>
              {entry.text}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
