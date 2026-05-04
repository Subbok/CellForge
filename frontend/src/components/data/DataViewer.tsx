import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader, EyeOff, BarChart3, X } from 'lucide-react';
import {
  api,
  type DataPreviewResponse,
  type DataColumnType,
  type DataStatsResponse,
} from '../../services/api';

const PAGE_SIZE = 500;

type SortState = { col: number; dir: 'asc' | 'desc' } | null;

/** Column header click cycles asc → desc → none. The "none" branch is what
 *  brings back the streaming (no-sort) backend path so you don't pay full
 *  file-read cost just to scroll. */
function nextSort(current: SortState, col: number): SortState {
  if (!current || current.col !== col) return { col, dir: 'asc' };
  if (current.dir === 'asc') return { col, dir: 'desc' };
  return null;
}

/** Right-align numbers and dates so columns compare visually; everything
 *  else (strings, bools, mixed) aligns left. Matches what pandas / Excel do. */
function alignFor(ty: DataColumnType): 'left' | 'right' {
  return ty === 'int' || ty === 'float' || ty === 'date' ? 'right' : 'left';
}

function formatCell(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: 'null', isNull: true };
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false', isNull: false };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { text: v.toLocaleString(), isNull: false };
    return { text: String(v), isNull: false };
  }
  return { text: String(v), isNull: false };
}

/** Predicate the row-filter input compiles to. Empty input → match-all.
 *  The filter is applied against the *current preview window*, not the
 *  whole file — server-side filtering would need full-file scans we don't
 *  pay for in the streaming path. */
function rowMatches(row: unknown[], queries: Record<number, string>): boolean {
  for (const [colKey, q] of Object.entries(queries)) {
    if (!q) continue;
    const ci = Number(colKey);
    const cell = row[ci];
    const text = cell == null ? '' : String(cell).toLowerCase();
    if (!text.includes(q.toLowerCase())) return false;
  }
  return true;
}

