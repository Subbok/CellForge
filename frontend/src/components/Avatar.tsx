import { useEffect, useState } from 'react';

/**
 * Profile picture renderer with initial-letter fallback.
 *
 * Tries `GET /api/users/{username}/avatar`; on 404 (no upload, no Gravatar
 * match) it shows a coloured pill with the username's first letter. The
 * background hue is hashed from the username so the same user gets the
 * same colour everywhere — handy when scanning a list.
 */
export function Avatar({
  username,
  displayName,
  size = 28,
  className,
  style,
}: {
  username: string;
  /** Optional display name — only used to pick the initial letter when set;
   *  falls back to the first character of `username`. */
  displayName?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const [bump, setBump] = useState(0);

  // Reset when the user changes — otherwise switching accounts in the
  // top-right menu would keep showing the previous user's failure state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
  }, [username]);

  // Re-fetch when an avatar gets uploaded or removed for this user. The
  // URL itself doesn't change, so without a cache-busting query param the
  // browser would happily serve the stale image. `bumpAvatar(username)`
  // (exported below) fires the event from the Settings save handler.
  useEffect(() => {
    function onChange(e: Event) {
      const target = (e as CustomEvent<{ username: string }>).detail?.username;
      if (target === username) setBump(b => b + 1);
    }
    window.addEventListener('cellforge-avatar-changed', onChange as EventListener);
    return () => window.removeEventListener('cellforge-avatar-changed', onChange as EventListener);
  }, [username]);

  const url = `/api/users/${encodeURIComponent(username)}/avatar${bump ? `?v=${bump}` : ''}`;
  const letter = (displayName ?? username ?? '?').trim().charAt(0).toUpperCase() || '?';
  const hue = hashHue(username);

  const sharedStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...style,
  };

  if (failed) {
    return (
      <span
        className={className}
        style={{
          ...sharedStyle,
          background: `hsl(${hue}deg 35% 28%)`,
          color: '#fff',
          fontSize: Math.max(10, Math.round(size * 0.42)),
          fontWeight: 600,
          fontFamily: 'inherit',
          letterSpacing: 0,
        }}
      >
        {letter}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={displayName ?? username}
      width={size}
      height={size}
      className={className}
      style={{
        ...sharedStyle,
        objectFit: 'cover',
        background: `hsl(${hue}deg 35% 28%)`,
      }}
      onError={() => setFailed(true)}
      // Re-fetch when /api/users/me/avatar PUT lands — the URL is the same
      // so the browser would otherwise serve the stale cached version. We
      // bump a query param via the `useAvatarBump` hook elsewhere when the
      // user uploads or removes their image.
    />
  );
}

/** Notify all `<Avatar username={X}>` instances that the image for `X`
 *  has changed (uploaded / removed / email changed) and they should bust
 *  the browser cache. Call this after any successful avatar/email PUT. */
// eslint-disable-next-line react-refresh/only-export-components
export function bumpAvatar(username: string) {
  window.dispatchEvent(
    new CustomEvent('cellforge-avatar-changed', { detail: { username } }),
  );
}

/** Stable hue derivation: tiny djb2-ish hash over the username's bytes,
 *  mod 360. Anything more sophisticated isn't worth the bytes — we only
 *  need consistency between two views of the same name. */
function hashHue(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}
