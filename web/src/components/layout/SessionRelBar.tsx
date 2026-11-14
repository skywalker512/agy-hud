import type { Translations } from '../../i18n';
import type { StatsSnapshot } from '../../types/telemetry';
import { kindBadgeClass, kindBadgeText, shortTitleLabel } from '../../utils/format';

interface SessionRelBarProps {
  snap: StatsSnapshot | null;
  t: Translations;
  onJumpConversation: (convId: string) => void;
  onInspectChildren: () => void;
}

export function SessionRelBar({
  snap,
  t,
  onJumpConversation,
  onInspectChildren,
}: SessionRelBarProps) {
  const info = snap?.sessionInfo;
  const parent = info?.parentSession || null;
  const children = info?.childSessions || [];
  const kind = info?.kind || 'main';

  if (!snap?.found || (!parent && children.length === 0)) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
      {parent && (
        <button
          type="button"
          onClick={() => onJumpConversation(parent.id)}
          className="inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-[5px] border font-hud-mono text-[10.5px] font-semibold text-hud-accent cursor-pointer truncate transition-colors"
          style={{
            borderColor: 'color-mix(in srgb, var(--hud-accent) 42%, var(--hud-border))',
            background: 'color-mix(in srgb, var(--hud-accent) 12%, transparent)',
          }}
        >
          {t.backParent(shortTitleLabel(parent.title, parent.id))}
        </button>
      )}
      <span className={`rel-kind-pill ${kindBadgeClass(kind)}`}>
        {kindBadgeText(kind, t)}
      </span>
      {children.length > 0 && (
        <button
          type="button"
          onClick={onInspectChildren}
          className="ml-auto px-[7px] py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold text-seg-think cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          style={{
            borderColor: 'color-mix(in srgb, var(--seg-think) 38%, var(--hud-border))',
            background: 'color-mix(in srgb, var(--seg-think) 11%, transparent)',
          }}
        >
          {t.linkedCount(children.length)}
        </button>
      )}
    </div>
  );
}
