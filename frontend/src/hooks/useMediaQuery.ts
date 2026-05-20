import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Returns the current `matches` value and
 * re-renders when it flips. SSR-safe (returns false until the effect runs).
 *
 * Typical use: `const isMobile = useMediaQuery('(max-width: 767px)')` to
 * pick a different layout on narrow viewports.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}
