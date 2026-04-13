// simple line-level diff — returns list of {type, text} entries

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  // simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  let oi = 0, ni = 0, li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li] && ni < newLines.length && newLines[ni] === lcs[li]) {
      result.push({ type: 'same', text: lcs[li] });
      oi++; ni++; li++;
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      result.push({ type: 'del', text: oldLines[oi] });
      oi++;
    } else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
      result.push({ type: 'add', text: newLines[ni] });
      ni++;
    } else {
      break; // shouldn't happen
    }
  }

  return result;
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  // for very long cells, just do a simplified comparison
  if (m > 500 || n > 500) {
    return a.filter(line => b.includes(line));
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // backtrack
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result;
}
