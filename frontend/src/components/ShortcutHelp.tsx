import { X } from 'lucide-react';

const SHORTCUTS = [
  { section: 'Execution', items: [
    { keys: 'Shift+Enter', desc: 'Run cell and advance' },
    { keys: 'Ctrl+Enter', desc: 'Run cell, stay' },
    { keys: 'Alt+Enter', desc: 'Run cell, insert below' },
  ]},
  { section: 'Navigation (command mode)', items: [
    { keys: '↑ / k', desc: 'Previous cell' },
    { keys: '↓ / j', desc: 'Next cell' },
    { keys: 'Enter', desc: 'Edit mode (focus editor)' },
    { keys: 'Escape', desc: 'Command mode (blur editor)' },
  ]},
  { section: 'Cell operations (command mode)', items: [
    { keys: 'a', desc: 'Insert cell above' },
    { keys: 'b', desc: 'Insert cell below' },
    { keys: 'd d', desc: 'Delete cell (double tap)' },
    { keys: 'm', desc: 'Change to Markdown' },
    { keys: 'y', desc: 'Change to Code' },
  ]},
  { section: 'File', items: [
    { keys: 'Ctrl+S', desc: 'Save notebook' },
    { keys: 'Ctrl+F', desc: 'Find / Replace' },
    { keys: 'Ctrl+Z', desc: 'Undo (outside editor)' },
    { keys: 'Ctrl+Y', desc: 'Redo (outside editor)' },
  ]},
  { section: 'Formatting', items: [
    { keys: 'Ctrl+Shift+I', desc: 'Format code (in editor)' },
  ]},
];

interface Props {
  onClose: () => void;
}

export function ShortcutHelp({ onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel w-[560px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-text">Keyboard shortcuts</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 overflow-y-auto flex-1 space-y-5">
          {SHORTCUTS.map(section => (
            <div key={section.section}>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {section.section}
              </h3>
              <div className="space-y-1">
                {section.items.map(item => (
                  <div key={item.keys} className="flex items-center justify-between py-1">
                    <span className="text-sm text-text">{item.desc}</span>
                    <div className="flex gap-1">
                      {item.keys.split('+').map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-text-muted mx-0.5">+</span>}
                          <kbd className="px-1.5 py-0.5 text-xs font-mono bg-bg-elevated border border-border rounded text-text-secondary">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-border text-xs text-text-muted shrink-0">
          Press <kbd className="px-1 py-0.5 bg-bg-elevated border border-border rounded font-mono">?</kbd> to toggle this overlay
        </div>
      </div>
    </div>
  );
}
