import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { FixedPopover } from './FixedPopover';
import { IconCheck, IconChevronDown } from './Icons';

export interface SelectPopoverOption {
  value: string;
  label: string;
  sublabel?: string;
  dividerAfter?: boolean;
}

interface SelectPopoverProps {
  value: string;
  options: SelectPopoverOption[];
  ariaLabel: string;
  onChange: (value: string) => void;
  className?: string;
  popoverClassName?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  mono?: boolean;
}

export function SelectPopover({
  value,
  options,
  ariaLabel,
  onChange,
  className = '',
  popoverClassName = '',
  align = 'right',
  size = 'md',
  mono = false,
}: SelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIdx = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value],
  );
  const selectedOpt = options[selectedIdx] || options[0];

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onGlobalEsc = () => setOpen(false);
    window.addEventListener('agy-hud-esc', onGlobalEsc);
    return () => window.removeEventListener('agy-hud-esc', onGlobalEsc);
  }, []);

  useEffect(() => {
    if (open) setActiveIndex(selectedIdx);
  }, [open, selectedIdx]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const listEl = document.getElementById(listId);
    const item = listEl?.querySelector<HTMLElement>(`[data-opt-idx="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId]);

  const commit = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (options.length > 0 ? (prev + 1) % options.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (options.length > 0 ? (prev - 1 + options.length) % options.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) commit(opt.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const sizeCls = size === 'sm' ? 'px-2 py-[3.5px] text-[10.5px]' : 'px-2 py-[4px] text-[11.5px]';

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((p) => !p)}
        onKeyDown={handleKeyDown}
        className={`hud-select-trigger w-full inline-flex items-center justify-between gap-1.5 min-w-0 rounded-md cursor-pointer transition-colors ${sizeCls} ${
          mono ? 'font-hud-mono' : 'font-hud'
        } ${open ? 'is-open' : ''}`}
      >
        <span className="truncate text-left">{selectedOpt?.label || ''}</span>
        <IconChevronDown
          size={11}
          className={`text-hud-muted transition-transform duration-150 ${open ? 'rotate-180 text-hud-fg' : ''}`}
        />
      </button>

      <FixedPopover
        open={open}
        triggerRef={triggerRef}
        onClose={handleClose}
        align={align}
        role="listbox"
        id={listId}
        ariaLabel={ariaLabel}
        minWidthPx={180}
        maxWidthPx={240}
        className={`hud-select-popover ${popoverClassName}`}
      >
        {options.map((opt, idx) => {
          const isSelected = opt.value === value;
          const isFocused = idx === activeIndex;
          return (
            <div key={opt.value} className="flex flex-col">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                data-opt-idx={idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commit(opt.value)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-[5px] border-0 rounded-[6px] text-left cursor-pointer transition-colors ${
                  mono ? 'font-hud-mono text-[10.5px]' : 'font-hud text-[11.5px]'
                } ${
                  isSelected
                    ? 'bg-tint-accent text-hud-fg font-semibold'
                    : isFocused
                      ? 'bg-hud-fill text-hud-fg'
                      : 'bg-transparent text-hud-fg-2 hover:bg-hud-fill hover:text-hud-fg'
                }`}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate leading-snug">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="font-hud-mono text-[9.5px] text-hud-muted truncate tabular-nums">
                      {opt.sublabel}
                    </span>
                  )}
                </div>
                {isSelected && <IconCheck size={11} className="text-hud-accent-ink shrink-0" />}
              </button>
              {opt.dividerAfter && (
                <div className="h-px my-1 mx-1.5 bg-hud-hairline" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </FixedPopover>
    </div>
  );
}
