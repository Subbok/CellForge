import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';

// ── types ──

type ModalKind = 'confirm' | 'alert' | 'prompt';
type ModalIcon = 'info' | 'success' | 'warning' | 'error';

interface ModalState {
  open: boolean;
  kind: ModalKind;
  title: string;
  message: string;
  icon?: ModalIcon;
  placeholder?: string;
  resolve?: (value: string | boolean | null) => void;
}

interface ModalAPI {
  /** Show alert (info message, user clicks OK). */
  alert: (title: string, message: string, icon?: ModalIcon) => Promise<void>;
  /** Show confirm (OK / Cancel, returns true/false). */
  confirm: (title: string, message: string) => Promise<boolean>;
  /** Show prompt (text input, returns string or null on cancel). */
  prompt: (title: string, message: string, placeholder?: string) => Promise<string | null>;
}

// ── context ──

const ModalContext = createContext<ModalAPI | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useModal(): ModalAPI {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used inside <ModalProvider>');
  return ctx;
}

// ── provider + renderer ──

export function ModalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ModalState>({ open: false, kind: 'alert', title: '', message: '' });
  const [inputVal, setInputVal] = useState('');

  const close = useCallback((result: string | boolean | null) => {
    state.resolve?.(result);
    setState(s => ({ ...s, open: false }));
  }, [state]);

  const api: ModalAPI = {
    alert: (title, message, icon) => new Promise(resolve => {
      setState({ open: true, kind: 'alert', title, message, icon, resolve: () => resolve() });
    }),
    confirm: (title, message) => new Promise(resolve => {
      setState({ open: true, kind: 'confirm', title, message, resolve: v => resolve(v as boolean) });
    }),
    prompt: (title, message, placeholder) => new Promise(resolve => {
      setInputVal('');
      setState({ open: true, kind: 'prompt', title, message, placeholder, resolve: v => resolve(v as string | null) });
    }),
  };

  const iconEl = state.icon === 'success' ? <CheckCircle size={20} className="text-success" />
    : state.icon === 'warning' ? <AlertTriangle size={20} className="text-warning" />
    : state.icon === 'error' ? <AlertTriangle size={20} className="text-error" />
    : <Info size={20} className="text-accent" />;

  return (
    <ModalContext.Provider value={api}>
      {children}
      {state.open && (
        <div className="modal-backdrop" onClick={() => close(state.kind === 'confirm' ? false : null)}>
          <div className="modal-panel w-[400px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 mt-0.5">{iconEl}</div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-text">{state.title}</h3>
                <p className="text-sm text-text-muted mt-1 whitespace-pre-wrap">{state.message}</p>
              </div>
              <button onClick={() => close(state.kind === 'confirm' ? false : null)}
                className="p-1 rounded hover:bg-bg-hover text-text-muted shrink-0">
                <X size={16} />
              </button>
            </div>

            {state.kind === 'prompt' && (
              <input
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && inputVal) close(inputVal); }}
                placeholder={state.placeholder}
                autoFocus
                className="field mb-4"
              />
            )}

            <div className="flex gap-2 justify-end">
              {state.kind === 'confirm' && (
                <button onClick={() => close(false)} className="btn btn-md btn-ghost">{t('common.cancel')}</button>
              )}
              {state.kind === 'prompt' && (
                <button onClick={() => close(null)} className="btn btn-md btn-ghost">{t('common.cancel')}</button>
              )}
              <button
                onClick={() => {
                  if (state.kind === 'prompt') close(inputVal || null);
                  else if (state.kind === 'confirm') close(true);
                  else close(null);
                }}
                className="btn btn-md btn-primary"
              >
                {t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}