export function DataViewer({ path }: { path: string }) {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [data, setData] = useState<DataPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-column free-text filter applied client-side over the active page.
  const [filters, setFilters] = useState<Record<number, string>>({});
  // Hidden columns (by index). Persists across sort/page changes for the
  // same file; reset alongside the rest when the path changes.
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  // Stats panel state — fetched on demand because computing means / distinct
  // counts requires a full file pass.
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<DataStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    api
      .dataPreview(path, {
        offset,
        limit: PAGE_SIZE,
        sortCol: sort?.col,
        sortDir: sort?.dir,
      })
      .then(d => {
        if (cancelled) return;
        setData(d);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, offset, sort]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0);
    setSort(null);
    setFilters({});
    setHidden(new Set());
    setStats(null);
    setStatsOpen(false);
  }, [path]);

  useEffect(() => {
    if (!statsOpen || stats != null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatsLoading(true);
    api
      .dataStats(path)
      .then(s => {
        if (!cancelled) setStats(s);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statsOpen, stats, path]);

  const total = data?.total ?? null;
  const lastOffset = total != null ? Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE) : null;
  const canPrev = offset > 0;
  const canNext = data != null && (lastOffset == null ? data.rows.length === PAGE_SIZE : offset < lastOffset);

  const filename = useMemo(() => path.split('/').pop() ?? path, [path]);

  const visibleColumns = useMemo(() => {
    if (!data) return [];
    return data.schema
      .map((col, i) => ({ col, i }))
      .filter(({ i }) => !hidden.has(i));
  }, [data, hidden]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (Object.values(filters).every(v => !v)) return data.rows.map((row, ri) => ({ row, ri }));
    return data.rows
      .map((row, ri) => ({ row, ri }))
      .filter(({ row }) => rowMatches(row, filters));
  }, [data, filters]);

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--color-bg)' }}>
      <div
        className="shrink-0 flex items-center gap-3"
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <span className="font-mono text-sm text-text">{filename}</span>
        {data?.schema && (
          <span className="text-xs text-text-muted">
            {visibleColumns.length}/{data.schema.length} cols
          </span>
        )}
        {hidden.size > 0 && (
          <button
            onClick={() => setHidden(new Set())}
            className="text-xs text-accent hover:underline"
          >
            Show all
          </button>
        )}
        {loading && <Loader size={13} className="animate-spin text-text-muted" />}
        <div className="flex-1" />
        <button
          onClick={() => setStatsOpen(o => !o)}
          className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1.5 ${
            statsOpen ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-muted'
          }`}
          title="Per-column statistics"
        >
          <BarChart3 size={13} />
          Stats
        </button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto">
          {error && (
            <div className="p-4 text-sm text-error">Failed to load: {error}</div>
          )}
          {data && (
            <table className="w-full text-xs font-mono" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead className="sticky top-0 z-10" style={{ background: 'var(--color-bg-secondary)' }}>
                <tr>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      color: 'var(--color-text-muted)',
                      fontWeight: 400,
                      borderBottom: '1px solid var(--color-border)',
                      fontSize: 10,
                      minWidth: 48,
                    }}
                  >
                    #
                  </th>
                  {visibleColumns.map(({ col, i }) => {
                    const isSorted = sort?.col === i;
                    return (
                      <th
                        key={i}
                        title={`${col.name}: ${col.type}${col.nullable ? ' (nullable)' : ''}`}
                        style={{
                          textAlign: alignFor(col.type),
                          padding: '6px 8px',
                          color: isSorted ? 'var(--color-accent)' : 'var(--color-text)',
                          fontWeight: 500,
                          borderBottom: '1px solid var(--color-border)',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'top',
                        }}
                      >
                        <div className="inline-flex items-center gap-1">
                          <span
                            onClick={() => setSort(s => nextSort(s, i))}
                            style={{ cursor: 'pointer' }}
                          >
                            {col.name}
                          </span>
                          {isSorted ? (
                            sort!.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                          ) : (
                            <ChevronsUpDown
                              size={11}
                              className="opacity-30 cursor-pointer"
                              onClick={() => setSort(s => nextSort(s, i))}
                            />
                          )}
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 10, marginLeft: 4 }}>
                            {col.type}
                          </span>
                          <button
                            onClick={() => setHidden(h => new Set(h).add(i))}
                            title="Hide column"
                            className="opacity-0 group-hover:opacity-100 hover:text-error ml-1"
                            style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            <EyeOff size={11} />
                          </button>
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <input
                            placeholder="filter…"
                            value={filters[i] ?? ''}
                            onChange={e =>
                              setFilters(f => ({ ...f, [i]: e.target.value }))
                            }
                            className="w-full"
                            style={{
                              fontSize: 10,
                              padding: '2px 4px',
                              background: 'var(--color-bg)',
                              border: '1px solid var(--color-border-subtle)',
                              borderRadius: 3,
                              color: 'var(--color-text)',
                              fontFamily: 'inherit',
                              minWidth: 60,
                            }}
                          />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ row, ri }) => (
                  <tr key={ri} className="hover:bg-bg-hover">
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '4px 8px',
                        color: 'var(--color-text-muted)',
                        fontSize: 10,
                        borderBottom: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      {data.offset + ri}
                    </td>
                    {visibleColumns.map(({ col, i: ci }) => {
                      const cell = formatCell(row[ci]);
                      return (
                        <td
                          key={ci}
                          style={{
                            textAlign: alignFor(col.type),
                            padding: '4px 8px',
                            borderBottom: '1px solid var(--color-border-subtle)',
                            color: cell.isNull ? 'var(--color-text-muted)' : 'var(--color-text)',
                            fontStyle: cell.isNull ? 'italic' : 'normal',
                            maxWidth: 320,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={cell.text}
                        >
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {statsOpen && (
          <aside
            className="shrink-0 overflow-auto"
            style={{
              width: 280,
              borderLeft: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span className="text-xs font-medium text-text">Column stats</span>
              <button
                onClick={() => setStatsOpen(false)}
                className="text-text-muted hover:text-text"
              >
                <X size={13} />
              </button>
            </div>
            {statsLoading && (
              <div className="p-3 text-xs text-text-muted inline-flex items-center gap-2">
                <Loader size={12} className="animate-spin" />
                Computing…
              </div>
            )}
            {stats && (
              <div className="p-2 space-y-3 text-xs">
                <div className="text-text-muted">
                  {stats.total.toLocaleString()} rows total
                </div>
                {stats.schema.map((col, i) => {
                  const s = stats.stats[i];
                  if (!s) return null;
                  return (
                    <div
                      key={i}
                      style={{
                        padding: 8,
                        borderRadius: 6,
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-text">{col.name}</span>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                          {col.type}
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-text-muted">
                        <Stat label="non-null" value={(s.count - s.null_count).toLocaleString()} />
                        <Stat label="nulls" value={s.null_count.toLocaleString()} />
                        <Stat label="distinct" value={s.distinct == null ? '—' : s.distinct.toLocaleString()} />
                        {s.mean != null && <Stat label="mean" value={formatNum(s.mean)} />}
                        {s.min != null && <Stat label="min" value={String(s.min)} />}
                        {s.max != null && <Stat label="max" value={String(s.max)} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>

      <div
        className="shrink-0 flex items-center justify-between text-xs"
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-muted)',
        }}
      >
        <div>
          {data && (
            <span>
              Rows {data.offset + 1}–{data.offset + data.rows.length}
              {total != null ? ` of ${total.toLocaleString()}` : ''}
              {Object.values(filters).some(v => v) && ` — ${filteredRows.length} match filter`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={!canPrev}
            className="px-2 py-1 rounded hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!canNext}
            className="px-2 py-1 rounded hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  // 4 sigfigs is enough at this granularity — full precision goes in the
  // viewer cell on the relevant row, this is the at-a-glance summary.
  return n.toPrecision(4);
}
