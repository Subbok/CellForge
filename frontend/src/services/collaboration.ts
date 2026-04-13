import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import * as awarenessProtocol from 'y-protocols/awareness';
import { useNotebookStore } from '../stores/notebookStore';
import type { CellType, CellStatus } from '../lib/types';
import type { editor } from 'monaco-editor';

const CURSOR_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];
const REMOTE = 'remote'; // origin tag for received updates

export type CellOp =
  | { type: 'add'; cellType: string; index: number; cellId: string }
  | { type: 'delete'; cellId: string }
  | { type: 'move'; cellId: string; dir: 'up' | 'down' }
  | { type: 'reorder'; fromIdx: number; toIdx: number }
  | { type: 'clear_outputs'; cellId?: string }
  | { type: 'set_status'; cellId: string; status: string }
  | { type: 'change_type'; cellId: string; newType: 'code' | 'markdown' | 'raw' };

export function broadcastCellOp(op: CellOp) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send('evt:cellop:' + JSON.stringify(op));
}

let ydoc: Y.Doc | null = null;
let awareness: awarenessProtocol.Awareness | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let syncResolve: (() => void) | null = null;
let syncPromise: Promise<void> | null = null;
let updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
let awarenessHandler: ((changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void) | null = null;
let cursorStyleEl: HTMLStyleElement | null = null;
let syncing = false;
const bindings = new Map<string, MonacoBinding>();

// ── helpers ──

function sendAwareness(bytes: Uint8Array) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send('aw:' + btoa(String.fromCharCode(...bytes)));
}

function decodeAwareness(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── presence listeners ──

type PresenceListener = (users: { name: string; color: string }[]) => void;
const presenceListeners = new Set<PresenceListener>();
export function onPresenceChange(fn: PresenceListener) { presenceListeners.add(fn); return () => presenceListeners.delete(fn); }

function notifyPresence() {
  if (!awareness) return;
  const users: { name: string; color: string }[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness!.clientID) return;
    if (state.user) users.push(state.user as { name: string; color: string });
  });
  for (const fn of presenceListeners) fn(users);
}

// ── dynamic cursor CSS ──

function updateCursorStyles() {
  if (!awareness) return;

  if (!cursorStyleEl) {
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.id = 'yjs-cursor-styles';
    document.head.appendChild(cursorStyleEl);
  }

  let css = '';
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness!.clientID) return;
    const user = state.user as { name: string; color: string } | undefined;
    if (!user) return;

    const c = user.color;
    const name = user.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    css += `
.yRemoteSelection-${clientId} {
  background-color: ${c}30;
}
.yRemoteSelectionHead-${clientId} {
  position: absolute;
  border-left: 2px solid ${c};
  height: 100%;
}
.yRemoteSelectionHead-${clientId}::after {
  content: '${name}';
  position: absolute;
  top: -1.1em;
  left: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 2px 6px;
  border-radius: 5px;
  color: #fff;
  background: ${c};
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
  line-height: 1;
  font-family: var(--font-sans);
  opacity: 0.9;
  box-shadow: 0 1px 4px ${c}40;
  animation: cursor-label-in 0.15s ease-out;
}
@keyframes cursor-label-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 0.9; transform: translateY(0); }
}
`;
  });

  cursorStyleEl.textContent = css;
}

// ── init / cleanup ──

export function initCollaboration(notebookPath: string, userName: string) {
  cleanup();

  ydoc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(ydoc);

  const colorIdx = Math.abs(hashStr(userName)) % CURSOR_COLORS.length;
  awareness.setLocalStateField('user', { name: userName, color: CURSOR_COLORS[colorIdx] });

  awareness.on('change', () => { notifyPresence(); updateCursorStyles(); });

  syncPromise = new Promise(resolve => { syncResolve = resolve; });

  const timeout = setTimeout(() => {
    if (syncResolve) finishSync();
  }, 3000);

  connectWs(notebookPath, timeout);
  window.addEventListener('beforeunload', beforeUnloadHandler);
  return ydoc;
}

function beforeUnloadHandler() {
  if (awareness && ws?.readyState === WebSocket.OPEN) {
    sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]));
    awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], null);
  }
}

export function broadcastSaved() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send('evt:saved');
}

// ── sync protocol ──

function finishSync() {
  syncing = false;
  if (!ydoc) return;

  // doc updates → WS — only LOCAL changes (origin !== 'remote')
  if (!updateHandler) {
    updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;   // don't echo received updates
      if (syncing) return;
      if (ws?.readyState === WebSocket.OPEN) ws.send(update as unknown as Blob);
    };
    ydoc.on('update', updateHandler);
  }

  // awareness → WS
  if (awareness && !awarenessHandler) {
    awarenessHandler = ({ added, updated, removed }) => {
      if (!awareness) return;
      const changed = added.concat(updated).concat(removed);
      if (changed.length === 0) return;
      sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    };
    awareness.on('update', awarenessHandler);
  }

  // populate Y.Text if we're the first user
  const cells = useNotebookStore.getState().cells;
  let hasRemoteContent = false;
  for (const cell of cells) {
    if (ydoc.getText(`cell-${cell.id}`).length > 0) {
      hasRemoteContent = true;
      break;
    }
  }

  if (!hasRemoteContent) {
    ydoc.transact(() => {
      for (const cell of cells) {
        const ytext = ydoc!.getText(`cell-${cell.id}`);
        if (ytext.length === 0 && cell.source) {
          ytext.insert(0, cell.source);
        }
      }
    });
  }

  if (syncResolve) { syncResolve(); syncResolve = null; }
}

// ── WebSocket ──

