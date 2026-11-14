import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { CallDetailPayload, StatsSnapshot } from '../../types/telemetry';
import { fmtClock, fmtSec } from '../../utils/format';

interface TooltipPortalProps {
  snap: StatsSnapshot | null;
  t: Translations;
  loadCallDetail: (convId: string, kind: 'inv' | 'compact' | 'turn', id: number) => Promise<CallDetailPayload | null>;
}

export function TooltipPortal({ snap, t, loadCallDetail }: TooltipPortalProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const snapRef = useRef(snap);
  snapRef.current = snap;
  const tRef = useRef(t);
  tRef.current = t;

  useLayoutEffect(() => {
    const tipEl = tipRef.current;
    if (!visible || !tipEl) return;
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = tipEl.getBoundingClientRect();
    let left = coords.x + 12;
    let top = coords.y + 14;
    if (left + rect.width + pad > vw) left = Math.max(pad, coords.x - rect.width - 12);
    if (top + rect.height + pad > vh) top = Math.max(pad, coords.y - rect.height - 12);
    setPos({ left, top });
  }, [visible, text, coords]);

  useEffect(() => {
    let activeTarget: HTMLElement | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let lastX = 0;
    let lastY = 0;

    const hide = () => {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      activeTarget = null;
      setVisible(false);
    };

    const showFor = (target: HTMLElement, tipText: string, cx: number, cy: number) => {
      setText(tipText);
      setCoords({ x: cx, y: cy });
      setVisible(true);

      if (target.dataset.hasFull === '1' && target.dataset.turnIdx && snapRef.current?.conversationId) {
        const convId = snapRef.current.conversationId;
        const turnIdx = Number(target.dataset.turnIdx);
        target.dataset.hasFull = '0';
        void loadCallDetail(convId, 'turn', turnIdx).then((detail) => {
          if (!detail?.promptFull) return;
          const turn = (snapRef.current?.turns || []).find((x) => x.turnIndex === turnIdx);
          if (!turn) return;
          const curT = tRef.current;
          const secStr = turn.totalSec > 0 ? fmtSec(turn.totalSec) : '';
          const nextTip = curT.turnDividerTip(
            turn.turnIndex,
            fmtClock(turn.timestampMs),
            turn.callCount || 0,
            turn.outputTokens || 0,
            secStr,
            detail.promptFull,
            turn.compactCount || 0,
          );
          target.dataset.tip = nextTip;
          if (activeTarget === target) {
            setText(nextTip);
            setCoords({ x: lastX, y: lastY });
          }
        });
      }
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!target) {
        if (activeTarget) hide();
        return;
      }
      if (target === activeTarget) return;
      const tipAttr = target.getAttribute('data-tip');
      if (!tipAttr) {
        hide();
        return;
      }
      if (showTimer) clearTimeout(showTimer);
      activeTarget = target;
      lastX = e.clientX;
      lastY = e.clientY;
      setVisible(false);
      showTimer = setTimeout(() => {
        showTimer = null;
        if (activeTarget !== target) return;
        const fresh = target.getAttribute('data-tip');
        if (fresh) showFor(target, fresh, lastX, lastY);
      }, 220);
    };

    const onMouseMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!activeTarget) return;
      setCoords((prev) => (prev.x === e.clientX && prev.y === e.clientY ? prev : { x: e.clientX, y: e.clientY }));
    };

    const onMouseOut = (e: MouseEvent) => {
      if (!activeTarget) return;
      const next = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (next !== activeTarget) hide();
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, [loadCallDetail]);

  return (
    <div
      ref={tipRef}
      role="tooltip"
      className={`hud-tooltip${visible ? '' : ' hidden'}`}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      {text}
    </div>
  );
}
