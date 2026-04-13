import { useState, useEffect } from 'react';
import { useNotebookStore } from '../stores/notebookStore';
import { broadcastCellOp, isActive as isCollabActive } from '../services/collaboration';

interface DragState {
  dragging: boolean;
  fromIdx: number;
  dropIdx: number | null;
  mouseY: number;
  ghostLabel: string;
}

const initial: DragState = {
  dragging: false, fromIdx: -1, dropIdx: null, mouseY: 0, ghostLabel: '',
};

// shared state so Notebook and CellContainers can coordinate
let _state = initial;
let _listeners: (() => void)[] = [];
function notify() { _listeners.forEach(fn => fn()); }

export function useDragState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }, []);
  return _state;
}

export function startDrag(fromIdx: number, label: string, startY: number) {
  _state = { dragging: true, fromIdx, dropIdx: null, mouseY: startY, ghostLabel: label };
  notify();

  function onMove(e: MouseEvent) {
    _state = { ..._state, mouseY: e.clientY };

    // figure out which cell we're over
    const cells = document.querySelectorAll('[data-cell-idx]');
    let best: number | null = null;
    let bestDist = Infinity;

    cells.forEach(el => {
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = parseInt((el as HTMLElement).dataset.cellIdx ?? '-1');
        // if mouse is below midpoint, insert after
        if (e.clientY > mid) best++;
      }
    });

    _state = { ..._state, dropIdx: best };
    notify();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (_state.dropIdx !== null && _state.dropIdx !== _state.fromIdx && _state.dropIdx !== _state.fromIdx + 1) {
      const to = _state.dropIdx > _state.fromIdx ? _state.dropIdx - 1 : _state.dropIdx;
      useNotebookStore.getState().reorderCell(_state.fromIdx, to);
      if (isCollabActive()) broadcastCellOp({ type: 'reorder', fromIdx: _state.fromIdx, toIdx: to });
    }

    _state = initial;
    notify();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
}
