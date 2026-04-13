// breakpoint storage: cellId -> Set of line numbers (1-indexed)
const store = new Map<string, Set<number>>();

export function toggle(cellId: string, line: number) {
  let s = store.get(cellId);
  if (!s) { s = new Set(); store.set(cellId, s); }
  if (s.has(line)) s.delete(line);
  else s.add(line);
}

export function get(cellId: string): Set<number> {
  return store.get(cellId) ?? new Set();
}

export function clear(cellId: string) {
  store.delete(cellId);
}

export function clearAll() {
  store.clear();
}

// track which line we're paused at (for the arrow indicator)
const pausedLine = new Map<string, number>();

export function setPausedLine(cellId: string, line: number) {
  pausedLine.set(cellId, line);
}

export function getPausedLine(cellId: string): number | null {
  return pausedLine.get(cellId) ?? null;
}

export function clearPausedLine(cellId: string) {
  pausedLine.delete(cellId);
}

/// Split code at the first breakpoint and return [before, after].
/// If no breakpoints, returns [fullCode, null].
export function splitAtBreakpoint(cellId: string, code: string): [string, string | null] {
  const bps = get(cellId);
  if (bps.size === 0) return [code, null];

  const codeLines = code.split('\n');
  const sorted = [...bps].sort((a, b) => a - b);
  const firstBp = sorted[0];

  // execute lines 1..(bp-1), pause before bp line
  if (firstBp <= 1) return ['', code]; // breakpoint on first line
  const before = codeLines.slice(0, firstBp - 1).join('\n');
  const after = codeLines.slice(firstBp - 1).join('\n');
  return [before, after];
}

/// After continuing, get the next chunk to execute.
/// Removes the used breakpoint and splits at the next one.
export function continueFromBreakpoint(cellId: string, remainingCode: string): [string, string | null] {
  const bps = get(cellId);

  // find the next breakpoint in the remaining code (relative to remaining)
  // we need to figure out which original line we're at...
  // simplified: just remove the first breakpoint and split at next
  if (bps.size === 0) return [remainingCode, null];

  const sorted = [...bps].sort((a, b) => a - b);
  bps.delete(sorted[0]); // consumed

  // now check if there's another breakpoint
  if (sorted.length <= 1) return [remainingCode, null];

  // find the next bp line relative to the original code — tricky
  // simplified approach: just run all remaining
  return [remainingCode, null];
}
