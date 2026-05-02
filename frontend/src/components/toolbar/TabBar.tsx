import { useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { useTabStore } from '../../stores/tabStore';
import { useNotebookStore } from '../../stores/notebookStore';
import { removeTabSnapshot, switchToTab } from '../../services/tabManager';

/**
 * Forge tab strip — pill-style tabs with notebook icon, name, dirty dot or
 * close X. Tabs are draggable for reordering; the strip scrolls horizontally
 * when there are too many to fit. Used inline in the notebook header (left
 * side) when 2+ notebooks are open, replacing the breadcrumb.
 */
export function TabStrip({ username }: { username: string }) {
  const { tabs, activeTabId, closeTab, reorderTabs } = useTabStore();
  const dirty = useNotebookStore(s => s.dirty);
  const filePath = useNotebookStore(s => s.filePath);
  const [dragId, setDragId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // HTML5 drag suppresses the trailing `click` event on Chromium-class
  // engines when even a tiny mouse movement happens between mousedown and
  // mouseup, which leaves the user with non-clickable tabs. Track whether
  // an actual drag fired and only fall back to click switching when it did
  // not, using a ref so the flag survives across React's batched renders.
  const draggedRef = useRef(false);

  if (tabs.length <= 1) return null;

  function switchTo(id: string) {
    if (id === activeTabId) return;
    switchToTab(id, username);
  }

  function close(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    removeTabSnapshot(id);
    closeTab(id);
    const newActive = useTabStore.getState().activeTabId;
    if (newActive) switchToTab(newActive, username);
  }

  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id);
    draggedRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox needs some text to start dragging; the value is ignored.
    e.dataTransfer.setData('text/plain', id);
  }

  function onDragOver(e: React.DragEvent, overId: string) {
    if (!dragId || dragId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(e: React.DragEvent, overId: string) {
    e.preventDefault();
    if (!dragId || dragId === overId) { setDragId(null); return; }
    reorderTabs(dragId, overId);
    setDragId(null);
  }

  function onMouseDownTab() {
    // Reset the drag flag at the start of every interaction so a previous
    // drag doesn't swallow the next click.
    draggedRef.current = false;
  }

  function onMouseUpTab(id: string) {
    if (draggedRef.current) return; // a drag fired — don't switch
    switchTo(id);
  }

  return (
    <div
      ref={stripRef}
      className="flex items-center h-full w-full overflow-x-auto"
      style={{
        padding: '0 12px',
        gap: 2,
        scrollbarWidth: 'none',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isDirty = dirty && isActive && tab.path === filePath;
        const isDragging = dragId === tab.id;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={e => onDragStart(e, tab.id)}
            onDragOver={e => onDragOver(e, tab.id)}
            onDrop={e => onDrop(e, tab.id)}
            onDragEnd={() => setDragId(null)}
            onMouseDown={onMouseDownTab}
            onMouseUp={() => onMouseUpTab(tab.id)}
            onAuxClick={e => {
              // middle-click closes the tab
              if (e.button === 1) close(e, tab.id);
            }}
            title={tab.path}
            className="group flex items-center cursor-pointer transition-colors"
            style={{
              flexShrink: 0,
              gap: 6,
              padding: '5px 8px 5px 10px',
              borderRadius: 6,
              fontSize: 12,
              opacity: isDragging ? 0.5 : 1,
              background: isActive ? 'var(--color-bg-elevated)' : 'transparent',
              color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
              border: isActive
                ? '1px solid var(--color-border)'
                : '1px solid transparent',
            }}
          >
            <FileText size={12} className={isActive ? 'text-accent' : 'text-text-muted'} />
            <span className="truncate" style={{ maxWidth: 180 }}>{tab.name}</span>
            {isDirty ? (
              <span
                title="Unsaved changes"
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--color-accent)', flexShrink: 0,
                }}
              />
            ) : (
              <button
                onClick={e => close(e, tab.id)}
                className="hover:text-error hover:bg-bg-hover transition-colors"
                style={{
                  width: 16, height: 16, borderRadius: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'inherit', opacity: isActive ? 1 : 0.6,
                  flexShrink: 0,
                }}
                title="Close tab (middle-click)"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
