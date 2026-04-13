import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, Replace } from 'lucide-react';
import { useNotebookStore } from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';

interface Props {
  onClose: () => void;
}

interface Match {
  cellId: string;
  cellIndex: number;
  lineIndex: number;
  start: number;
  end: number;
  line: string;
}

export function SearchBar({ onClose: rawClose }: Props) {
  function onClose() {
    useUIStore.getState().setSearchQuery('');
    rawClose();
  }
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [current, setCurrent] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback((q: string) => {
    if (!q) { setMatches([]); setCurrent(-1); return; }
    const cells = useNotebookStore.getState().cells;
    const found: Match[] = [];
    const lower = q.toLowerCase();

    cells.forEach((cell, ci) => {
      const lines = cell.source.split('\n');
      lines.forEach((line, li) => {
        let idx = 0;
        const lineLower = line.toLowerCase();
        while (true) {
          const pos = lineLower.indexOf(lower, idx);
          if (pos === -1) break;
          found.push({
            cellId: cell.id,
            cellIndex: ci,
            lineIndex: li,
            start: pos,
            end: pos + q.length,
            line,
          });
          idx = pos + 1;
        }
      });
    });

    setMatches(found);
    setCurrent(found.length > 0 ? 0 : -1);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    search(query);
    useUIStore.getState().setSearchQuery(query);
  }, [query, search]);

  function goTo(idx: number) {
    if (matches.length === 0) return;
    const i = ((idx % matches.length) + matches.length) % matches.length;
    setCurrent(i);
    const m = matches[i];
    useNotebookStore.getState().setActiveCell(m.cellId);
    setTimeout(() => {
      document.querySelector('[data-cell-active="true"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
  }

  function replaceOne() {
    if (current < 0 || !matches[current]) return;
    const m = matches[current];
    const cell = useNotebookStore.getState().cells.find(c => c.id === m.cellId);
    if (!cell) return;

    const lines = cell.source.split('\n');
    const line = lines[m.lineIndex];
    lines[m.lineIndex] = line.slice(0, m.start) + replace + line.slice(m.end);
    useNotebookStore.getState().updateSource(m.cellId, lines.join('\n'));
    search(query); // re-search
  }

  function replaceAll() {
    if (!query || matches.length === 0) return;
    const store = useNotebookStore.getState();
    for (const cell of store.cells) {
      if (cell.source.toLowerCase().includes(query.toLowerCase())) {
        const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        store.updateSource(cell.id, cell.source.replace(re, replace));
      }
    }
    search(query);
  }

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border shrink-0">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && e.shiftKey) goTo(current - 1);
            else if (e.key === 'Enter') goTo(current + 1);
            else if (e.key === 'Escape') onClose();
          }}
          placeholder="Find..."
          className="field field-sm w-48"
        />

        {matches.length > 0 && (
          <span className="text-xs text-text-muted">
            {current + 1} / {matches.length}
          </span>
        )}
        {query && matches.length === 0 && (
          <span className="text-xs text-error">no results</span>
        )}

        <button onClick={() => goTo(current - 1)} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Previous (Shift+Enter)">
          <ChevronUp size={14} />
        </button>
        <button onClick={() => goTo(current + 1)} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Next (Enter)">
          <ChevronDown size={14} />
        </button>

        <button onClick={() => setShowReplace(!showReplace)}
          className={`p-1 rounded hover:bg-bg-hover ${showReplace ? 'text-accent' : 'text-text-muted'}`} title="Toggle replace">
          <Replace size={14} />
        </button>

        {showReplace && (
          <>
            <input
              value={replace}
              onChange={e => setReplace(e.target.value)}
              placeholder="Replace..."
              className="field field-sm w-40"
            />
            <button onClick={replaceOne}
              className="text-xs px-2 py-1 rounded hover:bg-bg-hover text-text-secondary">
              Replace
            </button>
            <button onClick={replaceAll}
              className="text-xs px-2 py-1 rounded hover:bg-bg-hover text-text-secondary">
              All
            </button>
          </>
        )}
      </div>

      <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted">
        <X size={14} />
      </button>
    </div>
  );
}
