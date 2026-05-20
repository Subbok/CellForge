import type { Cell } from './types';

/**
 * Convert one in-memory cell to its ipynb wire shape. Used by the save
 * path, by every export path (HTML / PDF / plugin formats), and by any
 * future "send a notebook to a backend" call. Centralised here so the
 * three round-trip fields that *aren't* part of vanilla ipynb stay in
 * sync between save and export:
 *
 *  - `metadata.cellforge.exec_time_ms` — wall time of the last successful
 *    run, persisted by save so the "Done · 42 ms" chip survives reload
 *    and so PDF / HTML exports can show the same time.
 *
 * Without going through this helper, an export path would send
 * `c.metadata` raw and the PDF would never see exec_time_ms even though
 * the live UI knows the cell took 42 ms.
 */
export function cellToIpynb(c: Cell): Record<string, unknown> {
  const baseCellforge = c.metadata?.cellforge as Record<string, unknown> | undefined;
  const cellforgeMeta: Record<string, unknown> | undefined =
    c.cell_type === 'code' && c.execTimeMs != null
      ? { ...baseCellforge, exec_time_ms: c.execTimeMs }
      : baseCellforge;
  const metadata = cellforgeMeta
    ? { ...c.metadata, cellforge: cellforgeMeta }
    : c.metadata;
  return {
    cell_type: c.cell_type,
    id: c.id,
    source: c.source,
    metadata,
    ...(c.cell_type === 'code'
      ? { outputs: c.outputs, execution_count: c.execution_count }
      : {}),
  };
}
