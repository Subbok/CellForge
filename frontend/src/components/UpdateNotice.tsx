import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ArrowUpRight, X, Anvil } from 'lucide-react';

const DISMISSED_KEY = 'cellforge_dismissed_update';

export function UpdateNotice() {
  const [info, setInfo] = useState<{
    latest: string;
    download_url: string;
  } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    api.checkForUpdate()
      .then(data => {
        if (!data.has_update) return;
        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (dismissed === data.latest) return;
        setInfo({ latest: data.latest, download_url: data.download_url });
        // stagger the entrance
        setTimeout(() => setVisible(true), 500);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  function dismiss() {
    if (info) localStorage.setItem(DISMISSED_KEY, info.latest);
    setVisible(false);
    setTimeout(() => setInfo(null), 300);
  }

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-xs transition-all duration-300 ease-out ${
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <div className="relative bg-bg-secondary/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl shadow-black/30 overflow-hidden">
        {/* Accent left edge */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent rounded-l-2xl" />

        <div className="pl-5 pr-4 py-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
              <Anvil size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text">
                CellForge v{info.latest}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                A new version is available.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <a
                  href={info.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-fg text-xs font-medium rounded-lg
                    hover:bg-accent-hover shadow-sm shadow-accent/20 hover:shadow-accent/30 active:scale-[0.97] transition-all"
                >
                  Download <ArrowUpRight size={12} />
                </a>
                <button
                  onClick={dismiss}
                  className="text-[11px] text-text-muted hover:text-text-secondary transition-colors px-2 py-1.5"
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button
              onClick={() => { setVisible(false); setTimeout(() => setInfo(null), 300); }}
              className="text-text-muted/40 hover:text-text-muted transition-colors shrink-0 p-0.5 rounded-md hover:bg-bg-hover"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
