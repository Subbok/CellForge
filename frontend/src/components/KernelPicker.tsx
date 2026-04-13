import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useKernelStore } from '../stores/kernelStore';
import { Cpu, Download, Package, RefreshCw, Zap, Terminal } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';
import { useModal } from './ModalDialog';

interface SpecEntry {
  name: string;
  display_name: string;
  language: string;
  env_name?: string;
  env_path?: string;
  spec_name: string;
}

interface Props {
  onSelect: (kernelName: string) => void;
  onSkip?: () => void;
  onCancel?: () => void;
}

const LANG_COLORS: Record<string, string> = {
  python: '#7aa2f7',
  r: '#2d7dca',
  julia: '#9558b2',
};

function langColor(lang: string): string {
  return LANG_COLORS[lang.toLowerCase()] ?? '#7aa2f7';
}

export function KernelPicker({ onSelect, onSkip, onCancel }: Props) {
  const modal = useModal();
  const [specs, setSpecs] = useState<SpecEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const currentLang = useKernelStore(s => {
    const spec = s.availableSpecs.find(sp => sp.name === s.spec);
    return spec?.language ?? 'python';
  });

  function load() {
    setLoading(true);
    api.listKernelSpecs()
      .then(s => {
        setSpecs(s);
        useKernelStore.getState().setAvailableSpecs(
          s.filter(k => k.spec_name).map(k => ({
            name: k.name, display_name: k.display_name, language: k.language,
          }))
        );
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      api.listKernelSpecs()
        .then(s => {
          setSpecs(prev => {
            const prevKeys = prev.map(p => p.name).sort().join(',');
            const newKeys = s.map(p => p.name).sort().join(',');
            if (prevKeys === newKeys) return prev;
            useKernelStore.getState().setAvailableSpecs(
              s.filter(k => k.spec_name).map(k => ({
                name: k.name, display_name: k.display_name, language: k.language,
              }))
            );
            return s;
          });
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  function pick(entry: SpecEntry) {
    if (!entry.spec_name) return;
    useKernelStore.getState().setSpec(entry.name);
    onSelect(entry.name);
  }

  const ready = specs.filter(s => s.spec_name);
  const needs = specs.filter(s => !s.spec_name);
  const recommended = ready.filter(s => s.language.toLowerCase() === currentLang.toLowerCase());
  const other = ready.filter(s => s.language.toLowerCase() !== currentLang.toLowerCase());

  return (
    <div className="modal-backdrop">
      <div className="bg-bg-secondary/95 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl shadow-black/40 w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 shrink-0 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Zap size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">Select a kernel</h2>
              <p className="text-xs text-text-muted">Choose which environment to run your code in</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-3 py-3 overflow-y-auto flex-1">
          {loading && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                <Cpu size={24} className="text-accent animate-pulse" />
              </div>
              <p className="text-sm text-text-muted">Scanning for kernels...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-error text-sm mb-2">Can't reach backend</p>
              <p className="text-text-muted text-xs">
                Start it with <code className="bg-bg-elevated px-1.5 py-0.5 rounded text-text-secondary">./scripts/dev.sh</code>
              </p>
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-1">
              {recommended.map(s => (
                <KernelButton key={s.name} s={s} onClick={() => pick(s)} />
              ))}

              {other.length > 0 && recommended.length > 0 && (
                <div className="text-[11px] text-text-muted uppercase tracking-wider px-4 pt-5 pb-1 font-semibold">
                  Other kernels
                </div>
              )}

              {other.map(s => (
                <KernelButton key={s.name} s={s} onClick={() => pick(s)} />
              ))}

              {needs.length > 0 && (
                <>
                  <div className="text-[11px] text-text-muted uppercase tracking-wider px-4 pt-5 pb-1 font-semibold">
                    Needs kernel installation
                  </div>
                  {needs.map(s => {
                    const lang = s.language ?? 'python';
                    const color = langColor(lang);
                    return (
                      <div key={s.name} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-bg-hover/30 transition-colors">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-warning/10">
                          <Download size={20} className="text-warning" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text">{s.env_name}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{ backgroundColor: `${color}15`, color }}>
                              {s.language}
                            </span>
                          </div>
                          <div className="text-[11px] text-text-muted truncate mt-0.5">{s.env_path}</div>
                        </div>
                        <button
                          disabled={installing === s.env_name}
                          onClick={() => {
                            if (!s.env_name) return;
                            setInstalling(s.env_name);
                            let cmd: string;
                            if (lang === 'r') {
                              cmd = `R -e "install.packages('IRkernel'); IRkernel::installspec()"`;
                            } else if (lang === 'julia') {
                              cmd = `julia -e "using Pkg; Pkg.add(\\"IJulia\\")"`;
                            } else {
                              const isConda = s.name.startsWith('__install__') &&
                                s.env_path && (
                                  s.env_path.includes('conda') ||
                                  s.env_path.includes('miniforge') ||
                                  s.env_path.includes('mambaforge')
                                );
                              cmd = isConda
                                ? `conda install -n ${s.env_name} ipykernel -y`
                                : 'pip install ipykernel';
                            }
                            copyToClipboard(cmd).then(async () => {
                              await modal.alert('Copied', `Copied to clipboard:\n\n${cmd}\n\nRun it in your terminal, then refresh.`, 'info');
                              setInstalling(null);
                            });
                          }}
                          className="btn btn-sm shrink-0 bg-warning/10 text-warning hover:bg-warning/20 rounded-lg font-medium"
                        >
                          <Terminal size={12} />
                          {installing === s.env_name ? 'Copied!' : 'Install'}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              {ready.length === 0 && needs.length === 0 && (
                <div className="text-center py-12 space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-accent/8 flex items-center justify-center mx-auto">
                    <Cpu size={28} className="text-accent/30" />
                  </div>
                  <p className="text-sm font-medium text-text-secondary">No kernels found</p>
                  <div className="text-xs text-text-muted max-w-xs mx-auto space-y-2">
                    <p>To run code you need Python with ipykernel:</p>
                    <code className="block bg-bg-elevated px-3 py-2 rounded-lg text-text-secondary text-[11px] font-mono">
                      pip install ipykernel
                    </code>
                    <p>The list auto-refreshes every 5 seconds.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-3 border-t border-border/30 flex gap-2 shrink-0">
          <button
            onClick={() => load()}
            disabled={loading}
            className="btn btn-sm btn-secondary gap-1.5 rounded-xl"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <div className="flex-1" />
          {onSkip && (
            <button onClick={onSkip} className="btn btn-sm btn-ghost rounded-xl">
              Open without kernel
            </button>
          )}
          {onCancel && (
            <button onClick={onCancel} className="btn btn-sm btn-ghost rounded-xl">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KernelButton({ s, onClick }: { s: SpecEntry; onClick: () => void }) {
  const lang = (s.language ?? 'python').toLowerCase();
  const color = langColor(lang);
  const isConda = s.env_name && (s.env_path?.includes('conda') || s.env_path?.includes('miniforge') || s.env_path?.includes('mambaforge'));

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left
        hover:bg-bg-hover/50 border border-transparent hover:border-border/40 transition-all group"
    >
      {/* Colored language icon */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"
        style={{ backgroundColor: `${color}12` }}>
        <Cpu size={20} style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text">{s.display_name}</div>
        <div className="flex items-center gap-2 mt-1">
          {/* Language badge */}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ backgroundColor: `${color}15`, color }}>
            {s.language}
          </span>
          {/* Conda badge */}
          {isConda && (
            <span className="inline-flex items-center gap-1 bg-success/10 text-success px-1.5 py-0.5 rounded text-[10px] font-medium">
              <Package size={9} />
              conda
            </span>
          )}
          {/* Path */}
          <span className="text-[11px] text-text-muted truncate">{s.env_path ?? ''}</span>
        </div>
      </div>
    </button>
  );
}
