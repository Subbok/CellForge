import { useNotebookStore } from '../stores/notebookStore';

export function exportNotebookHtml() {
  const { filePath, cells } = useNotebookStore.getState();
  const title = filePath?.split('/').pop()?.replace('.ipynb', '') ?? 'Notebook';

  const notebookEl = document.querySelector('[data-notebook-root]');
  if (!notebookEl) {
    console.error('exportHtml: could not find [data-notebook-root] in the DOM');
    return;
  }

  // clone so we can clean it up without affecting the live page
  const clone = notebookEl.cloneNode(true) as HTMLElement;

  // remove interactive UI elements that don't belong in export
  clone.querySelectorAll('button, [class*="opacity-0"], [class*="group/add"], [class*="cursor-grab"]').forEach(el => el.remove());
  // remove search highlights from export
  clone.querySelectorAll('.search-match, mark').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''));
  });

  // Replace each cell's Monaco editor with a <pre> containing the authoritative
  // source from the Zustand store. Walking Monaco's virtualized DOM directly
  // truncates long cells (only rendered view-lines are in the tree), so we
  // look up the cell by its data-cell-id attribute and use cell.source.
  const cellSources = new Map(cells.map(c => [c.id, c.source]));
  clone.querySelectorAll<HTMLElement>('[data-cell-id]').forEach(cellWrap => {
    const cellId = cellWrap.getAttribute('data-cell-id');
    if (!cellId) return;
    const source = cellSources.get(cellId);
    if (source == null) return;

    // find the monaco editor inside this cell's subtree and swap it out
    const monaco = cellWrap.querySelector('.monaco-editor');
    if (!monaco) return;

    // the Monaco container wrapper we want to replace is the nearest ancestor
    // that actually holds the code block styling — in CellContainer that's the
    // div with bg-bg-elevated border border-border. Fall back to the monaco
    // element itself if that doesn't match.
    const codeContainer =
      monaco.closest<HTMLElement>('[class*="bg-bg-elevated"]') ?? (monaco as HTMLElement);

    const pre = document.createElement('pre');
    pre.className = 'code-input';
    const code = document.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    codeContainer.replaceWith(pre);
  });

  // remove interactive widgets (sliders, dropdowns, buttons, text inputs) —
  // they don't work without the backend, showing dead controls is misleading
  clone.querySelectorAll('[class*="accent-accent"], select, input[type="range"]').forEach(el => {
    const container = el.closest('[class*="bg-bg-elevated"]') ?? el.parentElement;
    if (container) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:#718096;font-style:italic;padding:4px 8px;';
      note.textContent = '(interactive widget — view in CellForge)';
      container.replaceWith(note);
    }
  });

  const bodyHtml = clone.innerHTML;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body {
    font-family: system-ui, -apple-system, sans-serif;
    max-width: 900px;
    margin: 40px auto;
    padding: 0 20px;
    color: #1a1a2e;
    line-height: 1.7;
    font-size: 15px;
  }
  h1 { font-size: 1.8em; margin-top: 1.2em; }
  h2 { font-size: 1.5em; margin-top: 1em; }
  h3 { font-size: 1.25em; margin-top: 0.8em; }
  p { margin: 0.6em 0; }
  a { color: #3b82f6; }
  strong { font-weight: 600; }
  .code-input {
    background: #f4f5f7;
    border-radius: 8px 8px 0 0;
    padding: 12px 16px;
    font-size: 13px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    margin-bottom: 0;
  }
  /* output block below code */
  .cell-output-block {
    background: #f8f9fc;
    border-left: 3px solid #b4c6ff;
    border-radius: 0 0 8px 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }
  .cell-output-block pre {
    margin: 0;
    background: none;
  }
  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    margin: 4px 0;
    font-size: 13px;
    line-height: 1.5;
  }
  code {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    background: #f4f5f7;
    padding: 0.15em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #ddd;
    margin: 0.8em 0;
    padding-left: 1em;
    color: #666;
    font-style: italic;
  }
  table { border-collapse: collapse; margin: 8px 0; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; font-size: 13px; }
  th { background: #f4f5f7; font-weight: 600; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.25em 0; }
  img { max-width: 100%; border-radius: 6px; }
  svg { max-width: 100%; height: auto; }
  .katex-display { margin: 1em 0; }
  /* CellForge CSS var overrides for light HTML export — charts use these */
  :root {
    --color-text: #1a1a2e;
    --color-text-secondary: #4a5568;
    --color-text-muted: #718096;
    --color-bg: #ffffff;
    --color-bg-elevated: #f4f5f7;
    --color-border: #e2e8f0;
    --color-accent: #3b82f6;
    --color-success: #16a34a;
    --color-warning: #d97706;
    --color-error: #dc2626;
    --font-sans: system-ui, -apple-system, sans-serif;
  }
  /* mermaid diagrams are rendered with dark theme inline — invert for light bg */
  [id^="cf-mermaid"] .node rect,
  [id^="cf-mermaid"] .node polygon,
  [id^="cf-mermaid"] .cluster rect { fill: #f0f4ff !important; stroke: #6c8cff !important; }
  [id^="cf-mermaid"] .nodeLabel,
  [id^="cf-mermaid"] text { fill: #1a1a2e !important; }
  [id^="cf-mermaid"] .edgePath path { stroke: #4a6cf7 !important; }
  [id^="cf-mermaid"] .arrowheadPath { fill: #4a6cf7 !important; }
  [id^="cf-mermaid"] line { stroke: #cbd5e0 !important; }
  /* progress bars in export */
  [style*="--color-accent"] { color: #3b82f6; }
  [style*="background:var(--color-accent)"] { background: #3b82f6 !important; }
  [style*="background:var(--color-bg-elevated)"] { background: #f4f5f7 !important; }
  [style*="border:1px solid var(--color-border)"] { border-color: #e2e8f0 !important; }
  /* cell styling */
  [class*="rounded-lg"] { margin: 16px 0; }
  /* error output */
  [class*="bg-error"], .error-output {
    background: #fff5f5;
    border-left: 3px solid #e53e3e;
    padding: 10px 16px;
    border-radius: 4px;
    margin: 4px 0;
  }
  [class*="bg-error"] [class*="text-error"], .error-output .error-header {
    color: #c53030;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }
  [class*="bg-error"] pre, .error-output pre {
    color: #666;
    font-size: 12px;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.html`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
