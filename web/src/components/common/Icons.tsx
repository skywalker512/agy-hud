import type { JSX } from 'preact';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const baseProps = (size: number, strokeWidth: number, className?: string): JSX.SVGAttributes<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': strokeWidth,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  className: className ? `shrink-0 ${className}` : 'shrink-0',
  'aria-hidden': 'true',
});

export function IconSearch({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L13.5 13.5" />
    </svg>
  );
}

export function IconChevronDown({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function IconChevronRight({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function IconMore({ size = 13, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRefresh({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M13 8a5 5 0 1 1-1.35-3.42" />
      <path d="M13 3.2v2.4h-2.4" />
    </svg>
  );
}

export function IconArrowRight({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3.5 8h9" />
      <path d="M9 4.5L12.5 8 9 11.5" />
    </svg>
  );
}

export function IconArrowLeft({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M12.5 8h-9" />
      <path d="M7 4.5L3.5 8 7 11.5" />
    </svg>
  );
}

export function IconArrowUp({ size = 11, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M8 12.5v-9" />
      <path d="M4.5 7L8 3.5 11.5 7" />
    </svg>
  );
}

export function IconExternalLink({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M6.5 3.5h6v6" />
      <path d="M12.5 3.5L6 10" />
      <path d="M10.5 9.5v3h-7v-7h3" />
    </svg>
  );
}

export function IconCheck({ size = 12, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3.2 8.4l3 3 6.6-6.8" />
    </svg>
  );
}

export function IconX({ size = 11, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  );
}

export function IconMinus({ size = 11, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function IconPlus({ size = 11, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function IconPulse({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M1.8 8.5h2.6l1.7-4.5 2.4 8 1.8-3.5h3.9" />
    </svg>
  );
}

export function IconCalls({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 4.5h10" />
      <path d="M3 8h7.5" />
      <path d="M3 11.5h5" />
    </svg>
  );
}

export function IconAccount({ size = 12, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" />
      <path d="M8 11.5l2.6-3.2" />
      <circle cx="8" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClock({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.1 1.4" />
    </svg>
  );
}

export function IconFastForward({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M3 4.5l4.2 3.5L3 11.5V4.5z" />
      <path d="M8.4 4.5l4.2 3.5-4.2 3.5V4.5z" />
    </svg>
  );
}

export function IconAlert({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M8 2.4L14 13H2L8 2.4z" />
      <path d="M8 6.4v3" />
      <circle cx="8" cy="11.2" r="0.65" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCopy({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.4" />
      <path d="M3.5 10.5H3a1.2 1.2 0 0 1-1.2-1.2V3A1.2 1.2 0 0 1 3 1.8h6.3a1.2 1.2 0 0 1 1.2 1.2v.5" />
    </svg>
  );
}

export function IconDownload({ size = 11, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, className)}>
      <path d="M8 2.5v7.2" />
      <path d="M5 7l3 3 3-3" />
      <path d="M2.8 12.8h10.4" />
    </svg>
  );
}
