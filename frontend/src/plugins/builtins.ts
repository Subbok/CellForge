/**
 * Built-in MIME renderers that ship with CellForge itself (not from plugins).
 *
 * Called once at startup from App.tsx. Adds handlers to the same registry
 * that user-installed plugins write to, so CellOutput treats them identically.
 */

import { registerMimeRenderer } from './registry';

// ── Type definitions for viz data ──

interface VizBase {
  kind: string;
  scale?: number;
  color?: string;
  colors?: string[];
  title?: string;
}

interface BarData extends VizBase {
  kind: 'bar';
  values: number[];
  labels: string[];
}

interface LineData extends VizBase {
  kind: 'line';
  values: number[];
  labels: string[];
  show_every?: number;
}

interface PieData extends VizBase {
  kind: 'pie';
  values: number[];
  labels: string[];
}

interface HbarData extends VizBase {
  kind: 'hbar';
  values: number[];
  labels: string[];
}

interface StatData extends VizBase {
  kind: 'stat';
  label: string;
  value: string;
  delta?: string;
  caption?: string;
}

interface CalloutData extends VizBase {
  kind: 'callout';
  text: string;
  callout_kind?: string;
  callout_title?: string;
}

interface ProgressData extends VizBase {
  kind: 'progress';
  value: number;
  max: number;
  label?: string;
}

interface DiagramData extends VizBase {
  kind: 'diagram';
  edges: [string, string, string][];
  diagram_kind?: string;
}

type VizData = BarData | LineData | PieData | HbarData | StatData | CalloutData | ProgressData | DiagramData;

interface MermaidModule {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

interface MermaidData {
  source: string;
  scale?: number;
}

// ── Mermaid diagrams ──

let mermaidReady: Promise<MermaidModule> | null = null;

function ensureMermaid() {
  if (!mermaidReady) {
    mermaidReady = import(
      /* @vite-ignore */
      // @ts-expect-error dynamic CDN import
      'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
    ).then(mod => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: 'transparent',
          primaryColor: '#242736',
          primaryBorderColor: '#3f4154',
          primaryTextColor: '#ebedf2',
          secondaryColor: '#2b2e3d',
          tertiaryColor: '#161823',
          lineColor: '#7a99ff',
          textColor: '#ebedf2',
          mainBkg: '#242736',
          nodeBorder: '#3f4154',
          clusterBkg: '#1d1f2a',
          titleColor: '#ebedf2',
          edgeLabelBackground: '#161823',
        },
      });
      return mod.default;
    });
  }
  return mermaidReady;
}

let mermaidCounter = 0;

// ── Viz helpers (bliss_mo) ──

