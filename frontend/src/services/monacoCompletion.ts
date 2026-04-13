import type { languages, editor, Position, CancellationToken } from 'monaco-editor';
import { requestCompletion } from './kernelComplete';

let registered = false;

export function registerKernelCompletion(monaco: typeof import('monaco-editor')) {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],

    async provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
      _context: languages.CompletionContext,
      _token: CancellationToken,
    ): Promise<languages.CompletionList> {
      // get the full text of the cell up to cursor
      const code = model.getValue();
      const offset = model.getOffsetAt(position);

      const { matches, cursorStart, cursorEnd } = await requestCompletion(code, offset);

      if (!matches.length) {
        return { suggestions: [] };
      }

      // figure out the word range to replace
      const startPos = model.getPositionAt(cursorStart);
      const endPos = model.getPositionAt(cursorEnd);
      const range = {
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      };

      const suggestions: languages.CompletionItem[] = matches.map((m, i) => ({
        label: m,
        kind: guessKind(m, monaco),
        insertText: m,
        range,
        sortText: String(i).padStart(5, '0'), // keep kernel's ordering
      }));

      return { suggestions };
    }
  });
}

function guessKind(name: string, monaco: typeof import('monaco-editor')): languages.CompletionItemKind {
  // rough heuristic based on naming conventions
  if (name.startsWith('__') && name.endsWith('__')) return monaco.languages.CompletionItemKind.Property;
  if (name[0] === name[0].toUpperCase() && name[0] !== '_') return monaco.languages.CompletionItemKind.Class;
  if (name.includes('(')) return monaco.languages.CompletionItemKind.Function;
  return monaco.languages.CompletionItemKind.Variable;
}
