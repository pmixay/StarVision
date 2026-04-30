import { useEffect, useState } from 'react';

// Tracks a CSS media query at runtime so components can branch on layout
// (e.g. mobile-vs-desktop panel placement). Updates on viewport changes
// and tolerates SSR / first-paint where `window` is briefly absent.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// Tailwind's default `sm` breakpoint is 640 px — anything below that is
// the phone-portrait / narrow tablet tier where the desktop side-panel
// layout doesn't fit and we collapse to bottom-sheet / icon-only modes.
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 639px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_BREAKPOINT_QUERY);
}
