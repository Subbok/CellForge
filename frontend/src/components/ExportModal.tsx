import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { exportNotebookHtml } from '../services/exportHtml';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { executeCommand } from '../plugins/registry';
import { FileDown, Loader2 } from 'lucide-react';

type Format = string; // 'pdf' | 'html' | plugin-contributed formats

interface TemplateInfo {
  name: string;
  variables: { key: string; default_value: string }[];
}

interface Props {
  onClose: () => void;
}

export function ExportModal({ onClose }: Props) {
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel w-[480px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h3 className="text-base font-semibold text-text">Export notebook</h3>
        </div>

        {/* format tabs — built-in + plugin-contributed */}
        <div className="px-6 pb-3 flex gap-2 flex-wrap">
          {[
            { id: 'pdf', label: 'PDF (Typst)' },
            { id: 'html', label: 'HTML' },
            ...pluginFormats.map(f => ({ id: f.id, label: f.label })),
          ].map(f => (
            <button key={f.id} onClick={() => setFormat(f.id)}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                format === f.id ? 'bg-accent/15 text-accent border-accent/30' : 'border-border text-text-secondary hover:bg-bg-hover'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* PDF: template + variables */}
        {format === 'pdf' && (
          <div className="px-6 pb-3 overflow-y-auto flex-1 space-y-4">
            {templates.length > 0 && (
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Template</label>
                <div className="space-y-1">
                  {templates.map(t => (
                    <button key={t.name} onClick={() => setSelected(t.name)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selected === t.name
                          ? 'bg-accent/15 text-accent border border-accent/30'
                          : 'hover:bg-bg-hover border border-transparent'
                      }`}>
                      {t.name}
                      {t.variables.length > 0 && (
                        <span className="text-text-muted text-xs ml-2">({t.variables.length} vars)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tmplVars.length > 0 && (
              <div>
                <label className="text-xs text-text-muted block mb-1.5">Variables</label>
                <div className="space-y-2">
                  {tmplVars.map(v => {
                    const isImageVar = /logo|image|icon|img/i.test(v.key)
                      || /\.(png|jpg|jpeg|svg|webp)$/i.test(v.default_value);
                    const currentTmpl = templates.find(t => t.name === selected);
                    const imageAssets = (currentTmpl?.assets ?? []).filter(
                      a => /\.(png|jpg|jpeg|svg|webp)$/i.test(a),
                    );

                    return (
                      <div key={v.key} className="flex items-center gap-2">
                        <span className="text-xs text-text-muted w-28 shrink-0 text-right">
                          {labels[v.key] ?? v.key}
                        </span>
                        {isImageVar && imageAssets.length > 0 ? (
                          <select
                            value={vars[v.key] ?? v.default_value}
                            onChange={e => setVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                            className="field flex-1"
                          >
                            <option value="">(no image)</option>
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
          <div className="mx-6 mb-3 px-3 py-2 bg-error/10 text-error text-xs rounded">{error}</div>
        )}

        <div className="px-6 pb-5 pt-2 border-t border-border flex gap-2 shrink-0">
          <button onClick={doExport} disabled={exporting} className="btn btn-lg btn-primary flex-1">
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {exporting ? 'Exporting...' : `Export ${format.toUpperCase()}`}
          </button>
          <button onClick={onClose} className="btn btn-lg btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
