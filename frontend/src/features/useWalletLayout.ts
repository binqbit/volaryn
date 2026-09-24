import { useLayoutEffect, useRef } from 'react';

/** Keep balances inside the viewport without assuming a fixed header or notice height. */
export function useWalletLayout(enabled: boolean) {
  const panel = useRef<HTMLElement>(null);
  const pinned = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const header = pinned.current;
    if (!enabled || !element || !header) return;
    let frame = 0;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const inset = headerBounds.top - bounds.top;
      const available = Math.floor(window.innerHeight - Math.max(24, bounds.top) - 24);
      // A short viewport or many USDC accounts must not squeeze holdings out of reach.
      const bounded = window.innerWidth > 800 && available >= headerBounds.height + inset * 2 + 160;
      element.dataset.bounded = String(bounded);
      element.style.maxHeight = bounded ? `${available}px` : '';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    observer.observe(document.body);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      delete element.dataset.bounded;
      element.style.maxHeight = '';
    };
  }, [enabled]);
  return { panel, pinned };
}
