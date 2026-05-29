import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import { Loader2, Play, Save, Download } from 'lucide-react';
import { api } from '../../services/api';
import { registerTypst } from '../../lib/monaco-typst';
import { useUIStore } from '../../stores/uiStore';
import { TypstPreview } from './TypstPreview';

/**
 * Inline editor for a workspace `.typ` document. Rendered as a tab in the
 * editor shell (like DataViewer for CSVs) — NOT a modal. Compile is on-demand
 * and renders crisp SVG pages (no browser PDF chrome); Save writes in place.
 */
export function TypstEditorView({ path }: { path: string }) {
  const { t } = useTranslation();
  const isLight = useUIStore(s => s.currentThemeId) === 'crisp-light';
  const [source, setSource] = useState('');
  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.readFile(path)
      .then(setSource)
      .catch(() => setError(t('typst.loadFileError', { name: path })));
  }, [path, t]);

  const compile = useCallback(async () => {
    setBusy(true);
    setError('');
    const res = await api.compileTypstSvg(source);
    setBusy(false);
    if (res.ok && res.pages) setPages(res.pages);
    else { setPages(null); setError(res.error || t('typst.compileFailed')); }
  }, [source, t]);

  const save = useCallback(async () => {
    setStatus('');
    try {
      await api.writeFile(path, source);
      setStatus(t('typst.saved'));
    } catch {
      setStatus(t('typst.saveFailed'));
    }
  }, [path, source, t]);

  // PDF is compiled on demand (the preview uses SVG, not PDF).
  const downloadPdf = useCallback(async () => {
    setStatus('');
    const res = await api.compileTypst(source);
    if (!res.ok || !res.pdf) { setStatus(res.error || t('typst.compileFailed')); return; }
    const url = URL.createObjectURL(res.pdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = (path.split('/').pop()?.replace(/\.typ$/, '') ?? 'typst') + '.pdf';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [source, path, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const btn = (bg: string, fg: string): React.CSSProperties => ({
    padding: '6px 12px', background: bg, border: 'none', borderRadius: 6,
    color: fg, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <button onClick={compile} disabled={busy} style={btn('var(--color-accent)', 'var(--color-accent-fg)')}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {busy ? t('typst.compiling') : t('typst.compile')}
        </button>
        <button onClick={save} style={btn('transparent', 'var(--color-text-secondary)')}>
          <Save size={14} /> {t('typst.save')}
        </button>
        <button onClick={downloadPdf} style={btn('transparent', 'var(--color-text-secondary)')}>
          <Download size={14} /> {t('typst.downloadPdf')}
        </button>
        {status && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{status}</span>}
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
    </div>
  );
}
