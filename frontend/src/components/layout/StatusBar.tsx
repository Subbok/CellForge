import { useTranslation } from 'react-i18next';
import { useKernelStore } from '../../stores/kernelStore';
import { useNotebookStore } from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';
import { executeCommand } from '../../plugins/registry';

export function StatusBar() {
  const { t } = useTranslation();
  const { status, spec } = useKernelStore();
  const meta = useNotebookStore(s => s.metadata);
  const pluginItems = useUIStore(s => s.pluginStatusBarItems);

  const lang = meta.language_info?.name ?? 'python';
  const ver = meta.language_info?.version;

  const leftItems = pluginItems.filter(i => i.position === 'left');
  const rightItems = pluginItems.filter(i => i.position !== 'left');

  return (
    <footer className="h-6 flex items-center px-4 border-t border-border/40 bg-bg text-[11px] text-text-muted gap-4 shrink-0">
      <span>{lang}{ver ? ` ${ver}` : ''}</span>
      <span>{spec ?? t('kernel.noKernel')}</span>
      <span>{status}</span>
      {leftItems.map(item => (
        <PluginStatusItem key={item.id} item={item} />
      ))}
      <div className="flex-1" />
      {rightItems.map(item => (
        <PluginStatusItem key={item.id} item={item} />
      ))}
      <span>{t('statusbar.utf8')}</span>
    </footer>
  );
}

function PluginStatusItem({ item }: { item: { id: string; label?: string; command?: string } }) {
  const inner = <span>{item.label ?? item.id}</span>;
  if (item.command) {
    return (
      <button
        onClick={() => executeCommand(item.command!)}
        className="hover:text-text-secondary transition-colors"
      >
        {inner}
      </button>
    );
  }
  return inner;
}
