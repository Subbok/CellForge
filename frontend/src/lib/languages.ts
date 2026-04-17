/**
 * Centralized language configuration for CellForge.
 * Maps Jupyter kernel language names to colors, Monaco language IDs, and labels.
 */

interface LanguageConfig {
  /** Color for UI badges, charts, kernel picker */
  color: string;
  /** Monaco editor language ID for syntax highlighting */
  monacoId: string;
  /** Short display label */
  label: string;
}

const LANGUAGES: Record<string, LanguageConfig> = {
  python:     { color: '#3572A5', monacoId: 'python',     label: 'Python' },
  r:          { color: '#198CE7', monacoId: 'r',           label: 'R' },
  julia:      { color: '#9558B2', monacoId: 'julia',       label: 'Julia' },
  javascript: { color: '#F7DF1E', monacoId: 'javascript',  label: 'JavaScript' },
  typescript: { color: '#3178C6', monacoId: 'typescript',  label: 'TypeScript' },
  go:         { color: '#00ADD8', monacoId: 'go',           label: 'Go' },
  kotlin:     { color: '#A97BFF', monacoId: 'kotlin',      label: 'Kotlin' },
  java:       { color: '#B07219', monacoId: 'java',         label: 'Java' },
  scala:      { color: '#DC322F', monacoId: 'scala',        label: 'Scala' },
  rust:       { color: '#DEA584', monacoId: 'rust',         label: 'Rust' },
  c:          { color: '#555555', monacoId: 'c',             label: 'C' },
  'c++':      { color: '#F34B7D', monacoId: 'cpp',          label: 'C++' },
  cpp:        { color: '#F34B7D', monacoId: 'cpp',          label: 'C++' },
  csharp:     { color: '#178600', monacoId: 'csharp',      label: 'C#' },
  ruby:       { color: '#CC342D', monacoId: 'ruby',         label: 'Ruby' },
  perl:       { color: '#0298C3', monacoId: 'perl',         label: 'Perl' },
  php:        { color: '#4F5D95', monacoId: 'php',           label: 'PHP' },
  swift:      { color: '#F05138', monacoId: 'swift',        label: 'Swift' },
  lua:        { color: '#000080', monacoId: 'lua',           label: 'Lua' },
  sql:        { color: '#E38C00', monacoId: 'sql',           label: 'SQL' },
  haskell:    { color: '#5E5086', monacoId: 'plaintext',    label: 'Haskell' },
  erlang:     { color: '#B83998', monacoId: 'plaintext',    label: 'Erlang' },
  elixir:     { color: '#6E4A7E', monacoId: 'plaintext',    label: 'Elixir' },
  ocaml:      { color: '#3be133', monacoId: 'plaintext',    label: 'OCaml' },
  wolfram:    { color: '#DD1100', monacoId: 'plaintext',    label: 'Wolfram' },
  matlab:     { color: '#E16737', monacoId: 'plaintext',    label: 'MATLAB' },
  octave:     { color: '#0790C0', monacoId: 'plaintext',    label: 'Octave' },
  bash:       { color: '#89E051', monacoId: 'shell',        label: 'Bash' },
};

const DEFAULT_CONFIG: LanguageConfig = {
  color: '#7a99ff',
  monacoId: 'plaintext',
  label: 'Unknown',
};

/** Get the full language config for a kernel language. Falls back to defaults for unknown languages. */
export function getLang(language: string): LanguageConfig {
  return LANGUAGES[language.toLowerCase()] ?? { ...DEFAULT_CONFIG, label: language };
}

/** Get the color for a kernel language. */
export function langColor(language: string): string {
  return getLang(language).color;
}

/** Get the Monaco editor language ID for a kernel language. */
export function monacoLanguage(language: string): string {
  return getLang(language).monacoId;
}
