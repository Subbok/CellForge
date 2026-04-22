import { AnsiText } from '../../lib/ansi';
import { HighlightText } from '../../lib/highlight';
import type { CellOutput as CellOutputType } from '../../lib/types';
import { useState, useRef, useEffect } from 'react';
import { ws } from '../../services/websocket';
import { findPluginMime, getMimeRenderer } from '../../plugins/registry';

interface WidgetData {
  id: string;
  value: string | number | boolean;
  kind: string;
  args: {
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    [key: string]: string | number | boolean | string[] | undefined;
  };
}

function WidgetRenderer({ widget, cellId }: { widget: WidgetData; cellId: string }) {
  const [val, setVal] = useState<string | number>(
    typeof widget.value === 'boolean' ? Number(widget.value) : widget.value
  );

  function onChange(newVal: string | number) {
    setVal(newVal);
    ws.send('widget_update', { id: widget.id, value: newVal, cell_id: cellId });
  }

  const { kind, args } = widget;
  if (kind === 'slider') {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 bg-bg-elevated/50 rounded-lg border border-border/50">
        <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">{args.label}</span>
        <input
          type="range"
          min={args.min}
          max={args.max}
          step={args.step}
          value={val}
          onChange={(e) => onChange(Number(e.target.value))}
          className="accent-accent"
        />
        <span className="text-xs font-mono text-text-secondary min-w-[2rem]">{val}</span>
      </div>
    );
  }
  if (kind === 'button') {
    return (
      <button
        onClick={() => onChange(1)}
        className="btn btn-md btn-primary active:scale-95"
      >
        {args.label}
      </button>
    );
  }
  if (kind === 'text') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted shrink-0">{args.label}:</span>
        <input
          type="text"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          className="field field-sm flex-1"
        />
      </div>
    );
  }
  if (kind === 'dropdown') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted shrink-0">{args.label}:</span>
        <select
          value={val}
          onChange={(e) => onChange(e.target.value)}
          className="field field-sm"
        >
          {(args.options as string[]).map((o: string) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  return <div className="text-xs text-text-muted italic">Unknown widget: {kind}</div>;
}

/**
 * Render user-provided `text/html` cell output inside a sandboxed iframe
 * with a null origin. Scripts still run (ipywidgets, plotly event hooks),
 * but they execute in an isolated origin — same-origin `fetch('/api/*')`
 * is blocked, so a malicious notebook author can't escalate to session
 * takeover against the viewer even if their HTML injects `<script>`.
 * Matches the JupyterLab threat model.
 * Height is synced to content via a small postMessage handshake injected
 * into the iframe's srcdoc. Parent is capped at 800px to keep layout sane;
 * content taller than that scrolls inside the iframe.
 */
function HtmlCellOutput({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(48);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const msg = e.data as { type?: string; height?: number } | null;
      if (msg && msg.type === 'cellforge-iframe-height') {
        const h = Number(msg.height);
        if (Number.isFinite(h) && h > 0) {
          setHeight(Math.min(h + 8, 800));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Inline theming so iframe content blends with the notebook colors.
  // The script block posts scrollHeight to the parent so the iframe can
  // resize to fit. `sandbox="allow-scripts"` without `allow-same-origin`
  // gives the iframe a null origin — user scripts cannot reach
  // CellForge's origin via fetch/XHR/Cookie/localStorage.
  const srcDoc = `<!DOCTYPE html><html><head><style>
    body { margin: 0; padding: 8px; font-family: ui-sans-serif, system-ui, sans-serif;
           color: #ebedf2; background: transparent; font-size: 14px; line-height: 1.5; }
    a { color: #7a99ff; }
    table { border-collapse: collapse; }
    th, td { padding: 4px 8px; border: 1px solid #3f4154; text-align: left; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    img { max-width: 100%; }
  </style></head><body>${html}
<script>
  function report() {
    parent.postMessage({ type: 'cellforge-iframe-height', height: document.body.scrollHeight }, '*');
  }
  window.addEventListener('load', report);
  try { new ResizeObserver(report).observe(document.body); } catch (e) {}
</script>
  </body></html>`;

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="w-full border-0 block"
      style={{ height: `${height}px`, maxHeight: '800px' }}
      title="cell-html-output"
    />
  );
}

/**
 * Delegate rendering to a plugin-registered MIME handler.
 * Mounts a container div, calls the async handler, and shows a placeholder
 * while it's loading (useful when the handler lazy-imports a CDN library).
 */
function PluginMimeOutput({ mimeType, payload }: { mimeType: string; payload: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = getMimeRenderer(mimeType);
    if (!handler) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(`No handler for ${mimeType}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await handler(el, payload);
      } catch (e: unknown) {
        if (!cancelled) setError(`Render failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [mimeType, payload]);

  if (error) {
    return <div className="text-xs text-error px-2 py-1">{error}</div>;
  }
  return <div ref={containerRef} className="px-2 py-1 overflow-x-auto" />;
}

export function CellOutput({ output, cellId, searchQuery }: { output: CellOutputType; cellId: string; searchQuery?: string }) {
  const q = searchQuery ?? '';

  function renderText(text: unknown) {
    // jupyter sends text as string or string[] — normalize without adding commas
    const s = Array.isArray(text) ? text.join('') : String(text ?? '');
    if (q) return <HighlightText text={s} query={q} />;
    return <AnsiText>{s}</AnsiText>;
  }

  switch (output.output_type) {
    case 'stream':
      return (
        <pre className={`text-xs font-mono whitespace-pre-wrap px-2 py-1 ${
          output.name === 'stderr' ? 'text-error/80 bg-error/5' : 'text-text'
        }`}>
          {renderText(output.text)}
        </pre>
      );

    case 'execute_result':
    case 'display_data':
    case 'update_display_data': {
      const data = (output.data ?? {}) as Record<string, unknown>;

      // check plugin-contributed MIME handlers FIRST (before built-ins)
      const pluginMatch = findPluginMime(data);
      if (pluginMatch) {
        return <PluginMimeOutput mimeType={pluginMatch[0]} payload={pluginMatch[1]} />;
      }

      const widget = data['application/vnd.cellforge.widget+json'] as WidgetData | undefined;
      if (widget) {
        return <WidgetRenderer widget={widget} cellId={cellId} />;
      }
      if (data['text/html']) {
        return <HtmlCellOutput html={String(data['text/html'])} />;
      }
      if (data['image/png']) {
        return (
          <div className="px-2 py-1">
            <img src={`data:image/png;base64,${data['image/png']}`}
              alt="output" className="max-w-full rounded" />
          </div>
        );
      }
      if (data['text/plain']) {
        return (
          <pre className="text-xs font-mono whitespace-pre-wrap px-2 py-1 text-text">
            {renderText(data['text/plain'])}
          </pre>
        );
      }
      return null;
    }

    case 'error':
      return (
        <div className="text-xs font-mono px-3 py-2 rounded bg-error/5 overflow-x-auto">
          <div className="text-error font-semibold mb-1">
            {output.ename}: {output.evalue}
          </div>
          {output.traceback && output.traceback.length > 0 && (
            <pre className="whitespace-pre-wrap text-text-secondary leading-relaxed">
              <AnsiText>{output.traceback.join('\n')}</AnsiText>
            </pre>
          )}
        </div>
      );

    default:
      return null;
  }
}
