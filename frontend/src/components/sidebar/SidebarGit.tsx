import { useEffect, useState } from 'react';
import { GitBranch, RefreshCw, Circle } from 'lucide-react';

interface GitFile { status: string; path: string; }
interface GitCommit { hash: string; message: string; author: string; date: string; }
interface GitStatus { is_repo: boolean; branch: string; changed: GitFile[]; log: GitCommit[]; }

const STATUS_COLORS: Record<string, string> = {
  'M': 'text-warning',
  'A': 'text-success',
  'D': 'text-error',
  '??': 'text-text-muted',
  'R': 'text-accent',
};

export function SidebarGit() {
  const [data, setData] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch('/api/git/status')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-xs text-text-muted p-2">Loading...</div>;
  if (!data?.is_repo) {
    return <div className="text-xs text-text-muted p-2 text-center">Not a git repository.</div>;
  }

  return (
    <div className="text-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-text-secondary font-medium">
          <GitBranch size={13} />
          <span>{data.branch}</span>
        </div>
        <button onClick={load} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Refresh">
          <RefreshCw size={11} />
        </button>
      </div>

      {data.changed.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Changes ({data.changed.length})
          </div>
          <div className="space-y-0.5">
            {data.changed.map((f, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className={`font-mono text-[10px] w-5 shrink-0 ${STATUS_COLORS[f.status] ?? 'text-text-muted'}`}>
                  {f.status}
                </span>
                <span className="truncate text-text">{f.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.changed.length === 0 && (
        <div className="text-text-muted text-center py-2">
          <Circle size={12} className="inline text-success mr-1" />
          Working tree clean
        </div>
      )}

      {data.log.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Recent commits
          </div>
          <div className="space-y-1">
            {data.log.map((c, i) => (
              <div key={i} className="py-1 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-accent text-[10px]">{c.hash}</span>
                  <span className="text-text-muted text-[10px]">{c.date}</span>
                </div>
                <div className="text-text truncate">{c.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
