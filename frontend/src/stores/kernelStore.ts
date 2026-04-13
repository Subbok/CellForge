import { create } from 'zustand';
import type { KernelStatus } from '../lib/types';

export interface KernelSpecInfo {
  name: string;         // unique key for WS connection
  display_name: string; // what the user sees
  language: string;
}

interface KernelState {
  sessionId: string | null;
  status: KernelStatus;
  spec: string | null; // currently selected kernel name
  availableSpecs: KernelSpecInfo[];
  executingCell: string | null;

  setSession(id: string | null): void;
  setStatus(s: KernelStatus): void;
  setSpec(name: string | null): void;
  setAvailableSpecs(specs: KernelSpecInfo[]): void;
  setExecutingCell(id: string | null): void;
}

export const useKernelStore = create<KernelState>((set) => ({
  sessionId: null,
  status: 'disconnected',
  spec: null,
  availableSpecs: [],
  executingCell: null,

  setSession: (id) => set({ sessionId: id }),
  setStatus: (s) => set({ status: s }),
  setSpec: (name) => set({ spec: name }),
  setAvailableSpecs: (specs) => set({ availableSpecs: specs }),
  setExecutingCell: (id) => set({ executingCell: id }),
}));
