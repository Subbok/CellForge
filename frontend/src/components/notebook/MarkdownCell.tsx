import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { renderMathInMarkdown } from '../../lib/renderMath';
import { useNotebookStore } from '../../stores/notebookStore';
import { advanceToNextCell } from './CodeCell';
import type { Cell } from '../../lib/types';

export function MarkdownCellComponent({ cell, isActive }: { cell: Cell; isActive: boolean }) {
  const [editing, setEditing] = useState(false);
  const updateSource = useNotebookStore(s => s.updateSource);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const shouldEdit = editing || (isActive && !cell.source);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  useEffect(() => {
    if (shouldEdit && textareaRef.current) {
      textareaRef.current.focus();
      autoResize();
    }
  }, [shouldEdit]);

  // pre-render math to HTML before passing to react-markdown.
  // rehype-raw lets the katex HTML pass through without being escaped.
  const processed = useMemo(() => renderMathInMarkdown(cell.source), [cell.source]);

  if (shouldEdit) {
    return (
      <textarea
        ref={textareaRef}
        className="w-full min-h-[38px] p-3 text-sm bg-bg-elevated border border-border/50
          rounded-md resize-none outline-none focus:border-accent/40 font-mono text-text overflow-hidden"
        value={cell.source}
        onChange={e => { updateSource(cell.id, e.target.value); autoResize(); }}
        onBlur={() => {
          if (cell.source.trim()) setEditing(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation(); // don't let useNotebookKeys also handle this
            setEditing(false);
            advanceToNextCell(cell.id);
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
            (document.activeElement as HTMLElement)?.blur();
          }
        }}
        placeholder="Write markdown here... (Shift+Enter to render)"
      />
    );
  }

  return (
    <div
      className="px-3 py-0.5 cursor-pointer rounded-md hover:bg-bg-hover/50 transition-colors"
      onClick={() => setEditing(true)}
    >
      {cell.source ? (
        <div className="prose max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {processed}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-text-muted italic text-sm">Click to edit markdown</p>
      )}
    </div>
  );
}
