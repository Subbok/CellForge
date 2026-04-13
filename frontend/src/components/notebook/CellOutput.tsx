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
        return (
          <div className="text-sm px-2 py-1 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: String(data['text/html']) }} />
        );
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
