import { create } from 'zustand';
import type { VariableInfo } from '../lib/types';

export interface DataFramePreview {
  columns: string[];
  dtypes: Record<string, string>;
  shape: [number, number];
  head: Record<string, unknown>[];
}

interface VariableState {
  vars: Record<string, VariableInfo>;
  selected: string | null;
  preview: DataFramePreview | null;
  previewLoading: boolean;

  setVars(v: Record<string, VariableInfo>): void;
  select(name: string | null): void;
  setPreview(p: DataFramePreview | null): void;
  setPreviewLoading(v: boolean): void;
}

export const useVariableStore = create<VariableState>((set) => ({
  vars: {},
  selected: null,
  preview: null,
  previewLoading: false,

  setVars: (v) => set({ vars: v }),
  select: (name) => set({ selected: name, preview: null }),
  setPreview: (p) => set({ preview: p, previewLoading: false }),
  setPreviewLoading: (v) => set({ previewLoading: v }),
}));
