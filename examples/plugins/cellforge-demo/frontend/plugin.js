/**
 * CellForge Demo Plugin — frontend module.
 *
 * Exercises EVERY contribution type that requires JS:
 * - MIME renderer (custom bar chart)
 * - Commands (toolbar button, cell action, keybinding, export, status bar)
 * - Sidebar panel renderer
 */

export default function register(ctx) {
  console.log("[cellforge-demo] registering all contributions...");

  // ── 1. MIME renderer: simple SVG bar chart ──
  ctx.registerMimeRenderer(
    "application/vnd.cellforge.demo-chart",
    (container, data) => {
      const { values, labels, title } = data;
      const max = Math.max(...values, 1);
      const barW = 40;
      const gap = 8;
      const chartH = 120;
      const titleH = 24;
      const labelH = 20;
      const valueH = 16;
      const w = values.length * (barW + gap) + gap;
      const h = titleH + valueH + chartH + labelH;

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="font-family:Inter,system-ui,sans-serif">`;
      // title — above everything
      svg += `<text x="${w / 2}" y="14" text-anchor="middle" fill="#ebedf2" font-size="12" font-weight="600">${esc(title)}</text>`;
      // bars
      const barTop = titleH + valueH;
      values.forEach((v, i) => {
        const barH = (v / max) * chartH;
        const x = gap + i * (barW + gap);
        const y = barTop + chartH - barH;
        // bar
        svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="#7a99ff" opacity="0.85"/>`;
        // value label — above bar
        svg += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="#a8adba" font-size="10">${v}</text>`;
        // bottom label
        svg += `<text x="${x + barW / 2}" y="${h - 4}" text-anchor="middle" fill="#7d8390" font-size="10">${esc(labels[i] ?? "")}</text>`;
      });
      svg += "</svg>";
      container.innerHTML = svg;
    }
  );

  // ── 2. Commands ──

  // toolbar button + keybinding + status bar click all point here
  ctx.registerCommand("cellforge-demo.hello", () => {
    alert(
      "Hello from cellforge-demo plugin!\n\n" +
        "This proves:\n" +
        "  • Toolbar button → command dispatch\n" +
        "  • Keybinding (Ctrl+Shift+D) → same command\n" +
        "  • Status bar click → same command"
    );
  });

  // cell action — gets {cellId, source} as argument
  ctx.registerCommand("cellforge-demo.cell-info", (args) => {
    const { cellId, source } = args || {};
    const lines = (source || "").split("\n").length;
    alert(
      `Cell info (from cellforge-demo plugin):\n\n` +
        `  ID: ${cellId}\n` +
        `  Lines: ${lines}\n` +
        `  Characters: ${(source || "").length}`
    );
  });

  // export format — gets {notebook, filePath} as argument
  ctx.registerCommand("cellforge-demo.export-txt", (args) => {
    const { notebook, filePath } = args || {};
    const cells = notebook?.cells || [];
    let text = `# Exported from CellForge\n# File: ${filePath || "unknown"}\n\n`;
    cells.forEach((cell, i) => {
      text += `--- Cell ${i + 1} (${cell.cell_type}) ---\n`;
      text += cell.source + "\n\n";
    });
    // trigger download
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name =
      (filePath || "notebook").split("/").pop().replace(".ipynb", "") +
      ".txt";
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── 3. Sidebar panel renderer ──
  ctx.registerPanelRenderer("demo-panel", (container) => {
    container.innerHTML = `
      <div style="padding:12px;font-size:13px;color:#ebedf2;">
        <h3 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#7a99ff;">
          Demo Plugin Panel
        </h3>
        <p style="color:#a8adba;line-height:1.6;margin:0 0 12px;">
          This sidebar panel is contributed by the <b>cellforge-demo</b> plugin.
          It proves that <code>registerPanelRenderer</code> works end-to-end.
        </p>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Theme:</span> <span>Dracula (contributed)</span>
          </div>
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Toolbar:</span> <span>Demo button</span>
          </div>
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Cell action:</span> <span>Info</span>
          </div>
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Keybinding:</span> <span>Ctrl+Shift+D</span>
          </div>
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Export:</span> <span>Plain Text</span>
          </div>
          <div style="padding:8px 12px;background:#242736;border:1px solid #3f4154;border-radius:8px;font-size:11px;">
            <span style="color:#7d8390;">Status bar:</span> <span>"Demo plugin active"</span>
          </div>
        </div>
        <p style="color:#7d8390;font-size:11px;margin-top:12px;">
          All 9 contribution types are active. Check each one!
        </p>
      </div>
    `;
  });

  console.log("[cellforge-demo] all contributions registered.");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
