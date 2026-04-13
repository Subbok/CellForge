import { useVariableStore, type DataFramePreview } from '../../stores/variableStore';
import { useKernelStore } from '../../stores/kernelStore';
import { ws } from '../../services/websocket';
import { Table } from 'lucide-react';

const LANG_BADGE_COLORS: Record<string, string> = {
  python: '#7aa2f7',
  r: '#2d7dca',
  julia: '#9558b2',
};

function typeColor(t: string) {
  // Python types
  if (t === 'int' || t === 'float' || t === 'complex') return 'text-blue-500';
  if (t === 'str') return 'text-green-600';
  if (t === 'bool') return 'text-purple-500';
  if (t === 'list' || t === 'dict' || t === 'set' || t === 'tuple') return 'text-orange-500';
  if (t === 'DataFrame' || t === 'ndarray' || t === 'Series') return 'text-pink-500';

  // R types
  if (t === 'numeric' || t === 'integer' || t === 'double' || t === 'complex') return 'text-blue-400';
  if (t === 'character') return 'text-green-400';
  if (t === 'logical') return 'text-gray-400';
  if (t === 'data.frame' || t === 'tibble' || t === 'data.table') return 'text-purple-400';
  if (t === 'matrix' || t === 'array') return 'text-cyan-400';
  if (t === 'list' || t === 'environment') return 'text-yellow-400';
  if (t === 'factor') return 'text-orange-400';

  // Julia types
  if (t === 'Int64' || t === 'Int32' || t === 'Float64' || t === 'Float32' || t === 'ComplexF64') return 'text-blue-400';
  if (t === 'String' || t === 'SubString') return 'text-green-400';
  if (t === 'Bool' || t === 'Nothing' || t === 'Missing') return 'text-gray-400';
  if (t === 'DataFrame') return 'text-purple-400';
  if (t.startsWith('Vector') || t.startsWith('Matrix') || t.startsWith('Array')) return 'text-cyan-400';
  if (t.startsWith('Dict') || t.startsWith('NamedTuple') || t.startsWith('Tuple')) return 'text-yellow-400';

  return 'text-text-muted';
}

// types that might have a table preview
const PREVIEWABLE = new Set([
  'DataFrame', 'Series',           // Python / Julia
  'data.frame', 'tibble', 'data.table', 'matrix',  // R
]);

export function VariableExplorer() {
  const vars = useVariableStore(s => s.vars);
  const selected = useVariableStore(s => s.selected);
  const select = useVariableStore(s => s.select);
  const preview = useVariableStore(s => s.preview);
  const previewLoading = useVariableStore(s => s.previewLoading);
  const activeKernelCount = useKernelStore(s =>
    new Set(s.availableSpecs.map(sp => sp.language.toLowerCase())).size
  );

  const list = Object.values(vars);

  if (!list.length) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">
        No variables yet. Run a cell to see them here.
      </p>
    );
  }

  function requestPreview(name: string) {
    useVariableStore.getState().setPreviewLoading(true);
    ws.send('variable_detail', { var_name: name });
  }

  return (
    <div className="space-y-0.5">
      {list.map(v => {
        const isSelected = v.name === selected;
        const canPreview = PREVIEWABLE.has(v.type);

        return (
          <div key={v.name}>
            <button
              onClick={() => select(isSelected ? null : v.name)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isSelected ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover'
              }`}
            >
              {/* name + type */}
              <div className="flex justify-between gap-2">
                <span className="font-mono font-medium break-all">
                  {v.name}
                  {v.language && activeKernelCount > 1 && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded ml-1 inline-block"
                      style={{
                        backgroundColor: `${LANG_BADGE_COLORS[v.language] ?? '#7aa2f7'}15`,
                        color: LANG_BADGE_COLORS[v.language] ?? '#7aa2f7',
                      }}
                    >
                      {v.language}
                    </span>
                  )}
                </span>
                <span className={`font-mono shrink-0 ${typeColor(v.type)}`}>{v.type}</span>
              </div>

              {/* extra info line: shape, dtype, size */}
              {(v.shape || v.dtype || v.size != null) && (
                <div className="text-text-muted mt-0.5 flex gap-2 flex-wrap">
                  {v.shape && <span>shape: {v.shape}</span>}
                  {v.dtype && <span>dtype: {v.dtype}</span>}
                  {v.size != null && <span>len: {v.size}</span>}
                </div>
              )}
            </button>

            {/* expanded details */}
            {isSelected && (
              <div className="px-2 pb-1">
                {v.module && v.module !== 'builtins' && (
                  <div className="text-[10px] text-text-muted mb-1">from {v.module}</div>
                )}

                <pre className="p-1.5 bg-bg rounded font-mono text-text-secondary break-all whitespace-pre-wrap text-[11px]">
                  {v.repr}
                </pre>

                {canPreview && (
                  <button
                    onClick={() => requestPreview(v.name)}
                    disabled={previewLoading}
                    className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-hover transition-colors"
                  >
                    <Table size={12} />
                    {previewLoading ? 'Loading...' : 'Preview table'}
                  </button>
                )}

                {canPreview && preview && (
                  <DFPreview data={preview} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DFPreview({ data }: { data: DataFramePreview }) {
  if (!data.columns || !data.head) return null;

  return (
    <div className="mt-2 overflow-x-auto border border-border rounded">
      <div className="text-[10px] text-text-muted px-2 py-1 border-b border-border">
        {data.shape[0]} rows x {data.shape[1]} cols
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="bg-bg-elevated">
            {data.columns.map(col => (
              <th key={col} className="px-2 py-1 text-left text-text-secondary font-medium border-b border-border">
                {col}
                {data.dtypes[col] && (
                  <span className="text-text-muted font-normal ml-1">({data.dtypes[col]})</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.head.slice(0, 20).map((row, i) => (
            <tr key={i} className="hover:bg-bg-hover/50">
              {data.columns.map(col => (
                <td key={col} className="px-2 py-0.5 text-text border-b border-border/30 max-w-[150px] truncate">
                  {String(row[col] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
