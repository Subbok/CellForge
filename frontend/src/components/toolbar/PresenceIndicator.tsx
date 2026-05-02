import { useEffect, useState } from 'react';
import { onPresenceChange } from '../../services/collaboration';

/**
 * Stacked avatar circles for collaborators currently editing the notebook.
 * Each circle is initial-only, coloured by the user's collab colour, and
 * overlaps the next by 6px to read as a connected group — same pattern as
 * the JSX FFNotebook header. Hovering reveals the username via the title
 * attribute (no separate tooltip needed for an at-a-glance presence chip).
 */
export function PresenceIndicator() {
  const [users, setUsers] = useState<{ name: string; color: string }[]>([]);

  useEffect(() => {
    const unsub = onPresenceChange(setUsers);
    return () => { unsub(); };
  }, []);

  if (users.length === 0) return null;

  return (
    <div className="flex items-center" style={{ paddingRight: 6 }}>
      {users.map((u, i) => (
        <div
          key={`${u.name}:${i}`}
          title={u.name}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            background: u.color,
            color: '#1a1815',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600,
            marginLeft: i === 0 ? 0 : -6,
            // Border matches the header bg so overlapping circles read as
            // discrete chips rather than a smear.
            border: '2px solid var(--color-bg)',
            cursor: 'default',
          }}
        >
          {(u.name[0] ?? '?').toUpperCase()}
        </div>
      ))}
    </div>
  );
}
