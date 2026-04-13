import { Save, LogOut } from 'lucide-react';

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function SaveModal({ onSave, onDiscard, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel w-[380px] p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-text mb-2">Unsaved changes</h3>
        <p className="text-sm text-text-muted mb-5">
          Do you want to save your changes before leaving?
        </p>
        <div className="flex gap-2">
          <button onClick={onSave} className="btn btn-md btn-primary flex-1">
            <Save size={14} />
            Save
          </button>
          <button onClick={onDiscard} className="btn btn-md btn-danger flex-1">
            <LogOut size={14} />
            Don't save
          </button>
          <button onClick={onCancel} className="btn btn-md btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
