import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useNotebookStore } from '../../stores/notebookStore';
import { lineDiff } from '../../lib/diff';
import { RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

interface CellChange {
  cell_id: string;
  change: 'edited' | 'added' | 'deleted';
  summary: string;
  old_source?: string;
  new_source?: string;
}

interface HistoryItem {
  id: number;
  username: string;
  action: string;
  changed_cells: string;
  created_at: string;
}

export function SidebarHistory() {
  const filePath = useNotebookStore(s => s.filePath);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!filePath) return;
    api.fileHistory(filePath).then(setHistory).catch(() => {});
  }, [filePath]);

  // refresh history after saves
  const dirty = useNotebookStore(s => s.dirty);
  useEffect(() => {
    if (!dirty && filePath) {
      api.fileHistory(filePath).then(setHistory).catch(() => {});
    }
  }, [dirty, filePath]);

  if (!filePath) {
    return <p className="text-xs text-text-muted py-4 text-center">Save a file to see history.</p>;
  }

  async function restore(id: number) {
    try {
      const raw = await api.historySnapshot(id);
      const nb = typeof raw === 'string' ? JSON.parse(raw) : raw;
      useNotebookStore.getState().loadNotebook(filePath!, nb);
    } catch { /* ignored */ }
  }

  function formatTime(ts: string) {
    try {
      const d = new Date(ts.includes('T') ? ts : ts + 'Z');
      return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  }

  function parseChanges(json: string): CellChange[] {
    try { return JSON.parse(json); }
    catch { return []; }
  }

  return (
    <div className="text-xs space-y-0.5">
      {history.length === 0 && (
        <p className="text-text-muted py-4 text-center">No history yet.</p>
      )}
      {history.map(h => {
        const changes = parseChanges(h.changed_cells);
        const isExpanded = expanded === h.id;

        return (
          <div key={h.id} className="rounded hover:bg-bg-hover/50 transition-colors">
            <div className="flex items-center gap-2 px-2 py-2 cursor-pointer"
              onClick={() => setExpanded(isExpanded ? null : h.id)}>
              {changes.length > 0
                ? isExpanded ? <ChevronDown size={11} className="text-text-muted shrink-0" /> : <ChevronRight size={11} className="text-text-muted shrink-0" />
                : <div className="w-3" />}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-accent">@{h.username}</span>
                {changes.length > 0 && (
                  <span className="text-text-muted ml-1">
                    {changes.filter(c => c.change === 'edited').length > 0 && `${changes.filter(c => c.change === 'edited').length} edited`}
                    {changes.filter(c => c.change === 'added').length > 0 && ` +${changes.filter(c => c.change === 'added').length}`}
                    {changes.filter(c => c.change === 'deleted').length > 0 && ` -${changes.filter(c => c.change === 'deleted').length}`}
                  </span>
                )}
                <div className="text-text-muted text-[10px]">{formatTime(h.created_at)}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); restore(h.id); }} title="Restore"
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-warning shrink-0">
                <RotateCcw size={11} />
              </button>
            </div>

            {isExpanded && changes.length > 0 && (
              <div className="px-2 pb-2 space-y-1.5">
                {changes.map((c, i) => (
                  <CellDiff key={i} change={c} onShowInline={() => {
                    if (c.change === 'edited' && c.old_source) {
                      useNotebookStore.getState().setDiffView({ cellId: c.cell_id, oldSource: c.old_source });
                      useNotebookStore.getState().setActiveCell(c.cell_id);
                      setTimeout(() => {
                        document.querySelector('[data-cell-active="true"]')
                          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                      }, 50);
                    }
                  }} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CellDiff({ change, onShowInline }: { change: CellChange; onShowInline?: () => void }) {
  const badge = change.change === 'added' ? 'bg-success/20 text-success'
    : change.change === 'deleted' ? 'bg-error/20 text-error'
    : 'bg-warning/20 text-warning';

  const diff = change.change === 'edited' && change.old_source && change.new_source
    ? lineDiff(change.old_source, change.new_source)
    : null;

  return (
    <div className="border border-border rounded overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 bg-bg-elevated">
        <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${badge}`}>{change.change}</span>
        <span className="text-[10px] text-text-muted truncate flex-1">{change.summary}</span>
        {change.change === 'edited' && onShowInline && (
          <button onClick={onShowInline}
            className="text-[9px] text-accent hover:text-accent-hover shrink-0">
            show
          </button>
        )}
      </div>
      {diff && (
        <div className="max-h-32 overflow-y-auto text-[10px] font-mono leading-relaxed">
          {diff.map((line, i) => (
            <div key={i} className={
              line.type === 'add' ? 'bg-success/10 text-success px-2' :
              line.type === 'del' ? 'bg-error/10 text-error px-2 line-through' :
              'text-text-muted px-2'
            }>
              <span className="select-none mr-1.5 text-text-muted/50">
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              {line.text || '\u00A0'}
            </div>
          ))}
        </div>
      )}
      {change.change === 'added' && change.new_source && (
        <pre className="text-[10px] font-mono text-success/80 px-2 py-1 max-h-20 overflow-y-auto">
          {change.new_source.slice(0, 200)}
        </pre>
      )}
      {change.change === 'deleted' && change.old_source && (
        <pre className="text-[10px] font-mono text-error/80 line-through px-2 py-1 max-h-20 overflow-y-auto">
          {change.old_source.slice(0, 200)}
        </pre>
      )}
    </div>
  );
}
