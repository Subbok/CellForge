import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const SHORTCUTS = [
  { sectionKey: 'shortcuts.execution', items: [
    { keys: 'Shift+Enter', descKey: 'shortcuts.runCellAdvance' },
    { keys: 'Ctrl+Enter', descKey: 'shortcuts.runCellStay' },
    { keys: 'Alt+Enter', descKey: 'shortcuts.runCellInsert' },
  ]},
  { sectionKey: 'shortcuts.navigation', items: [
    { keys: '↑ / k', descKey: 'shortcuts.previousCell' },
    { keys: '↓ / j', descKey: 'shortcuts.nextCell' },
    { keys: 'Enter', descKey: 'shortcuts.editMode' },
    { keys: 'Escape', descKey: 'shortcuts.commandMode' },
  ]},
  { sectionKey: 'shortcuts.cellOps', items: [
    { keys: 'a', descKey: 'shortcuts.insertAbove' },
    { keys: 'b', descKey: 'shortcuts.insertBelow' },
    { keys: 'd d', descKey: 'shortcuts.deleteCell' },
    { keys: 'm', descKey: 'shortcuts.changeToMarkdown' },
    { keys: 'y', descKey: 'shortcuts.changeToCode' },
  ]},
  { sectionKey: 'shortcuts.file', items: [
    { keys: 'Ctrl+S', descKey: 'shortcuts.saveNotebook' },
    { keys: 'Ctrl+F', descKey: 'shortcuts.findReplace' },
    { keys: 'Ctrl+Z', descKey: 'shortcuts.undoOutside' },
    { keys: 'Ctrl+Y', descKey: 'shortcuts.redoOutside' },
  ]},
  { sectionKey: 'shortcuts.formatting', items: [
    { keys: 'Ctrl+Shift+I', descKey: 'shortcuts.formatCode' },
  ]},
];

interface Props {
  onClose: () => void;
}

export function ShortcutHelp({ onClose }: Props) {
  const { t } = useTranslation();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel w-[560px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold text-text">{t('shortcuts.title')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 overflow-y-auto flex-1 space-y-5">
          {SHORTCUTS.map(section => (
            <div key={section.sectionKey}>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {t(section.sectionKey)}
              </h3>
              <div className="space-y-1">
                {section.items.map(item => (
                  <div key={item.keys} className="flex items-center justify-between py-1">
                    <span className="text-sm text-text">{t(item.descKey)}</span>
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
          {t('shortcuts.pressToToggle')}
        </div>
      </div>
    </div>
  );
}
