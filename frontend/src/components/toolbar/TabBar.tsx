import { useTabStore } from '../../stores/tabStore';
import { useNotebookStore } from '../../stores/notebookStore';
import { removeTabSnapshot, switchToTab } from '../../services/tabManager';
import { X } from 'lucide-react';

export function TabBar({ username }: { username: string }) {
  const { tabs, activeTabId, closeTab } = useTabStore();
  const dirty = useNotebookStore(s => s.dirty);
  const filePath = useNotebookStore(s => s.filePath);

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
    if (newActive) {
      // Reuse switchToTab semantics so the remaining tab fully re-activates
      // (snapshot restore + ws reconnect + collab re-init).
      switchToTab(newActive, username);
    }
  }

  return (
    <div className="flex items-center bg-bg border-b border-border/40 overflow-x-auto shrink-0 px-1 gap-0.5 py-0.5">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => switchTo(tab.id)}
          className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-md text-xs cursor-pointer transition-colors ${
            tab.id === activeTabId
              ? 'bg-bg-elevated text-text'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <span className="truncate max-w-40">{tab.name}</span>
          {/* dirty dot — active tab's file has unsaved changes */}
          {dirty && tab.id === activeTabId && tab.path === filePath ? (
            <span className="w-2 h-2 rounded-full bg-accent shrink-0" title="Unsaved changes" />
          ) : (
            <button onClick={e => close(e, tab.id)}
              className="p-0.5 rounded hover:bg-bg-hover hover:text-error transition-colors">
              <X size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
