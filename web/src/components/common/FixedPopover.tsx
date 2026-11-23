import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface FixedPopoverProps {
  open: boolean;
  triggerRef: RefObject<HTMLElement>;
  onClose: () => void;
  align?: 'left' | 'right';
  role?: 'menu' | 'listbox';
  id?: string;
  ariaLabel?: string;
  className?: string;
  maxWidthPx?: number;
  minWidthPx?: number;
  children: ComponentChildren;
}

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 5;

export function FixedPopover({
  open,
  triggerRef,
  onClose,
  align = 'right',
  role = 'menu',
  id,
  ariaLabel,
  className = '',
  maxWidthPx = 240,
  minWidthPx = 176,
  children,
}: FixedPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; ready: boolean }>({
    top: -9999,
    left: -9999,
    maxHeight: 260,
    ready: false,
  });

  useLayoutEffect(() => {
    if (!open) {
      setPos((p) => (p.ready ? { ...p, ready: false } : p));
      return;
    }

    const computePosition = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = trigger.getBoundingClientRect();

      // Measure actual popover size (clamped to viewport width - 16px)
      const availW = Math.max(120, vw - VIEWPORT_MARGIN * 2);
      const popRect = pop.getBoundingClientRect();
      const menuW = Math.min(availW, Math.max(popRect.width || minWidthPx, Math.min(minWidthPx, availW)));
      const menuH = popRect.height || 180;

      let left = align === 'right' ? rect.right - menuW : rect.left;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - menuW - VIEWPORT_MARGIN));

      const spaceBelow = vh - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - TRIGGER_GAP - VIEWPORT_MARGIN;

      let top: number;
      let maxHeight: number;
      if (spaceBelow >= Math.min(menuH, 160) || spaceBelow >= spaceAbove) {
        top = rect.bottom + TRIGGER_GAP;
        maxHeight = Math.max(120, Math.min(280, spaceBelow));
        if (top + Math.min(menuH, maxHeight) > vh - VIEWPORT_MARGIN) {
          top = Math.max(VIEWPORT_MARGIN, vh - Math.min(menuH, maxHeight) - VIEWPORT_MARGIN);
        }
      } else {
        maxHeight = Math.max(120, Math.min(280, spaceAbove));
        const usedH = Math.min(menuH, maxHeight);
        top = Math.max(VIEWPORT_MARGIN, rect.top - TRIGGER_GAP - usedH);
      }

      setPos({
        top: Math.round(top),
        left: Math.round(left),
        maxHeight: Math.round(maxHeight),
        ready: true,
      });
    };

    computePosition();
    const raf = requestAnimationFrame(computePosition);

    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        triggerRef.current?.focus();
      }
    };
    const onScrollOrResize = () => computePosition();

    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, triggerRef, align, minWidthPx, onClose]);

  if (!open) return null;

  const style: JSX.CSSProperties = {
    position: 'fixed',
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    minWidth: `${Math.min(minWidthPx, typeof window !== 'undefined' ? Math.max(120, window.innerWidth - 16) : minWidthPx)}px`,
    maxWidth: `min(${maxWidthPx}px, calc(100vw - 16px))`,
    maxHeight: `${pos.maxHeight}px`,
    visibility: pos.ready ? 'visible' : 'hidden',
  };

  return (
    <div
      ref={popRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      style={style}
      className={`more-popover fixed z-50 overflow-y-auto p-1 rounded-[9px] flex flex-col gap-[2px] ${className}`}
    >
      {children}
    </div>
  );
}
