import { useEffect, useState } from 'react';

/** Hide only while reading downwards; keyboard focus always reveals navigation. */
export function useScrollNavigation(section: string) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    let anchor = window.scrollY;
    const scroll = () => {
      const y = Math.max(0, window.scrollY);
      if (y < 80) setHidden(false);
      else if (Math.abs(y - anchor) > 12) setHidden(y > anchor);
      if (Math.abs(y - anchor) > 12 || y < 80) anchor = y;
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, [section]);
  return hidden;
}
