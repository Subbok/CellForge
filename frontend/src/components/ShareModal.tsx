import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api } from '../services/api';

/**
 * Share dialog. Loads the current outbound shares for the target file on
 * open so the user can see who they've already shared with and revoke any
 * of them inline (no round-trip to the recipient's "shared with me" list).
 */
export function ShareModal({
  fileName,
  filePath,
  shareUsers,
  outboundShares,
  onClose,
  onError,
  onRefresh,
}: {
  fileName: string;
  filePath: string;
  shareUsers: { username: string; display_name: string }[];
  outboundShares: { id: number; to_user: string }[];
  onClose: () => void;
  onError: (s: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const sharedWithSet = new Set(outboundShares.map(s => s.to_user));
  const pickerUsers = shareUsers.filter(u => !sharedWithSet.has(u.username));

  // Render in a portal anchored to <body>. Headers in TopBar and Dashboard
  // use `backdrop-blur`, which establishes a containing block for `fixed`
  // descendants — without the portal, `modal-backdrop`'s `fixed inset-0`
  // would anchor to the header (h-11) and the modal would stick to the top
  // of the screen.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel w-[360px] p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-text mb-2">Share file</h3>
        <p className="text-xs text-text-muted mb-4">
          <strong className="text-text">{fileName}</strong>
        </p>

        {outboundShares.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Currently shared with
            </p>
            <div className="space-y-1">
              {outboundShares.map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary/50">
                  <span className="text-sm text-text flex-1">@{s.to_user}</span>
                  <button
                    onClick={async () => {
                      try {
                        await api.unshareFile(s.id);
                        await onRefresh();
                      } catch (e: unknown) {
                        onError(`Unshare failed: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="p-1 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                    title="Remove share"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          Share with user
        </p>
        {pickerUsers.length === 0 ? (
          <p className="text-xs text-text-muted py-4 text-center">
            {shareUsers.length === 0 ? 'No other users' : 'Shared with everyone else already'}
          </p>
        ) : (
          <div className="space-y-1 mb-4">
            {pickerUsers.map(u => (
              <button key={u.username} onClick={async () => {
                try {
                  await api.shareFile(filePath, u.username);
                  await onRefresh();
                } catch (e: unknown) {
                  onError(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-hover text-sm text-text transition-colors">
                {u.display_name || u.username} <span className="text-text-muted">@{u.username}</span>
              </button>
            ))}
          </div>
        )}

        <button onClick={onClose} className="btn btn-md btn-ghost w-full">
          {t('common.cancel')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
