import { useTranslation } from 'react-i18next';
import { Save, LogOut } from 'lucide-react';

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function SaveModal({ onSave, onDiscard, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel w-[380px] p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-text mb-2">{t('save.unsavedChanges')}</h3>
        <p className="text-sm text-text-muted mb-5">
          {t('save.saveBeforeLeaving')}
        </p>
        <div className="flex gap-2">
          <button onClick={onSave} className="btn btn-md btn-primary flex-1">
            <Save size={14} />
            {t('common.save')}
          </button>
          <button onClick={onDiscard} className="btn btn-md btn-danger flex-1">
            <LogOut size={14} />
            {t('save.dontSave')}
          </button>
          <button onClick={onCancel} className="btn btn-md btn-ghost">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
