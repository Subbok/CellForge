import { useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from '../services/api';
import { FFModalShell } from './modals/FFModalShell';

/** Avatar palette cycled by row index — same as the Admin members table. */
const AVATAR_PALETTE = ['#ffaa3b', '#7ec4cf', '#b39ddb', '#a6c780', '#e8a87c', '#cba6f7'];

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
  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const sharedWithSet = new Set(outboundShares.map(s => s.to_user));
  const pickerUsers = shareUsers.filter(u => !sharedWithSet.has(u.username));
  const folder = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';

  return (
    <FFModalShell
      title="Share notebook"
      subtitle={folder ? `${fileName} · ${folder}/` : fileName}
      width={520}
      hideFooter
      onClose={onClose}
    >
      {outboundShares.length > 0 && (
        <>
          <div className="uppercase" style={{
            fontSize: 11, color: 'var(--color-text-secondary)',
            marginBottom: 8, letterSpacing: '0.04em', fontWeight: 500,
          }}>Members with access</div>
          <div className="overflow-hidden" style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 7,
            marginBottom: 14,
          }}>
            {outboundShares.map((s, i) => (
              <div key={s.id} className="flex items-center" style={{
                gap: 10, padding: '10px 12px',
                borderTop: i ? '1px solid var(--color-border-subtle)' : 'none',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: AVATAR_PALETTE[i % AVATAR_PALETTE.length],
                  color: '#1a1815',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600,
                }}>
                  {s.to_user[0].toUpperCase()}
                </div>
                <span className="font-mono flex-1" style={{ fontSize: 13, color: 'var(--color-text)' }}>
                  @{s.to_user}
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Can edit</span>
                <button
                  onClick={async () => {
                    try {
                      await api.unshareFile(s.id);
                      await onRefresh();
                    } catch (e: unknown) {
                      onError(`Unshare failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                  className="text-text-muted hover:text-error"
                  style={{
                    width: 20, height: 20, borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                  }}
                  title="Remove share"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="uppercase" style={{
        fontSize: 11, color: 'var(--color-text-secondary)',
        marginBottom: 8, letterSpacing: '0.04em', fontWeight: 500,
      }}>Add members</div>
      {pickerUsers.length === 0 ? (
        <p className="text-center" style={{
          padding: '20px 0', fontSize: 12, color: 'var(--color-text-muted)',
        }}>
          {shareUsers.length === 0
            ? 'No other users in the workspace.'
            : 'Already shared with every other user.'}
        </p>
      ) : (
        <div className="overflow-hidden" style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 7,
        }}>
          {pickerUsers.map((u, i) => (
            <button
              key={u.username}
              onClick={async () => {
                try {
                  await api.shareFile(filePath, u.username);
                  await onRefresh();
                } catch (e: unknown) {
                  onError(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="w-full text-left flex items-center hover:bg-bg-hover transition-colors"
              style={{
                gap: 10, padding: '10px 12px',
                borderTop: i ? '1px solid var(--color-border-subtle)' : 'none',
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: AVATAR_PALETTE[(outboundShares.length + i) % AVATAR_PALETTE.length],
                color: '#1a1815',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
              }}>
                {u.username[0].toUpperCase()}
              </div>
              <span className="font-mono flex-1" style={{ fontSize: 13, color: 'var(--color-text)' }}>
                @{u.username}
              </span>
              {u.display_name && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {u.display_name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </FFModalShell>
  );
}
