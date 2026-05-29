let registered = false;

/** Register a lightweight Typst language for Monaco (syntax highlighting only). */
export function registerTypst(monaco: typeof import('monaco-editor')): void {
  if (registered) return;
  if (monaco.languages.getLanguages().some(l => l.id === 'typst')) {
    registered = true;
    return;
  }
  registered = true;

  monaco.languages.register({ id: 'typst', aliases: ['Typst', 'typst'], extensions: ['.typ'] });

  monaco.languages.setMonarchTokensProvider('typst', {
    defaultToken: '',
    ignoreCase: false,

    keywords: [
      'let', 'set', 'show', 'import', 'include', 'if', 'else', 'for', 'while',
      'in', 'and', 'or', 'not', 'none', 'auto', 'true', 'false', 'return',
      'break', 'continue', 'as',
    ],

    tokenizer: {
      root: [
        // line comments and block comments
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],

        // headings (= Heading, == Subheading …)
        [/^\s*=+\s.*$/, 'keyword'],

        // inline / block math: $ ... $
        [/\$/, 'string', '@math'],

        // code expressions introduced by #
        [/#[a-zA-Z_][\w-]*/, 'variable'],

        // bracketed code blocks / function calls keep default token,
        // but pick up keywords inside
        [/[a-zA-Z_][\w-]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': '',
          },
        }],

        // strings
        [/"/, 'string', '@string'],

        // numbers (incl. lengths like 1cm, 2pt, 100%)
        [/\d+(\.\d+)?(pt|mm|cm|in|em|fr|%|deg|rad)?/, 'number'],

        // markup emphasis markers
        [/[*_`]/, 'keyword'],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      math: [
        [/[^$]+/, 'string'],
        [/\$/, 'string', '@pop'],
      ],
    },
  });
}
