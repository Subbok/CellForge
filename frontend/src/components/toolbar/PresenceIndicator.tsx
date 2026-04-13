import { useEffect, useState } from 'react';
import { onPresenceChange } from '../../services/collaboration';

export function PresenceIndicator() {
  const [users, setUsers] = useState<{ name: string; color: string }[]>([]);

  useEffect(() => {
    const unsub = onPresenceChange(setUsers);
    return () => { unsub(); };
  }, []);

  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {users.map((u, i) => (
        <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
          style={{ backgroundColor: u.color + '20', color: u.color }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: u.color }} />
          {u.name}
        </div>
      ))}
    </div>
  );
}
