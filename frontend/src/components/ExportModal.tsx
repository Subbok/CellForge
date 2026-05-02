import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { exportNotebookHtml } from '../services/exportHtml';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { executeCommand } from '../plugins/registry';
import { FileDown, Loader2 } from 'lucide-react';
import { FFModalShell } from './modals/FFModalShell';

type Format = string; // 'pdf' | 'html' | plugin-contributed formats

interface TemplateInfo {
  name: string;
  variables: { key: string; default_value: string }[];
}

interface Props {
  onClose: () => void;
}

export function ExportModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<Format>('pdf');
  const [templates, setTemplates] = useState<(TemplateInfo & { assets?: string[] })[]>([]);
  const [selected, setSelected] = useState('default');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const pluginFormats = useUIStore(s => s.pluginExportFormats);

  useEffect(() => {
    api.listTemplates().then(t => {
      setTemplates(t);
      if (t.length > 0) {
        const def = t.find(x => x.name === 'default') ?? t[0];
        setSelected(def.name);
      }
    }).catch(() => {});
  }, []);

  // when template selection changes, populate variables with defaults
  useEffect(() => {
    const tmpl = templates.find(t => t.name === selected);
    if (!tmpl) return;

    // get notebook title from first markdown heading
    const { cells } = useNotebookStore.getState();
    let nbTitle = '';
    for (const c of cells) {
      if (c.cell_type === 'markdown') {
        const match = c.source.match(/^#\s+(.+)$/m);
        if (match) { nbTitle = match[1]; break; }
      }
    }

    setVars(prev => {
      const newVars: Record<string, string> = {};
      for (const v of tmpl.variables) {
        let val = prev[v.key] ?? v.default_value;
        // auto-fill placeholders
        if (val === '{{title}}' && nbTitle) val = nbTitle;
        if (val === '{{today}}') {
          const d = new Date();
          val = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
        }
        newVars[v.key] = val;
      }
      return newVars;
    });
  }, [selected, templates]);

  async function doExport() {
    if (format === 'html') {
      exportNotebookHtml();
      onClose();
      return;
    }

    // plugin-contributed format — delegate to the plugin's command
    const pluginFmt = pluginFormats.find(f => f.id === format);
    if (pluginFmt) {
      const { metadata, cells, filePath } = useNotebookStore.getState();
      const nb = { metadata, nbformat: 4, nbformat_minor: 5,
        cells: cells.map(c => ({
          cell_type: c.cell_type, id: c.id, source: c.source, metadata: c.metadata,
          ...(c.cell_type === 'code' ? { outputs: c.outputs, execution_count: c.execution_count } : {}),
        })),
      };
      executeCommand(pluginFmt.command, { notebook: nb, filePath });
      onClose();
      return;
    }

    setExporting(true);
    setError('');

    try {
      const { metadata, cells, filePath } = useNotebookStore.getState();
      const nb = {
        metadata,
        nbformat: 4,
        nbformat_minor: 5,
        cells: cells.map(c => ({
          cell_type: c.cell_type,
          id: c.id,
          source: c.source,
          metadata: c.metadata,
          ...(c.cell_type === 'code' ? { outputs: c.outputs, execution_count: c.execution_count } : {}),
        })),
      };

      // auto-generate course-short from course-full (first letters)
      if (vars['course-full'] && !vars['course-short']) {
        vars['course-short'] = vars['course-full']
          .split(/\s+/)
          .map(w => w[0]?.toUpperCase() ?? '')
          .join('');
      }

      const blob = await api.exportPdf(nb, selected, vars);
      const name = filePath?.split('/').pop()?.replace('.ipynb', '') ?? 'notebook';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.pdf`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const tmplVars = templates.find(t => t.name === selected)?.variables ?? [];

  // nicer labels for variable keys
  const labels: Record<string, string> = {
    'course-short': 'Course (short)',
    'course-full': 'Course (full)',
    'lab-title': 'Lab title',
    'lab-number': 'Lab number',
    'doc-type': 'Document type',
    'author': 'Author',
    'student-id': 'Student ID',
  };

  return (
    <FFModalShell
      title={t('export.exportNotebook')}
      subtitle={`${format.toUpperCase()} export · ${selected || 'no template'}`}
      width={520}
      hideFooter
      onClose={onClose}
    >
      {/* Format tabs */}
      <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 14 }}>
        {[
          { id: 'pdf', label: t('export.pdfTypst') },
          { id: 'html', label: t('export.html') },
          ...pluginFormats.map(f => ({ id: f.id, label: f.label })),
        ].map(f => (
          <button key={f.id} onClick={() => setFormat(f.id)}
            style={{
              flex: 1, minWidth: 80, padding: '8px 12px',
              borderRadius: 6, fontSize: 12, fontWeight: 500,
              background: format === f.id
                ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                : 'var(--color-bg-elevated)',
              color: format === f.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              border: format === f.id
                ? '1px solid var(--color-accent)'
                : '1px solid var(--color-border)',
              cursor: 'pointer',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {format === 'pdf' && (
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {templates.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="uppercase" style={{
                fontSize: 11, color: 'var(--color-text-secondary)',
                marginBottom: 6, letterSpacing: '0.04em', fontWeight: 500,
              }}>{t('export.template')}</div>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {templates.map(tpl => (
                  <button key={tpl.name} onClick={() => setSelected(tpl.name)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '8px 12px', borderRadius: 6, fontSize: 13,
                      background: selected === tpl.name
                        ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                        : 'transparent',
                      color: selected === tpl.name ? 'var(--color-accent)' : 'var(--color-text)',
                      border: selected === tpl.name
                        ? '1px solid var(--color-accent)'
                        : '1px solid transparent',
                      cursor: 'pointer',
                    }}>
                    {tpl.name}
                    {tpl.variables.length > 0 && (
                      <span className="text-text-muted ml-2" style={{ fontSize: 11 }}>
                        ({tpl.variables.length} vars)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tmplVars.length > 0 && (
            <div>
              <div className="uppercase" style={{
                fontSize: 11, color: 'var(--color-text-secondary)',
                marginBottom: 6, letterSpacing: '0.04em', fontWeight: 500,
              }}>{t('export.variables')}</div>
              <div className="flex flex-col" style={{ gap: 8 }}>
                {tmplVars.map(v => {
                  const isImageVar = /logo|image|icon|img/i.test(v.key)
                    || /\.(png|jpg|jpeg|svg|webp)$/i.test(v.default_value);
                  const currentTmpl = templates.find(t => t.name === selected);
                  const imageAssets = (currentTmpl?.assets ?? []).filter(
                    a => /\.(png|jpg|jpeg|svg|webp)$/i.test(a),
                  );
                  return (
                    <div key={v.key} className="flex items-center" style={{ gap: 8 }}>
                      <span className="shrink-0 text-right" style={{
                        fontSize: 11, color: 'var(--color-text-muted)', width: 112,
                      }}>{labels[v.key] ?? v.key}</span>
                      {isImageVar && imageAssets.length > 0 ? (
                        <select
                          value={vars[v.key] ?? v.default_value}
                          onChange={e => setVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                          className="field flex-1"
                        >
                          <option value="">{t('export.noImage')}</option>
                          {imageAssets.map(a => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={vars[v.key] ?? v.default_value}
                          onChange={e => setVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                          className="field flex-1"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-[12px] rounded-lg" style={{
          marginTop: 12, padding: '8px 12px',
          background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.20)',
          color: 'var(--color-error)',
        }}>{error}</div>
      )}

      {/* Custom footer — primary keeps the spinner state during export. */}
      <div className="flex justify-end" style={{
        marginTop: 16, paddingTop: 14, gap: 8,
        borderTop: '1px solid var(--color-border-subtle)',
      }}>
        <button onClick={onClose}
          style={{
            padding: '8px 14px', background: 'transparent',
            border: '1px solid var(--color-border)', borderRadius: 6,
            color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer',
          }}>
          {t('common.cancel')}
        </button>
        <button onClick={doExport} disabled={exporting}
          className="inline-flex items-center"
          style={{
            padding: '8px 14px',
            background: 'var(--color-accent)',
            border: 'none', borderRadius: 6,
            color: 'var(--color-accent-fg)',
            fontSize: 13, fontWeight: 600,
            cursor: exporting ? 'not-allowed' : 'pointer',
            opacity: exporting ? 0.6 : 1,
            gap: 6,
          }}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          {exporting ? t('export.exporting') : t('export.exportFormat', { format: format.toUpperCase() })}
        </button>
      </div>
    </FFModalShell>
  );
}
