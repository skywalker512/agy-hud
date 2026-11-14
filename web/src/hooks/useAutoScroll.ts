import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

export function useAutoScroll<T extends HTMLElement>(enabled: boolean, depKey: string | number) {
  const ref = useRef<T>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = el.scrollHeight <= el.clientHeight + 4 || gap <= 32;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [enabled]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [enabled, depKey]);

  return ref;
}
