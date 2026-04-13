import { Fragment } from 'react';

const COLORS: Record<number, string> = {
  30: '#4b5563', 31: '#ef4444', 32: '#22c55e', 33: '#eab308',
  34: '#3b82f6', 35: '#a855f7', 36: '#06b6d4', 37: '#d1d5db',
  39: 'inherit', // default
  90: '#6b7280', 91: '#f87171', 92: '#4ade80', 93: '#facc15',
  94: '#60a5fa', 95: '#c084fc', 96: '#22d3ee', 97: '#f3f4f6',
};

interface Chunk {
  text: string;
  color?: string;
  bold?: boolean;
}

function parseAnsi(input: string): Chunk[] {
  const chunks: Chunk[] = [];
  let color: string | undefined;
  let bold = false;

  // match ANSI sequences: optional ESC char, then [ digits ; digits m
  // handles both \x1b[31m AND bare [31m (ESC sometimes gets stripped)
  // eslint-disable-next-line no-control-regex
  const re = /(?:\x1b|\u001b)?\[(\d+(?:;\d+)*)m/g;
  let last = 0;
  let match;

  while ((match = re.exec(input)) !== null) {
    // text before this escape sequence
    if (match.index > last) {
      const text = input.slice(last, match.index);
      if (text) chunks.push({ text, color, bold });
    }
    last = match.index + match[0].length;

    // parse the codes
    const codes = match[1].split(';').map(Number);
    let i = 0;
    while (i < codes.length) {
      const c = codes[i];
      if (c === 0) { color = undefined; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c >= 30 && c <= 37) color = COLORS[c];
      else if (c >= 90 && c <= 97) color = COLORS[c];
      else if (c === 39) color = undefined;
      else if (c === 38 && codes[i + 1] === 5) {
        // 256-color: 38;5;N — just skip, use default
        i += 2;
      }
      else if (c === 48) {
        // background color — skip
        if (codes[i + 1] === 5) i += 2;
      }
      i++;
    }
  }

  // remaining text after last escape
  if (last < input.length) {
    const text = input.slice(last);
    if (text) chunks.push({ text, color, bold });
  }

  // if no ANSI found at all, return raw text
  if (chunks.length === 0 && input) {
    chunks.push({ text: input });
  }

  return chunks;
}

export function AnsiText({ children }: { children: unknown }) {
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const chunks = parseAnsi(raw);

  return (
    <>
      {chunks.map((c, i) => {
        if (!c.color && !c.bold) return <Fragment key={i}>{c.text}</Fragment>;
        const style: React.CSSProperties = {};
        if (c.color) style.color = c.color;
        if (c.bold) style.fontWeight = 'bold';
        return <span key={i} style={style}>{c.text}</span>;
      })}
    </>
  );
}
