import Editor from '@monaco-editor/react';
import { useNotebookStore } from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';
import { useKernelStore } from '../../stores/kernelStore';
import { useExecuteCell } from '../../hooks/useKernel';
import { registerKernelCompletion } from '../../services/monacoCompletion';
import { registerR } from '../../lib/monaco-r';
import { registerJulia } from '../../lib/monaco-julia';
import { monacoLanguage } from '../../lib/languages';
import { formatPythonCode } from '../../services/formatCode';
import * as bp from '../../services/breakpoints';
import { bindEditor, isActive as isCollabActive } from '../../services/collaboration';
import { addCellSynced } from '../../services/notebookOps';
import type { Cell } from '../../lib/types';
import { useCallback, useRef, useEffect } from 'react';
import type { editor, IKeyboardEvent } from 'monaco-editor';

export function CodeCell({ cell, index }: { cell: Cell; index: number }) {
  const updateSource = useNotebookStore(s => s.updateSource);
  const execute = useExecuteCell();
  const searchQuery = useUIStore(s => s.searchQuery);
  const currentThemeId = useUIStore(s => s.currentThemeId);
  const isLightTheme = currentThemeId === 'crisp-light';

  const cellLang = cell.metadata?.language as string | undefined;
  const kernelLang = useKernelStore(s => {
    const spec = s.availableSpecs.find(sp => sp.name === s.spec);
    return spec?.language;
  });
  const monacoLang = (cellLang ?? kernelLang ?? 'python').toLowerCase();

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const sourceRef = useRef(cell.source);
  // eslint-disable-next-line react-hooks/refs
  sourceRef.current = cell.source;
  const cellIdRef = useRef(cell.id);
  // eslint-disable-next-line react-hooks/refs
  cellIdRef.current = cell.id;
  const execRef = useRef(execute);
  // eslint-disable-next-line react-hooks/refs
  execRef.current = execute;

  // update search highlighting decorations when query changes
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;

    if (!searchQuery) {
      decorationsRef.current = ed.deltaDecorations(decorationsRef.current, []);
      return;
    }

    const matches = model.findMatches(searchQuery, true, false, false, null, false);
    const newDecorations = matches.map(m => ({
      range: m.range,
      options: {
        className: 'search-match-monaco',
        overviewRuler: { color: '#fbbf24', position: 1 as import('monaco-editor').editor.OverviewRulerLane },
      },
    }));
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, newDecorations);
  }, [searchQuery, cell.source]);

  // paused-at-line indicator (yellow arrow)
  const pausedDecsRef = useRef<string[]>([]);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    const line = bp.getPausedLine(cell.id);
    if (line && cell.status === 'paused') {
      pausedDecsRef.current = ed.deltaDecorations(pausedDecsRef.current, [{
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'paused-line',
          glyphMarginClassName: 'paused-line-arrow',
        },
      }]);
    } else {
      pausedDecsRef.current = ed.deltaDecorations(pausedDecsRef.current, []);
    }
  }, [cell.status, cell.id]);

  const onMount = useCallback((ed: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = ed;
    registerKernelCompletion(monaco);
    registerR(monaco);
    registerJulia(monaco);

    // bind to Yjs collaboration if active
    if (isCollabActive()) {
      bindEditor(cellIdRef.current, ed);
    }

    const resize = () => {
      if (!containerRef.current) return;
      const h = Math.max(ed.getContentHeight(), 38);
      containerRef.current.style.height = `${h}px`;
      ed.layout();
    };
    ed.onDidContentSizeChange(resize);
    resize();

    // breakpoints — click glyph margin to toggle
    let bpDecorations: string[] = [];

    function refreshBpDecorations() {
      const bps = bp.get(cellIdRef.current);
      bpDecorations = ed.deltaDecorations(bpDecorations,
        [...bps].map(ln => ({
          range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'breakpoint-glyph',
            className: 'breakpoint-line',
          },
        }))
      );
    }

    ed.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        || e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const line = e.target.position?.lineNumber;
        if (!line) return;
        bp.toggle(cellIdRef.current, line);
        refreshBpDecorations();
      }
    });

    ed.onKeyDown((e: IKeyboardEvent) => {
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const enter = e.keyCode === 3;

      // Ctrl+Shift+I — format code (Python only; black/autopep8 doesn't exist for other langs)
      if (ctrl && shift && e.keyCode === 39 /* KeyI */) {
        e.preventDefault();
        e.stopPropagation();
        if (monacoLang === 'python') {
          formatPythonCode(sourceRef.current).then(result => {
            if (result && result !== sourceRef.current) {
              useNotebookStore.getState().updateSource(cellIdRef.current, result);
            }
          });
        }
        return;
      }

      if (!enter) return;

      if (shift && !ctrl && !alt) {
        e.preventDefault();
        e.stopPropagation();
        execRef.current(cellIdRef.current, sourceRef.current);
        advanceToNextCell(cellIdRef.current);
        return;
      }
      if (ctrl && !shift && !alt) {
        e.preventDefault();
        e.stopPropagation();
        execRef.current(cellIdRef.current, sourceRef.current);
        return;
      }
      if (alt && !ctrl && !shift) {
        e.preventDefault();
        e.stopPropagation();
        execRef.current(cellIdRef.current, sourceRef.current);
        const store = useNotebookStore.getState();
        const idx = store.cells.findIndex(c => c.id === cellIdRef.current);
        addCellSynced('code', idx + 1);
        setTimeout(focusActiveCell, 80);
        return;
      }
    });
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Editor
        key={`${cell.id}-${index}`}
        language={monacoLanguage(monacoLang)}
        // When collab is active, MonacoBinding owns the model — don't set value
        // as a controlled prop or it will fight with Yjs and reset cursors.
        {...(isCollabActive() ? { defaultValue: cell.source } : { value: cell.source })}
        onChange={v => {
          // Always sync to Zustand so save/execute use fresh source.
          // This doesn't cause cursor jump because when collab is active
          // we use defaultValue (uncontrolled) so React won't re-set value.
          updateSource(cell.id, v ?? '');
        }}
        onMount={onMount}
        theme={isLightTheme ? 'vs' : 'vs-dark'}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          fontSize: 13,
          lineHeight: 20,
          renderLineHighlight: 'none',
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false,
          },
          padding: { top: 4, bottom: 4 },
          glyphMargin: true,
          folding: false,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 3,
          contextmenu: false,
          renderLineHighlightOnlyWhenFocus: true,
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function advanceToNextCell(currentId: string) {
  (document.activeElement as HTMLElement)?.blur();

  const store = useNotebookStore.getState();
  const cells = store.cells;
  const idx = cells.findIndex(c => c.id === currentId);

  if (idx < cells.length - 1) {
    store.setActiveCell(cells[idx + 1].id);
  } else {
    addCellSynced('code');
  }
  setTimeout(focusActiveCell, 80);
}

// eslint-disable-next-line react-refresh/only-export-components
export function focusActiveEditor() {
  const active = document.querySelector('[data-cell-active="true"]');
  if (!active) return;
  const monaco = active.querySelector('.monaco-editor textarea') as HTMLElement;
  if (monaco) { monaco.focus(); return; }
  const textarea = active.querySelector('textarea') as HTMLElement;
  if (textarea) { textarea.focus(); }
}

// eslint-disable-next-line react-refresh/only-export-components
export function focusActiveCell() {
  const active = document.querySelector('[data-cell-active="true"]');
  if (!active) return;

  const rect = active.getBoundingClientRect();
  const container = active.closest('[class*="overflow-y"]') as HTMLElement;
  if (container) {
    const targetScroll = container.scrollTop + rect.top - container.getBoundingClientRect().top - container.clientHeight / 3;
    container.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }

  const monaco = active.querySelector('.monaco-editor textarea') as HTMLElement;
  if (monaco) { monaco.focus(); return; }
  const textarea = active.querySelector('textarea') as HTMLElement;
  if (textarea) { textarea.focus(); }
}
