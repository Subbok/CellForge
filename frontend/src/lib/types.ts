export type CellType = 'code' | 'markdown' | 'raw';

export type CellStatus = 'idle' | 'running' | 'success' | 'error' | 'stale' | 'queued' | 'paused';

export interface CellOutput {
  output_type: 'execute_result' | 'display_data' | 'update_display_data' | 'stream' | 'error';
  // execute_result / display_data
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  // stream
  name?: 'stdout' | 'stderr';
  text?: string;
  // error
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface Cell {
  id: string;
  cell_type: CellType;
  source: string;
  metadata: Record<string, unknown>;
  outputs: CellOutput[];
  execution_count: number | null;
  status: CellStatus;
  execTimeMs: number | null; // how long the last run took
}

export interface NotebookMetadata {
  kernelspec?: {
    name: string;
    display_name: string;
    language?: string;
  };
  language_info?: {
    name: string;
    version?: string;
    file_extension?: string;
  };
  [key: string]: unknown;
}

export interface Notebook {
  metadata: NotebookMetadata;
  nbformat: number;
  nbformat_minor: number;
  cells: Cell[];
}

export type KernelStatus = 'idle' | 'busy' | 'starting' | 'restarting' | 'dead' | 'disconnected';

export interface VariableInfo {
  name: string;
  type: string;
  module?: string;
  shape?: string;
  dtype?: string;
  size?: number;
  repr: string;
  language?: string;
}

export interface DagEdge {
  from: string; // cell id that defines
  to: string;   // cell id that references
  names: string[]; // variable names on this edge
}

export interface WsMessage {
  type: string;
  id: string;
  session_id?: string;
  payload: Record<string, unknown>;
}
