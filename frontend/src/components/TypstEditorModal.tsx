import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import { Loader2, Play, Save, X } from 'lucide-react';
import { api } from '../services/api';
import { registerTypst } from '../lib/monaco-typst';
import { useUIStore } from '../stores/uiStore';
import { TypstPreview } from './typst/TypstPreview';

// Built-in templates are rewritten on every server startup, so they cannot be
// edited in place — the editor forces a "save as" under a new name.
const BUILTIN_TEMPLATES = ['blank', 'lab-report'];

interface Props {
  /** Template name to edit, or undefined to create a new template. */
  templateName?: string;
  onClose: () => void;
}

/** Modal editor for export templates (a settings concern). Workspace `.typ`
 *  documents use the inline `TypstEditorView` tab instead. */
export function TypstEditorModal({ templateName, onClose }: Props) {
  const { t } = useTranslation();
  const isLight = useUIStore(s => s.currentThemeId) === 'crisp-light';
  const [source, setSource] = useState('');
  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState(templateName ?? '');
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (templateName) {
      api.getTemplateSource(templateName)
        .then(setSource)
        .catch(() => setError(t('typst.loadError', { name: templateName })));
    }
  }, [templateName, t]);

  const compile = useCallback(async () => {
    setBusy(true);
    setError('');
    const res = await api.compileTypstSvg(source, templateName);
    setBusy(false);
    if (res.ok && res.pages) setPages(res.pages);
    else { setPages(null); setError(res.error || t('typst.compileFailed')); }
  }, [source, templateName, t]);

  const isBuiltin = !!templateName && BUILTIN_TEMPLATES.includes(templateName);
  const saveDisabled = !saveName.trim() || (isBuiltin && saveName.trim() === templateName);
  const saveTemplate = useCallback(async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaveMsg('');
    try {
      await api.saveTemplate(name, source);
      setSaveMsg(t('typst.savedAs', { name }));
    } catch {
      setSaveMsg(t('typst.saveFailed'));
    }
  }, [saveName, source, t]);

  const title = templateName ? t('typst.editTitle', { name: templateName }) : t('typst.newTemplateTitle');

  const btn = (bg: string, fg: string): React.CSSProperties => ({
    padding: '8px 14px', background: bg, border: 'none', borderRadius: 6,
    color: fg, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  return (
    <div className="modal-backdrop">
      <div style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)', borderRadius: 12,
        width: 'min(1100px, calc(100vw - 2rem))', height: 'min(800px, calc(100vh - 2rem))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--color-border-subtle)' }}>
            <Editor
              language="typst"
              value={source}
              onChange={v => setSource(v ?? '')}
              onMount={(_ed, monaco) => registerTypst(monaco)}
              theme={isLight ? 'vs' : 'vs-dark'}
              options={{
                minimap: { enabled: false }, fontSize: 13, wordWrap: 'on',
                scrollBeyondLastLine: false, automaticLayout: true,
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TypstPreview pages={pages} error={error} />
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '12px 16px', borderTop: '1px solid var(--color-border-subtle)',
        }}>
          <button onClick={compile} disabled={busy} style={btn('var(--color-accent)', 'var(--color-accent-fg)')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {busy ? t('typst.compiling') : t('typst.compile')}
          </button>
          <input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder={t('typst.templateNamePlaceholder')}
            style={{
              padding: '7px 10px', borderRadius: 6, fontSize: 13,
              background: 'var(--color-bg)', color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
          <button onClick={saveTemplate} disabled={saveDisabled} style={{ ...btn('var(--color-accent)', 'var(--color-accent-fg)'), opacity: saveDisabled ? 0.5 : 1 }}>
            <Save size={14} /> {t('typst.save')}
          </button>
          {isBuiltin && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('typst.builtinHint')}
            </span>
          )}
          {saveMsg && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{saveMsg}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn('transparent', 'var(--color-text-secondary)')}>{t('typst.close')}</button>
        </div>
      </div>
    </div>
  );
}
