import { useCallback, useEffect, useState } from 'preact/hooks';

/**
 * Tracks an element's rendered width via a callback ref + ResizeObserver.
 * Safe across conditional mounts/remounts (e.g. Session <-> Global chart switches)
 * because the observer automatically re-attaches whenever the DOM node changes.
 */
export function useElementWidth(initialWidth = 360, minWidth = 0): [number, (node: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>(initialWidth);

  const ref = useCallback((node: HTMLElement | null) => {
    setEl(node);
  }, []);

  useEffect(() => {
    if (!el) return;
    const apply = (raw: number) => {
      const rounded = Math.round(raw);
      if (rounded > 0) {
        const next = minWidth > 0 ? Math.max(minWidth, rounded) : rounded;
        setWidth((prev) => (prev === next ? prev : next));
      }
    };
    apply(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? el.clientWidth;
      apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, minWidth]);

  return [width, ref];
}
