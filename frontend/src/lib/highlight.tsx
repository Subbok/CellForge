import { Fragment } from 'react';

// splits text into spans, highlighting parts that match the query
export function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;

  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let idx = 0;

  while (idx < text.length) {
    const pos = lower.indexOf(qLower, idx);
    if (pos === -1) {
      parts.push({ text: text.slice(idx), match: false });
      break;
    }
    if (pos > idx) {
      parts.push({ text: text.slice(idx, pos), match: false });
    }
    parts.push({ text: text.slice(pos, pos + query.length), match: true });
    idx = pos + query.length;
  }

  return (
    <>
      {parts.map((p, i) =>
        p.match
          ? <span key={i} className="search-match">{p.text}</span>
          : <Fragment key={i}>{p.text}</Fragment>
      )}
    </>
  );
}
