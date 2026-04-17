import { create } from 'zustand';
import type { VariableInfo } from '../lib/types';

export interface DataFramePreview {
  columns: string[];
  dtypes: Record<string, string>;
  shape: [number, number];
  head: Record<string, unknown>[];
}

/** A variable enriched with the language it came from. */
export type VarWithLang = VariableInfo & { language: string };

interface VariableState {
  /** Vars keyed by language — each kernel's introspection updates its own bucket. */
  byLang: Record<string, Record<string, VariableInfo>>;
  /** Flattened view of all vars across all languages, each tagged with its source language. */
  vars: Record<string, VarWithLang>;
  selected: string | null;
  preview: DataFramePreview | null;
  previewLoading: boolean;

  /** Replace the variable snapshot for a specific language. */
  setVarsForLanguage(language: string, v: Record<string, VariableInfo>): void;
  select(name: string | null): void;
  setPreview(p: DataFramePreview | null): void;
  setPreviewLoading(v: boolean): void;
  /** Wipe all per-language buckets — call on kernel restart. */
  clearAll(): void;
}

function flatten(byLang: Record<string, Record<string, VariableInfo>>): Record<string, VarWithLang> {
  const out: Record<string, VarWithLang> = {};
  for (const [lang, vars] of Object.entries(byLang)) {
    for (const [name, info] of Object.entries(vars)) {
      out[name] = { ...info, language: lang };
    }
  }
  return out;
}

export const useVariableStore = create<VariableState>((set) => ({
  byLang: {},
  vars: {},
  selected: null,
  preview: null,
  previewLoading: false,

  setVarsForLanguage: (language, v) => set(s => {
    const byLang = { ...s.byLang, [language]: v };
    return { byLang, vars: flatten(byLang) };
  }),
  select: (name) => set({ selected: name, preview: null }),
  setPreview: (p) => set({ preview: p, previewLoading: false }),
  setPreviewLoading: (v) => set({ previewLoading: v }),
  clearAll: () => set({ byLang: {}, vars: {}, selected: null, preview: null }),
}));
