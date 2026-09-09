import { useEffect, useState } from 'react';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Returns a vertical offset (px) driven by scroll position, scaled by `speed` --
// pass different speeds to layered elements (a tree-line silhouette, a sun disc, a
// cloud layer) so they drift at different rates for a real parallax effect. Frozen
// at 0 when the user has asked for reduced motion, per the design brief.
export function useParallax(speed: number) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setOffset(window.scrollY * speed);
        ticking = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [speed]);

  return offset;
}
