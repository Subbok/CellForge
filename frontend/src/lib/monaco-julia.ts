let registered = false;

export function registerJulia(monaco: typeof import('monaco-editor')): void {
  if (registered) return;
  if (monaco.languages.getLanguages().some(l => l.id === 'julia')) {
    registered = true;
    return;
  }
  registered = true;

  monaco.languages.register({ id: 'julia', aliases: ['Julia', 'julia'], extensions: ['.jl'] });

  monaco.languages.setMonarchTokensProvider('julia', {
    defaultToken: '',
    ignoreCase: false,

    keywords: [
      'function', 'end', 'begin', 'if', 'elseif', 'else',
      'for', 'while', 'do', 'try', 'catch', 'finally',
      'return', 'break', 'continue',
      'struct', 'mutable', 'abstract', 'primitive', 'type',
      'module', 'baremodule', 'using', 'import', 'export',
      'let', 'local', 'global', 'const',
      'macro', 'quote', 'where',
      'true', 'false', 'nothing', 'missing',
    ],

    typeKeywords: [
      'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128',
      'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128',
      'Float16', 'Float32', 'Float64',
      'Bool', 'Char', 'String', 'Symbol',
      'Any', 'Union', 'Nothing', 'Missing',
      'Vector', 'Matrix', 'Array', 'Tuple', 'Dict',
    ],

    operators: [
      '=', '+=', '-=', '*=', '/=', '\\=', '^=', '%=',
      '==', '!=', '<', '>', '<=', '>=', '===', '!==',
      '+', '-', '*', '/', '\\', '^', '%',
      '&', '|', '~', '!', '&&', '||',
      '|>', '.+', '.-', '.*', './', '.\\', '.^',
      '=>', '::', '..', '.',
    ],

    symbols: /[=><!~?:&|+\-*/\\^%]+/,

    tokenizer: {
      root: [
        // block comments #= ... =#
        [/#=/, 'comment', '@blockComment'],

        // line comments
        [/#.*$/, 'comment'],

        // raw strings
        [/raw"/, 'string', '@rawString'],

        // triple-quoted strings
        [/"""/, 'string', '@tripleString'],

        // regular strings with interpolation
        [/"/, 'string', '@doubleString'],

        // character literals
        [/'[^\\']'/, 'string'],
        [/'\\.'/, 'string'],

        // numbers: hex, binary, octal, float, imaginary
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number.binary'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/\d[0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?\d[0-9_]*)?(?:im)?/, 'number'],
        [/\.\d[0-9_]*(?:[eE][+-]?\d[0-9_]*)?(?:im)?/, 'number'],

        // identifiers and keywords
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier',
          },
        }],

        // dot-operators
        [/\.[+\-*/\\^%<>=!]+/, 'operator'],

        // pipe, arrow, type annotation
        [/\|>/, 'operator'],
        [/=>/, 'operator'],
        [/::/, 'operator'],
        [/\.\./, 'operator'],

        // other operators
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        }],

        // macro calls
        [/@[a-zA-Z_]\w*/, 'annotation'],

        // brackets
        [/[{}()[\]]/, '@brackets'],

        // delimiters
        [/[;,]/, 'delimiter'],
      ],

      blockComment: [
        [/#=/, 'comment', '@push'],
        [/=#/, 'comment', '@pop'],
        [/./, 'comment'],
      ],

      doubleString: [
        [/\$\(/, 'string.interpolation', '@interpolation'],
        [/\$[a-zA-Z_]\w*/, 'string.interpolation'],
        [/[^\\$"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      tripleString: [
        [/\$\(/, 'string.interpolation', '@interpolation'],
        [/\$[a-zA-Z_]\w*/, 'string.interpolation'],
        [/"""/, 'string', '@pop'],
        [/./, 'string'],
      ],

      rawString: [
        [/[^"]+/, 'string'],
        [/"/, 'string', '@pop'],
      ],

      interpolation: [
        [/\(/, 'string.interpolation', '@push'],
        [/\)/, 'string.interpolation', '@pop'],
        { include: 'root' },
      ],
    },
  });
}
