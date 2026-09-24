import { useLayoutEffect, useRef } from 'react';

/** Fit the balance list between the wallet header and notes without fixed text heights. */
export function useWalletLayout(enabled: boolean) {
  const panel = useRef<HTMLElement>(null);
  const pinned = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const header = pinned.current;
    const notes = footer.current;
    if (!enabled || !element || !header || !notes) return;
    let frame = 0;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const footerHeight = notes.getBoundingClientRect().height;
      const inset = headerBounds.top - bounds.top;
      const available = Math.floor(window.innerHeight - Math.max(24, bounds.top) - 24);
      // A short viewport or many USDC accounts must not squeeze holdings out of reach.
      const bounded =
        window.innerWidth > 800 &&
        available >= headerBounds.height + footerHeight + inset * 2 + 160;
      element.dataset.bounded = String(bounded);
      element.style.maxHeight = bounded ? `${available}px` : '';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    observer.observe(notes);
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
  return { panel, pinned, footer };
}
