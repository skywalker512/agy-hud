import { useCallback, useState } from 'preact/hooks';

const PREFIX = 'agy-hud:card:';

function readPersistedOpen(key: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
  } catch {
    /* ignore storage errors in restricted webviews */
  }
  return defaultOpen;
}

export function usePersistedOpen(key: string, defaultOpen: boolean): [boolean, () => void, (next: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => readPersistedOpen(key, defaultOpen));

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        localStorage.setItem(`${PREFIX}${key}`, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`${PREFIX}${key}`, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [key]);

  return [open, toggle, setOpen];
}
