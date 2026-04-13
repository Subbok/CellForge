let registered = false;

export function registerR(monaco: typeof import('monaco-editor')): void {
  if (registered) return;
  if (monaco.languages.getLanguages().some(l => l.id === 'r')) {
    registered = true;
    return;
  }
  registered = true;

  monaco.languages.register({ id: 'r', aliases: ['R', 'r'], extensions: ['.r', '.R'] });

  monaco.languages.setMonarchTokensProvider('r', {
    defaultToken: '',
    ignoreCase: false,

    keywords: [
      'if', 'else', 'for', 'while', 'repeat', 'in', 'next', 'break',
      'function', 'return', 'library', 'require', 'source',
      'TRUE', 'FALSE', 'NULL', 'NA', 'NA_integer_', 'NA_real_',
      'NA_complex_', 'NA_character_', 'Inf', 'NaN',
    ],

    operators: [
      '<-', '<<-', '->', '->>', '|>', '%>%', '%in%', '%*%', '%/%', '%%',
      '::', ':::', '~', '!', '+', '-', '*', '/', '^', '&', '&&', '|', '||',
      '==', '!=', '<', '>', '<=', '>=', '=', '$', '@', ':', '?',
    ],

    symbols: /[=><!~?:&|+\-*/^%$@]+/,

    tokenizer: {
      root: [
        // comments
        [/#.*$/, 'comment'],

        // strings
        [/"/, 'string', '@doubleString'],
        [/'/, 'string', '@singleString'],

        // numbers: hex, float with exponent, integer suffix, imaginary
        [/0[xX][0-9a-fA-F]+[Li]?/, 'number.hex'],
        [/\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[Li]?/, 'number'],
        [/\.\d+(?:[eE][+-]?\d+)?[Li]?/, 'number'],

        // identifiers and keywords
        [/[a-zA-Z_.]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],

        // backtick-quoted identifiers
        [/`[^`]*`/, 'identifier'],

        // operators
        [/%[a-zA-Z_]+%/, 'operator'],
        [/<<?-|->>?/, 'operator'],
        [/\|>/, 'operator'],
        [/::?:?/, 'operator'],
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        }],

        // brackets
        [/[{}()[\]]/, '@brackets'],

        // delimiter
        [/[;,]/, 'delimiter'],
      ],

      doubleString: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      singleString: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],
    },
  });
}
