import { useTranslation } from 'react-i18next';
import { FFModalShell } from './modals/FFModalShell';

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function SaveModal({ onSave, onDiscard, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <FFModalShell
      title={t('save.unsavedChanges')}
      subtitle={t('save.saveBeforeLeaving')}
      width={460}
      hideFooter
      onClose={onCancel}
    >
      <div className="flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onDiscard}
          style={{
            padding: '8px 14px',
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 6,
            color: '#fca5a5',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          {t('save.dontSave')}
        </button>
        <button
          onClick={onSave}
          style={{
            padding: '8px 14px',
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: 6,
            color: 'var(--color-accent-fg)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {t('common.save')}
        </button>
      </div>
    </FFModalShell>
  );
}
