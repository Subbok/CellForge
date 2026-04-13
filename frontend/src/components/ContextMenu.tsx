import { useState, useEffect, useCallback } from 'react';
import { Copy, Download, FileText } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

let globalShow: ((state: ContextMenuState) => void) | null = null;

/** Show a context menu at (x, y) with the given items. */
// eslint-disable-next-line react-refresh/only-export-components
export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  globalShow?.({ x, y, items });
}

/** Mount this once at app root to render context menus. */
export function ContextMenuHost() {
  const [state, setState] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    globalShow = (s) => setState(s);
    return () => { globalShow = null; };
  }, []);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!state) return;
    const onClick = () => close();
    window.addEventListener('click', onClick);
    window.addEventListener('contextmenu', onClick);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('contextmenu', onClick);
    };
  }, [state, close]);

  if (!state) return null;

  return (
    <div
      className="fixed z-[100] bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 min-w-[160px]"
      style={{ left: state.x, top: state.y }}
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.action(); close(); }}
          className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-bg-hover flex items-center gap-2 transition-colors"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Build context menu items for a cell output container. */
// eslint-disable-next-line react-refresh/only-export-components
export function outputContextMenu(e: React.MouseEvent, outputEl: HTMLElement) {
  e.preventDefault();

  const items: MenuItem[] = [];

  // copy text content
  const text = outputEl.innerText?.trim();
  if (text) {
    items.push({
      label: 'Copy as text',
      icon: <Copy size={14} />,
      action: () => copyToClipboard(text),
    });
  }

  // save image if there's one
  const img = outputEl.querySelector('img') as HTMLImageElement | null;
  const svg = outputEl.querySelector('svg') as SVGElement | null;
  if (img?.src) {
    items.push({
      label: 'Save image',
      icon: <Download size={14} />,
      action: () => {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'output.png';
        a.click();
      },
    });
  } else if (svg) {
    items.push({
      label: 'Save as SVG',
      icon: <Download size={14} />,
      action: () => {
        const svgData = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'output.svg';
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }

  // copy as HTML
  const html = outputEl.innerHTML?.trim();
  if (html) {
    items.push({
      label: 'Copy as HTML',
      icon: <FileText size={14} />,
      action: () => copyToClipboard(html),
    });
  }

  if (items.length > 0) {
    showContextMenu(e.clientX, e.clientY, items);
  }
}