const PALETTE = [
  '#7a99ff', '#ff79c6', '#50fa7b', '#ffb86c', '#bd93f9',
  '#8be9fd', '#f1fa8c', '#ff5555', '#6272a4', '#44475a',
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Base widths per chart type. scale=1.0 maps to this %, scale=2.0 doubles it. No cap. */
const BASE_WIDTH: Record<string, number> = {
  bar: 30, line: 100, pie: 50, hbar: 50, flow: 60, sequence: 60,
};

function chartMaxWidth(d: VizBase): string {
  const base = BASE_WIDTH[d.kind] ?? 100;
  const scale = d.scale ?? 1;
  return `${Math.round(base * scale)}%`;
}

/** Resolve the color for item i: user-specified color > user-specified colors[i] > palette fallback */
function pickColor(d: VizBase, i: number): string {
  if (d.colors && d.colors[i]) return d.colors[i];
  if (d.color) return d.color;
  return PALETTE[i % PALETTE.length];
}

function renderBar(container: HTMLElement, d: BarData) {
  const { values, labels, title } = d;
  const max = Math.max(...values, 1);
  const barW = 40, gap = 8, chartH = 120, titleH = title ? 28 : 0, valueH = 16, labelH = 20;
  const w = values.length * (barW + gap) + gap;
  const h = titleH + valueH + chartH + labelH;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth(d)};height:auto;font-family:var(--font-sans)">`;
  if (title) svg += `<text x="${w/2}" y="14" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;
  const barTop = titleH + valueH;
  values.forEach((v: number, i: number) => {
    const barH = (v / max) * chartH;
    const x = gap + i * (barW + gap);
    const y = barTop + chartH - barH;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${pickColor(d, i)}" opacity="0.85"/>`;
    svg += `<text x="${x+barW/2}" y="${y-4}" text-anchor="middle" fill="var(--color-text-secondary)" font-size="10">${v}</text>`;
    svg += `<text x="${x+barW/2}" y="${h-4}" text-anchor="middle" fill="var(--color-text-muted)" font-size="10">${esc(labels[i] ?? '')}</text>`;
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderLine(container: HTMLElement, d: LineData) {
  const { values, labels, title } = d;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const showEvery = d.show_every ?? 1;
  // When show_every > 1, compress point spacing so the chart isn't mostly empty space
  const pointSpacing = showEvery > 1 ? Math.max(20, 50 / Math.sqrt(showEvery)) : 50;
  const padX = 30, padTop = title ? 34 : 10, padBot = 24;
  const chartW = Math.max(values.length * pointSpacing, 200);
  const chartH = 120;
  const w = chartW + padX * 2;
  const h = chartH + padTop + padBot;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth(d)};height:auto;font-family:var(--font-sans)">`;
  if (title) svg += `<text x="${w/2}" y="16" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;

  // axis line
  svg += `<line x1="${padX}" y1="${padTop + chartH}" x2="${w - padX}" y2="${padTop + chartH}" stroke="var(--color-border)" stroke-width="1"/>`;

  // points + line
  const pts = values.map((v: number, i: number) => {
    const x = padX + (i / Math.max(values.length - 1, 1)) * chartW;
    const y = padTop + chartH - ((v - min) / range) * chartH;
    return [x, y];
  });
  if (pts.length > 1) {
    const path = pts.map(([x, y]: number[], i: number) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="${pickColor(d, 0)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  pts.forEach(([x, y]: number[], i: number) => {
    const isShown = showEvery > 0 && (i % showEvery === 0 || i === values.length - 1);
    // smaller dot for hidden points, full dot + labels for shown points
    svg += `<circle cx="${x}" cy="${y}" r="${isShown ? 3.5 : 1.5}" fill="${pickColor(d, 0)}" ${isShown ? 'stroke="var(--color-bg)" stroke-width="2"' : 'opacity="0.5"'}/>`;
    if (isShown) {
      svg += `<text x="${x}" y="${y - 8}" text-anchor="middle" fill="var(--color-text-secondary)" font-size="9">${values[i]}</text>`;
      svg += `<text x="${x}" y="${h - 4}" text-anchor="middle" fill="var(--color-text-muted)" font-size="9">${esc(labels[i] ?? '')}</text>`;
    }
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderPie(container: HTMLElement, d: PieData) {
  const { values, labels, title } = d;
  const total = values.reduce((a: number, b: number) => a + b, 0) || 1;
  const cx = 100, cy = 100, r = 80;
  const legendX = cx * 2 + 30;
  const w = legendX + 140;
  const h = Math.max(cy * 2, labels.length * 20 + (title ? 34 : 10));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth(d)};height:auto;font-family:var(--font-sans)">`;
  if (title) svg += `<text x="${cx}" y="16" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;

  let angle = -Math.PI / 2;
  values.forEach((v: number, i: number) => {
    const slice = (v / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + slice);
    const y2 = cy + r * Math.sin(angle + slice);
    const large = slice > Math.PI ? 1 : 0;
    svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${pickColor(d, i)}" opacity="0.85" stroke="var(--color-bg)" stroke-width="2"/>`;
    angle += slice;
  });

  // legend
  const legendTop = title ? 34 : 10;
  labels.forEach((label: string, i: number) => {
    const y = legendTop + i * 20 + 10;
    const pct = ((values[i] / total) * 100).toFixed(1);
    svg += `<rect x="${legendX}" y="${y - 8}" width="10" height="10" rx="2" fill="${pickColor(d, i)}"/>`;
    svg += `<text x="${legendX + 16}" y="${y}" fill="var(--color-text-secondary)" font-size="11">${esc(label)} (${pct}%)</text>`;
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderHbar(container: HTMLElement, d: HbarData) {
  const { values, labels, title } = d;
  const max = Math.max(...values, 1);
  const barH = 24, gap = 6, labelW = 80;
  const chartW = 250;
  const titleH = title ? 28 : 0;
  const w = labelW + chartW + 60;
  const h = titleH + values.length * (barH + gap) + gap;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth(d)};height:auto;font-family:var(--font-sans)">`;
  if (title) svg += `<text x="${w/2}" y="16" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;

  values.forEach((v: number, i: number) => {
    const barW = (v / max) * chartW;
    const y = titleH + gap + i * (barH + gap);
    svg += `<text x="${labelW - 6}" y="${y + barH / 2 + 4}" text-anchor="end" fill="var(--color-text-secondary)" font-size="11">${esc(labels[i] ?? '')}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${pickColor(d, i)}" opacity="0.85"/>`;
    svg += `<text x="${labelW + barW + 6}" y="${y + barH / 2 + 4}" fill="var(--color-text-muted)" font-size="10">${v}</text>`;
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderStat(container: HTMLElement, d: StatData) {
  const { label, value, delta, caption } = d;
  const isPositive = delta && !delta.startsWith('-');
  const deltaColor = delta ? (isPositive ? 'var(--color-success)' : 'var(--color-error)') : '';
  container.innerHTML = `
    <div style="display:inline-flex;flex-direction:column;padding:16px 24px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-elevated);min-width:140px;">
      <span style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${esc(label)}</span>
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:28px;font-weight:700;color:var(--color-text);line-height:1;">${esc(value)}</span>
        ${delta ? `<span style="font-size:13px;font-weight:600;color:${deltaColor};">${esc(delta)}</span>` : ''}
      </div>
      ${caption ? `<span style="font-size:11px;color:var(--color-text-muted);margin-top:4px;">${esc(caption)}</span>` : ''}
    </div>`;
}

function renderCallout(container: HTMLElement, d: CalloutData) {
  const { text, callout_kind, callout_title } = d;
  const colors: Record<string, { bg: string; border: string; icon: string }> = {
    info:    { bg: 'var(--color-accent)',  border: 'var(--color-accent)',  icon: 'ℹ️' },
    warning: { bg: 'var(--color-warning)', border: 'var(--color-warning)', icon: '⚠️' },
    error:   { bg: 'var(--color-error)',   border: 'var(--color-error)',   icon: '❌' },
    success: { bg: 'var(--color-success)', border: 'var(--color-success)', icon: '✅' },
  };
  const c = callout_kind ? colors[callout_kind] ?? colors.info : colors.info;
  container.innerHTML = `
    <div style="border-left:4px solid ${c.border};background:color-mix(in srgb, ${c.bg} 8%, transparent);border-radius:0 8px 8px 0;padding:12px 16px;margin:4px 0;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:${callout_title ? '6' : '0'}px;">
        <span>${c.icon}</span>
        ${callout_title ? `<span style="font-weight:600;font-size:13px;color:var(--color-text);">${esc(callout_title)}</span>` : ''}
      </div>
      <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.6;">${esc(text)}</div>
    </div>`;
}

function renderProgress(container: HTMLElement, d: ProgressData) {
  const { value, max, label, color } = d;
  const pct = Math.min(100, Math.max(0, (value / (max || 1)) * 100));
  const barColor = color || 'var(--color-accent)';
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:4px 0;">
      ${label ? `<span style="font-size:12px;color:var(--color-text-secondary);min-width:80px;">${esc(label)}</span>` : ''}
      <div style="flex:1;height:8px;background:var(--color-bg-elevated);border-radius:4px;overflow:hidden;border:1px solid var(--color-border);">
        <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s;"></div>
      </div>
      <span style="font-size:11px;color:var(--color-text-muted);min-width:36px;text-align:right;">${pct.toFixed(0)}%</span>
    </div>`;
}

// ── Diagrams (pure SVG) ──

function renderDiagram(container: HTMLElement, d: DiagramData) {
  const { edges, diagram_kind, title } = d;
  if (diagram_kind === 'sequence') {
    renderSequenceDiagram(container, edges, title, d);
  } else {
    renderFlowDiagram(container, edges, title, d);
  }
}

function renderFlowDiagram(container: HTMLElement, edges: [string, string, string][], title: string | undefined, d: DiagramData) {
  // collect unique nodes
  const nodeSet = new Set<string>();
  for (const [a, b] of edges) { nodeSet.add(a); nodeSet.add(b); }
  const nodes = [...nodeSet];

  const nodeW = 120, nodeH = 36, gapX = 60, gapY = 60;
  const cols = Math.min(nodes.length, 4);
  const rows = Math.ceil(nodes.length / cols);
  const titleH = title ? 28 : 0;
  const w = cols * (nodeW + gapX) + gapX;
  const h = titleH + rows * (nodeH + gapY) + gapY;

  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pos[n] = {
      x: gapX + col * (nodeW + gapX) + nodeW / 2,
      y: titleH + gapY + row * (nodeH + gapY) + nodeH / 2,
    };
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth({...d, kind: 'flow'})};height:auto;font-family:var(--font-sans)">`;
  svg += '<defs><marker id="bl-arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--color-accent)"/></marker></defs>';
  if (title) svg += `<text x="${w/2}" y="18" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;

  // edges
  for (const [a, b, label] of edges) {
    const from = pos[a], to = pos[b];
    if (!from || !to) continue;
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    svg += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="var(--color-accent)" stroke-width="1.5" marker-end="url(#bl-arrow)" opacity="0.7"/>`;
    if (label) svg += `<text x="${mx}" y="${my - 6}" text-anchor="middle" fill="var(--color-text-muted)" font-size="9" font-style="italic">${esc(label)}</text>`;
  }

  // nodes
  for (const n of nodes) {
    const p = pos[n];
    svg += `<rect x="${p.x - nodeW/2}" y="${p.y - nodeH/2}" width="${nodeW}" height="${nodeH}" rx="8" fill="var(--color-bg-elevated)" stroke="var(--color-border)" stroke-width="1.5"/>`;
    svg += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" fill="var(--color-text)" font-size="11" font-weight="500">${esc(n)}</text>`;
  }
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderSequenceDiagram(container: HTMLElement, edges: [string, string, string][], title: string | undefined, d: DiagramData) {
  const actorSet = new Set<string>();
  for (const [a, b] of edges) { actorSet.add(a); actorSet.add(b); }
  const actors = [...actorSet];

  const actorW = 100, actorGap = 40, rowH = 36;
  const titleH = title ? 28 : 0;
  const headerH = 30;
  const w = actors.length * (actorW + actorGap) + actorGap;
  const h = titleH + headerH + edges.length * rowH + 20;

  const actorX: Record<string, number> = {};
  actors.forEach((a, i) => {
    actorX[a] = actorGap + i * (actorW + actorGap) + actorW / 2;
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:${chartMaxWidth({...d, kind: 'sequence'})};height:auto;font-family:var(--font-sans)">`;
  svg += '<defs><marker id="bl-seq-arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--color-accent)"/></marker></defs>';
  if (title) svg += `<text x="${w/2}" y="18" text-anchor="middle" fill="var(--color-text)" font-size="12" font-weight="600">${esc(title)}</text>`;

  // actor labels + lifelines
  const lifeTop = titleH + headerH;
  for (const a of actors) {
    const x = actorX[a];
    svg += `<text x="${x}" y="${titleH + 18}" text-anchor="middle" fill="var(--color-text)" font-size="11" font-weight="600">${esc(a)}</text>`;
    svg += `<line x1="${x}" y1="${lifeTop}" x2="${x}" y2="${h - 10}" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="4 3"/>`;
  }

  // messages
  edges.forEach(([from, to, label], i) => {
    const y = lifeTop + i * rowH + rowH / 2;
    const x1 = actorX[from] ?? 0;
    const x2 = actorX[to] ?? 0;
    const isReturn = x2 < x1;
    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--color-accent)" stroke-width="1.5" ${isReturn ? 'stroke-dasharray="6 3"' : ''} marker-end="url(#bl-seq-arrow)" opacity="0.8"/>`;
    const mx = (x1 + x2) / 2;
    if (label) svg += `<text x="${mx}" y="${y - 6}" text-anchor="middle" fill="var(--color-text-secondary)" font-size="9">${esc(label)}</text>`;
  });

  svg += '</svg>';
  container.innerHTML = svg;
}

// ── Registration ──

export function registerBuiltinRenderers() {
  // Mermaid diagrams
  registerMimeRenderer('application/vnd.cellforge.mermaid', async (container, data) => {
    const d = data as MermaidData;
    const mermaid = await ensureMermaid();
    const id = `bliss-mermaid-${++mermaidCounter}`;
    try {
      const { svg } = await mermaid.render(id, d.source);
      container.innerHTML = svg;
      const svgEl = container.querySelector('svg');
      if (svgEl) {
        const scale = d.scale ?? 1;
        svgEl.style.maxWidth = `${Math.round(scale * 100)}%`;
        svgEl.style.height = 'auto';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      container.innerHTML = `<pre style="color:#f87171;font-size:12px;">Mermaid error: ${
        message
      }\n\nSource:\n${d.source}</pre>`;
    }
  });

  // bliss_mo visualizations — one MIME type, dispatched by `kind`
  registerMimeRenderer('application/vnd.cellforge.viz', (container, data) => {
    const d = data as VizData;
    switch (d.kind) {
      case 'bar':      renderBar(container, d); break;
      case 'line':     renderLine(container, d); break;
      case 'pie':      renderPie(container, d); break;
      case 'hbar':     renderHbar(container, d); break;
      case 'stat':     renderStat(container, d); break;
      case 'callout':  renderCallout(container, d); break;
      case 'progress': renderProgress(container, d); break;
      case 'diagram':  renderDiagram(container, d); break;
      default:
        container.innerHTML = `<div style="color:var(--color-text-muted);font-size:12px;">Unknown bliss_mo kind: ${(d as VizBase).kind}</div>`;
    }
  });
}
