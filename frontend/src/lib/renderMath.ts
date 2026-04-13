import katex from 'katex';

// pre-process markdown source: find $$...$$ and $...$ blocks,
// render them to HTML with katex directly (with proper displayMode),
// and return markdown with HTML math blocks embedded.
//
// this bypasses the flaky remark-math -> rehype-katex pipeline entirely.

export function renderMathInMarkdown(src: string): string {
  // first: display math ($$...$$) — must come before inline to avoid conflicts
  let out = src.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return `<code>${tex}</code>`;
    }
  });

  // then: inline math ($...$) — careful not to match $$
  out = out.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<code>${tex}</code>`;
    }
  });

  return out;
}
