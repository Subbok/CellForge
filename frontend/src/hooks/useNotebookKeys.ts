import { useEffect, useRef } from 'react';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { useExecuteCell } from './useKernel';
import { advanceToNextCell, focusActiveCell, focusActiveEditor } from '../components/notebook/CodeCell';
import { addCellSynced, deleteCellSynced } from '../services/notebookOps';
import { broadcastCellOp, isActive as isCollabActive } from '../services/collaboration';
import { executeCommand } from '../plugins/registry';

// jupyter-style keyboard shortcuts
// two modes: command (cell selected, not editing) and edit (typing in cell)
// Esc -> command mode, Enter -> edit mode

export function useNotebookKeys() {
  const execute = useExecuteCell();
  // command mode = not focused inside a monaco editor
  const commandMode = useRef(true);

  useEffect(() => {
    function isEditing(el: HTMLElement | null) {
      if (!el) return false;
      // inside monaco, or a textarea/input
      return !!el.closest('.monaco-editor') || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    }
    function onFocusIn(e: FocusEvent) {
      if (isEditing(e.target as HTMLElement)) commandMode.current = false;
    }
    function onFocusOut(e: FocusEvent) {
      if (!isEditing(e.relatedTarget as HTMLElement)) commandMode.current = true;
    }

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const store = useNotebookStore.getState();
      const { cells, activeCellId } = store;
      const idx = cells.findIndex(c => c.id === activeCellId);

      // --- plugin keybindings (checked first, can shadow built-ins) ---
      const pluginBindings = useUIStore.getState().pluginKeybindings;
      for (const binding of pluginBindings) {
        if (matchesKeyCombo(e, binding.key)) {
          if (binding.command_mode_only !== false && !commandMode.current) continue;
          e.preventDefault();
          executeCommand(binding.command, { cellId: activeCellId });
          return;
        }
      }

      // --- shortcuts that work in both modes ---

      // Shift+Enter in command mode: run (if code) and advance
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (!commandMode.current) return; // monaco/textarea handles its own
        e.preventDefault();
        if (idx < 0) return;
        const cell = cells[idx];
        if (cell.cell_type === 'code') {
          execute(cell.id, cell.source);
        }
        // just advance, don't create new cell — advanceToNextCell handles that
        advanceToNextCell(cell.id);
        return;
      }

      // Ctrl+Enter in command mode: run (if code), stay
      if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
        if (!commandMode.current) return;
        e.preventDefault();
        if (idx >= 0 && cells[idx].cell_type === 'code') {
          execute(cells[idx].id, cells[idx].source);
        }
        return;
      }

      // Alt+Enter: run + insert below
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        if (idx >= 0 && cells[idx].cell_type === 'code') {
          execute(cells[idx].id, cells[idx].source);
        }
        addCellSynced('code', idx + 1);
        setTimeout(focusActiveCell, 80);
        return;
      }

      // Ctrl+S: save (handled in AppLayout, but prevent default here too)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        return;
      }

      // --- command mode only ---
      if (!commandMode.current) return;

      switch (e.key) {
        case 'Enter':
          // enter edit mode — focus the monaco editor in active cell
          e.preventDefault();
          focusActiveEditor();
          break;

        case 'Escape':
          e.preventDefault();
          // blur monaco, go to command mode
          (document.activeElement as HTMLElement)?.blur();
          commandMode.current = true;
          break;

        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          if (idx > 0) store.setActiveCell(cells[idx - 1].id);
          break;

        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          if (idx < cells.length - 1) store.setActiveCell(cells[idx + 1].id);
          break;

        case 'a':
          e.preventDefault();
          addCellSynced('code', idx);
          break;

        case 'b':
          e.preventDefault();
          addCellSynced('code', idx + 1);
          break;

        case 'd':
          // dd to delete (double tap)
          if (lastKey.current === 'd' && Date.now() - lastKeyTime.current < 500) {
            e.preventDefault();
            if (cells[idx]?.id) deleteCellSynced(cells[idx].id);
            lastKey.current = '';
          } else {
            lastKey.current = 'd';
            lastKeyTime.current = Date.now();
          }
          break;

        case 'm':
          // change cell type to markdown
          e.preventDefault();
          if (idx >= 0) changeCellType(store, idx, 'markdown');
          break;

        case 'y':
          // change cell type to code
          e.preventDefault();
          if (idx >= 0) changeCellType(store, idx, 'code');
          break;

        default:
          lastKey.current = '';
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [execute]);

  const lastKey = useRef('');
  const lastKeyTime = useRef(0);

}

/**
 * Match a KeyboardEvent against a combo string like "ctrl+shift+m".
 * Supported modifiers: ctrl, shift, alt, meta. Key part is case-insensitive.
 */
function matchesKeyCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);

  if (mods.has('ctrl') !== (e.ctrlKey || e.metaKey)) return false;
  if (mods.has('shift') !== e.shiftKey) return false;
  if (mods.has('alt') !== e.altKey) return false;
  if (mods.has('meta') !== e.metaKey) return false;

  return e.key.toLowerCase() === key;
}

function changeCellType(
  store: ReturnType<typeof useNotebookStore.getState>,
  idx: number,
  newType: 'code' | 'markdown',
) {
  const cell = store.cells[idx];
  if (cell.cell_type === newType) return;
  // atomic type swap — preserves cell id so collab peers stay consistent,
  // keeps the source via Y.Text binding, only clears outputs
  store.changeCellType(cell.id, newType);
  if (isCollabActive()) {
    broadcastCellOp({ type: 'change_type', cellId: cell.id, newType });
  }
}