function connectWs(docId: string, syncTimeout?: ReturnType<typeof setTimeout>) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/api/collab?doc=${encodeURIComponent(docId)}`;

  syncing = true;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    // tell server our Yjs clientID so it can announce our departure
    if (ydoc) ws!.send(`id:${ydoc.clientID}`);
    // send initial awareness as text
    if (awareness) {
      sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]));
    }
  };

  ws.onmessage = (ev) => {
    if (!ydoc) return;

    if (typeof ev.data === 'string') {
      const text = ev.data as string;
      if (text === 'sync_done') {
        if (syncTimeout) clearTimeout(syncTimeout);
        finishSync();
      } else if (text.startsWith('aw:')) {
        if (awareness) {
          awarenessProtocol.applyAwarenessUpdate(awareness, decodeAwareness(text.slice(3)), null);
        }
      } else if (text.startsWith('left:')) {
        // server says a client disconnected — remove their awareness
        const removedId = parseInt(text.slice(5));
        if (awareness && !isNaN(removedId)) {
          awarenessProtocol.removeAwarenessStates(awareness, [removedId], null);
        }
      } else if (text.startsWith('evt:cellop:')) {
        try {
          const op = JSON.parse(text.slice(11)) as CellOp;
          applyRemoteCellOp(op);
        } catch { /* ignored */ }
      } else if (text === 'evt:saved') {
        useNotebookStore.setState({ dirty: false });
      }
      return;
    }

    // binary = Yjs doc update — mark as remote so we don't echo it back
    const data = new Uint8Array(ev.data as ArrayBuffer);
    try { Y.applyUpdate(ydoc, data, REMOTE); } catch { /* ignored */ }
  };

  ws.onclose = () => {
    reconnectTimer = setTimeout(() => connectWs(docId), 2000);
  };
}

// ── remote cell ops ──

function applyRemoteCellOp(op: CellOp) {
  const store = useNotebookStore.getState();
  switch (op.type) {
    case 'add':
      if (['code', 'markdown', 'raw'].includes(op.cellType)) {
        store.addCell(op.cellType as CellType, op.index, op.cellId);
      }
      break;
    case 'delete':
      store.deleteCell(op.cellId);
      unbindEditor(op.cellId);
      clearCellText(op.cellId);
      break;
    case 'move':
      store.moveCell(op.cellId, op.dir);
      break;
    case 'reorder':
      store.reorderCell(op.fromIdx, op.toIdx);
      break;
    case 'clear_outputs':
      if (op.cellId) {
        store.clearOutputs(op.cellId);
      } else {
        for (const cell of store.cells) {
          if (cell.cell_type === 'code') store.clearOutputs(cell.id);
        }
      }
      break;
    case 'set_status':
      store.setCellStatus(op.cellId, op.status as CellStatus);
      break;
    case 'change_type':
      store.changeCellType(op.cellId, op.newType);
      break;
  }
}

// ── editor binding ──

export async function bindEditor(cellId: string, ed: editor.IStandaloneCodeEditor) {
  if (!ydoc) return;
  if (syncPromise) await syncPromise;

  unbindEditor(cellId);

  const ytext = ydoc.getText(`cell-${cellId}`);
  const model = ed.getModel();
  if (!model) return;

  // Only seed Y.Text from the local model if:
  // 1. Y.Text is empty (no remote content yet)
  // 2. We are the only client (no one else has content to sync)
  // This prevents duplication when a second user joins and their local
  // model matches the remote Y.Text that hasn't synced yet.
  const otherClients = awareness ? awareness.getStates().size - 1 : 0;
  if (ytext.length === 0 && model.getValue().length > 0 && otherClients === 0) {
    ytext.insert(0, model.getValue());
  } else if (ytext.length > 0 && model.getValue() !== ytext.toString()) {
    // Remote Y.Text has content that differs from local — trust remote
    model.setValue(ytext.toString());
  }

  const binding = new MonacoBinding(ytext, model, new Set([ed]), awareness ?? undefined);
  bindings.set(cellId, binding);
}

export function unbindEditor(cellId: string) {
  try { bindings.get(cellId)?.destroy(); } catch { /* y-monaco may warn if observer wasn't registered yet */ }
  bindings.delete(cellId);
}

/** Clear the Y.Text for a deleted cell so its stale content doesn't linger in the ydoc. */
export function clearCellText(cellId: string) {
  if (!ydoc) return;
  const ytext = ydoc.getText(`cell-${cellId}`);
  if (ytext.length > 0) ytext.delete(0, ytext.length);
}

export function cleanup() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (awareness && ws?.readyState === WebSocket.OPEN) {
    sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]));
    awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], null);
  }

  for (const [, b] of bindings) {
    try { b.destroy(); } catch { /* y-monaco may throw if observer wasn't registered yet */ }
  }
  bindings.clear();

  if (ydoc && updateHandler) { ydoc.off('update', updateHandler); updateHandler = null; }
  if (awareness && awarenessHandler) { awareness.off('update', awarenessHandler); awarenessHandler = null; }

  awareness?.destroy(); awareness = null;
  // close WS silently — it might be in CONNECTING state, which logs a
  // harmless "WebSocket is closed before the connection is established"
  // warning in devtools. Suppress by removing all event handlers first.
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  if (ydoc) { ydoc.destroy(); ydoc = null; }
  syncResolve = null;
  syncPromise = null;
  syncing = false;

  if (cursorStyleEl) { cursorStyleEl.remove(); cursorStyleEl = null; }
  window.removeEventListener('beforeunload', beforeUnloadHandler);
}

export function isActive() { return ydoc !== null; }

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
