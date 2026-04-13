/**
 * CellForge Mermaid plugin — frontend module.
 *
 * Registers a MIME renderer for `application/vnd.cellforge.mermaid`.
 * On first render, lazily imports mermaid from a CDN and initializes it
 * with a dark theme matching CellForge's palette. Subsequent renders reuse
 * the loaded library.
 */

let mermaidReady = null;

function ensureMermaid() {
  if (!mermaidReady) {
    mermaidReady = import(
      "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
    ).then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "transparent",
          primaryColor: "#242736",
          primaryBorderColor: "#3f4154",
          primaryTextColor: "#ebedf2",
          secondaryColor: "#2b2e3d",
          tertiaryColor: "#161823",
          lineColor: "#7a99ff",
          textColor: "#ebedf2",
          mainBkg: "#242736",
          nodeBorder: "#3f4154",
          clusterBkg: "#1d1f2a",
          titleColor: "#ebedf2",
          edgeLabelBackground: "#161823",
        },
      });
      return mod.default;
    });
  }
  return mermaidReady;
}

let counter = 0;

export default function register(ctx) {
  ctx.registerMimeRenderer(
    "application/vnd.cellforge.mermaid",
    async (container, data) => {
      const mermaid = await ensureMermaid();
      const id = `bliss-mermaid-${++counter}`;

      try {
        const { svg } = await mermaid.render(id, data.source);
        container.innerHTML = svg;
        // make SVG responsive
        const svgEl = container.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
        }
      } catch (err) {
        container.innerHTML = `<pre style="color:#f87171;font-size:12px;">Mermaid error: ${
          err.message || err
        }\n\nSource:\n${data.source}</pre>`;
      }
    }
  );
}
