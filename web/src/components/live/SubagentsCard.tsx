import type { Translations } from '../../i18n';
import type { ChildSessionItem } from '../../types/telemetry';
import { fmtClock, fmtNum, fmtUsd, kindBadgeClass, kindBadgeText } from '../../utils/format';

interface SubagentsCardProps {
  found: boolean;
  children: ChildSessionItem[];
  t: Translations;
  onJumpConversation: (convId: string) => void;
}

export function SubagentsCard({
  found,
  children,
  t,
  onJumpConversation,
}: SubagentsCardProps) {
  if (!found || children.length === 0) {
    return null;
  }

  return (
    <section id="child-sessions-card" className="hud-card">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
          <span className="card-k">{t.linkedTitle}</span>
          <span className="micro-badge">{children.length}</span>
        </div>
        <span className="card-sub !mt-0">{t.linkedHint}</span>
      </div>

      <div className="mt-2 flex flex-col gap-[5px]">
        {children.map((c) => {
          const badge = kindBadgeText(c.kind, t);
          const cls = kindBadgeClass(c.kind);
          const lbl =
            c.title || (c.subagentType ? `${c.subagentType} · ${c.id.slice(0, 8)}…` : `${c.id.slice(0, 8)}…`);
          const costStr = c.pricedCount > 0 ? fmtUsd(c.costUSD) : '';
          const meta = t.linkedMeta(c.calls || 0, fmtNum(c.outputTokens || 0), costStr);

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onJumpConversation(c.id)}
              className="w-full text-left px-2 py-1.5 rounded-md border border-hud-border bg-hud-fill text-inherit cursor-pointer flex flex-col gap-[3px] hover:border-hud-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <div className="flex items-center gap-[5px] min-w-0 flex-1">
                  <span className={`rel-kind-pill ${cls}`}>{badge}</span>
                  <span className="text-[11.5px] font-semibold text-hud-fg truncate">{lbl}</span>
                </div>
                <span className="font-hud-mono text-[10.5px] font-semibold text-hud-accent shrink-0">
                  {t.jumpAction}
                </span>
              </div>
              <div className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums">
                {meta}
                {c.updatedMs ? ` · ${fmtClock(c.updatedMs)}` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
