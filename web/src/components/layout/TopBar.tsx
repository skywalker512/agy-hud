import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  ConvMode,
  ConversationItem,
  Lang,
  StatsSnapshot,
  UpdateStatusResponse,
} from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { downloadOrCopyJson, formatSessionJson, formatSessionMarkdown } from '../../utils/exportReport';
import { fmtClock, formatSessionQuotaCompact, shortTitleLabel } from '../../utils/format';
import { ModelBar } from './ModelBar';
import { SessionRelBar } from './SessionRelBar';

interface TopBarProps {
  snap: StatsSnapshot | null;
  retrying: boolean;
  nowMs: number;
  mode: ConvMode;
  selectedConv: string;
  lang: Lang;
  t: Translations;
  updateStatus: UpdateStatusResponse | null;
  updateChecking: boolean;
  onSelectConversation: (val: string) => void;
  onJumpConversation: (convId: string) => void;
  onInspectChildren: () => void;
  onToggleLang: () => void;
  onOpenUpdates: () => void;
  onCheckUpdates: (force?: boolean) => Promise<UpdateStatusResponse | null>;
}

export function TopBar({
  snap,
  retrying,
  nowMs,
  mode,
  selectedConv,
  lang,
  t,
  updateStatus,
  updateChecking,
  onSelectConversation,
  onJumpConversation,
  onInspectChildren,
  onToggleLang,
  onOpenUpdates,
  onCheckUpdates,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<'id' | 'jsonl' | 'full' | 'md' | 'json-saved' | 'json-copied' | null>(
    null,
  );
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onGlobalEsc = () => setMenuOpen(false);
    window.addEventListener('agy-hud-esc', onGlobalEsc);
    return () => window.removeEventListener('agy-hud-esc', onGlobalEsc);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const flashField = (field: 'id' | 'jsonl' | 'full' | 'md' | 'json-saved' | 'json-copied', closeMenu = true) => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopiedField(field);
    copyTimerRef.current = setTimeout(() => {
      setCopiedField(null);
      if (closeMenu) setMenuOpen(false);
    }, 750);
  };

  const handleCopy = async (field: 'id' | 'jsonl' | 'full', value: string) => {
    if (!value) return;
    const ok = await copyText(value);
    if (!ok) return;
    flashField(field);
  };

  const handleCopySessionMd = async () => {
    if (!snap?.found) return;
    const ok = await copyText(formatSessionMarkdown(snap, lang));
    if (!ok) return;
    flashField('md');
  };

  const handleExportSessionJson = async () => {
    if (!snap?.found) return;
    const shortId = (snap.conversationId || 'session').slice(0, 8);
    const res = await downloadOrCopyJson(`agy-hud-${shortId}.json`, formatSessionJson(snap));
    if (res === 'failed') return;
    flashField(res === 'downloaded' ? 'json-saved' : 'json-copied');
  };

  // Status badge state
  let badgeCls = 'status-badge';
  let badgeText = t.connecting;
  let badgeTip: string | undefined;

  const active = snap?.activeStep;
  if (retrying) {
    badgeCls = 'status-badge tool';
    badgeText = t.badgeRetry;
  } else if (!snap) {
    badgeCls = 'status-badge';
    badgeText = t.connecting;
  } else if (active && active.stepType === 15) {
    if (active.streamStartMs > 0) {
      const sec = Math.max(0, (nowMs - active.streamStartMs) / 1000).toFixed(1);
      badgeCls = 'status-badge live';
      badgeText = t.badgeGen(sec);
      badgeTip = t.badgeGenTip;
    } else {
      const baseMs = active.createdAtMs || snap.serverTimeMs || nowMs;
      const sec = Math.max(0, (nowMs - baseMs) / 1000).toFixed(1);
      badgeCls = 'status-badge wait';
      badgeText = t.badgeWait(sec);
      badgeTip = t.badgeWaitTip;
    }
  } else if (active && active.stepType === 23) {
    const baseMs = active.createdAtMs || snap.serverTimeMs || nowMs;
    const sec = Math.max(0, (nowMs - baseMs) / 1000).toFixed(1);
    badgeCls = 'status-badge compact';
    badgeText = t.badgeCompact(sec);
    badgeTip = t.badgeCompactTip;
  } else if (active) {
    const isWaiting = active.status === 9 || active.statusName === 'WAITING';
    const sec = active.createdAtMs ? Math.max(0, (nowMs - active.createdAtMs) / 1000).toFixed(1) : '';
    badgeCls = isWaiting ? 'status-badge wait' : 'status-badge tool';
    badgeText = isWaiting ? t.badgeToolWait(active.toolName, sec) : t.badgeTool(active.toolName, sec);
  } else if (snap.found) {
    badgeCls = 'status-badge idle';
    badgeText = t.badgeStandby;
    badgeTip = t.badgeStandbyTip;
  } else {
    badgeCls = 'status-badge';
    badgeText = t.badgeIdle;
  }

  // Conversation options (with clean [Swarm @rosterName] labels)
  const convOptions = useMemo(() => {
    const list: ConversationItem[] = [...(snap?.conversations || [])];
    const activeId = snap?.conversationId || '';
    if (activeId && !list.some((c) => c.id === activeId)) {
      list.unshift({
        id: activeId,
        updatedMs: 0,
        title: snap?.sessionInfo?.title || '',
        kind: snap?.sessionInfo?.kind || 'main',
        swarmRosterName: snap?.sessionInfo?.swarm?.selfMember?.rosterName,
      });
    }
    if (mode === 'custom' && selectedConv && !list.some((c) => c.id === selectedConv)) {
      list.unshift({
        id: selectedConv,
        updatedMs: 0,
        title: '',
        kind: 'main',
      });
    }
    return list.map((c) => {
      const srcTag = c.source === 'cli' ? '[CLI] ' : '';
      const swarmTag = c.swarmRosterName ? `[Swarm @${c.swarmRosterName}] ` : '';
      const kindTag = swarmTag
        ? ''
        : c.kind === 'side_question'
          ? '[SQ] '
          : c.kind === 'subagent'
            ? '[Sub] '
            : '';
      const name = c.title ? shortTitleLabel(c.title, c.id) : `${c.id.slice(0, 8)}…`;
      const qTag = c.quotaUsage ? formatSessionQuotaCompact(c.quotaUsage, true) : '';
      const qPart = qTag ? ` [${qTag}]` : '';
      const tm = c.updatedMs ? ` (${fmtClock(c.updatedMs)})` : '';
      return {
        value: `conv:${c.id}`,
        label: `${srcTag}${swarmTag}${kindTag}${name}${qPart}${tm}`,
      };
    });
  }, [
    snap?.conversations,
    snap?.conversationId,
    snap?.sessionInfo?.title,
    snap?.sessionInfo?.kind,
    snap?.sessionInfo?.swarm?.selfMember?.rosterName,
    mode,
    selectedConv,
  ]);

  const selectValue =
    mode === 'custom'
      ? `conv:${selectedConv || snap?.conversationId || ''}`
      : mode === 'latest'
        ? 'latest'
        : 'auto';

  const convId = snap?.conversationId || '';
  const jPath = snap?.jsonlPath || '';
  const fPath = snap?.jsonlFullPath || '';
  const hasSessionData = Boolean(snap?.found);
  const showUpdatePill = Boolean(
    updateStatus?.updateAvailable && !updateStatus.isLinked && updateStatus.latestVersion,
  );
  const installedVersion = updateStatus?.currentVersion || '1.2.0';

  return (
    <header className="flex flex-col gap-1.5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-bold tracking-[0.02em] text-hud-fg whitespace-nowrap text-[13px]">
            {t.title}
          </span>
          <span className={badgeCls} data-tip={badgeTip}>
            <span className="dot" />
            <span className="truncate">{badgeText}</span>
          </span>
        </div>

        <div className="flex items-center gap-[5px] min-w-0 max-w-full flex-initial">
          <select
            aria-label="Conversation"
            className="hud-select"
            value={selectValue}
            onChange={(e) => onSelectConversation((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="auto">{t.optAuto}</option>
            <option value="latest">{t.optLatest}</option>
            {convOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {showUpdatePill && updateStatus?.latestVersion && (
            <button
              type="button"
              className="update-pill"
              data-tip={t.updatePillTip(installedVersion, updateStatus.latestVersion)}
              onClick={onOpenUpdates}
            >
              ↑ v{updateStatus.latestVersion}
            </button>
          )}

          <div ref={menuWrapRef} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-label="More"
              onClick={() => setMenuOpen((p) => !p)}
              className="hud-btn min-w-[26px] !px-[7px] !py-[2px] font-bold tracking-[0.04em]"
            >
              ⋯
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="more-popover absolute right-0 top-[calc(100%+5px)] z-40 min-w-[212px] p-1.5 rounded-lg bg-hud-card border border-hud-border shadow-xl flex flex-col gap-[3px]"
              >
                <div className="font-hud-mono text-[10px] text-hud-muted px-1.5 pt-[3px] pb-1 truncate">
                  {convId ? `ID: ${convId}` : '--'}
                </div>
                <button
                  type="button"
                  disabled={!convId}
                  data-tip={convId ? t.tipCopyId(convId) : undefined}
                  onClick={() => void handleCopy('id', convId)}
                  className={`w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors ${
                    copiedField === 'id' ? 'text-hud-ok font-semibold' : 'text-hud-fg'
                  } ${!convId ? 'opacity-50 cursor-default' : ''}`}
                >
                  {copiedField === 'id' ? t.copied : t.btnCopyId}
                </button>
                <button
                  type="button"
                  disabled={!jPath}
                  data-tip={jPath ? t.tipCopyJsonl(jPath, Boolean(snap?.jsonlExists)) : undefined}
                  onClick={() => void handleCopy('jsonl', jPath)}
                  className={`w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors ${
                    copiedField === 'jsonl' ? 'text-hud-ok font-semibold' : 'text-hud-fg'
                  } ${!snap?.jsonlExists ? 'opacity-55' : ''}`}
                >
                  {copiedField === 'jsonl' ? t.copied : t.btnCopyJsonl}
                </button>
                <button
                  type="button"
                  disabled={!fPath}
                  data-tip={fPath ? t.tipCopyJsonlFull(fPath, Boolean(snap?.jsonlFullExists)) : undefined}
                  onClick={() => void handleCopy('full', fPath)}
                  className={`w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors ${
                    copiedField === 'full' ? 'text-hud-ok font-semibold' : 'text-hud-fg'
                  } ${!snap?.jsonlFullExists ? 'opacity-55' : ''}`}
                >
                  {copiedField === 'full' ? t.copied : t.btnCopyJsonlFull}
                </button>

                <div className="h-px my-0.5 mx-1 bg-hud-border" />

                <button
                  type="button"
                  disabled={!hasSessionData}
                  onClick={() => void handleCopySessionMd()}
                  className={`w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors ${
                    copiedField === 'md' ? 'text-hud-ok font-semibold' : 'text-hud-fg'
                  } ${!hasSessionData ? 'opacity-50 cursor-default' : ''}`}
                >
                  {copiedField === 'md' ? t.copied : t.btnCopyReportMd}
                </button>
                <button
                  type="button"
                  disabled={!hasSessionData}
                  onClick={() => void handleExportSessionJson()}
                  className={`w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors ${
                    copiedField === 'json-saved' || copiedField === 'json-copied'
                      ? 'text-hud-ok font-semibold'
                      : 'text-hud-fg'
                  } ${!hasSessionData ? 'opacity-50 cursor-default' : ''}`}
                >
                  {copiedField === 'json-saved'
                    ? t.exportedJsonSaved
                    : copiedField === 'json-copied'
                      ? t.exportedJsonCopied
                      : t.btnExportJson}
                </button>

                <div className="h-px my-0.5 mx-1 bg-hud-border" />

                <button
                  type="button"
                  onClick={() => {
                    void onCheckUpdates(true);
                    setMenuOpen(false);
                    onOpenUpdates();
                  }}
                  className="w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-hud-fg text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors"
                >
                  {updateChecking ? t.menuCheckingUpdates : t.menuCheckUpdates}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToggleLang();
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-2 py-[5px] border-0 rounded-[5px] bg-transparent text-hud-fg text-[11.5px] cursor-pointer hover:bg-hud-fill hover:text-hud-accent transition-colors"
                >
                  {lang === 'en' ? '中文 / EN' : 'EN / 中文'}
                </button>

                <div className="h-px my-0.5 mx-1 bg-hud-border" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenUpdates();
                  }}
                  className="w-full flex items-center justify-between gap-2 px-1.5 py-[3px] border-0 rounded bg-transparent text-left font-hud-mono text-[10px] text-hud-muted cursor-pointer hover:text-hud-fg transition-colors tabular-nums"
                >
                  <span>AGY-HUD v{installedVersion}</span>
                  {updateStatus?.isLinked ? (
                    <span className="px-1 py-[0.5px] rounded text-[9px] font-bold text-hud-warn border border-hud-border bg-hud-surface-2">
                      {t.menuDevTag}
                    </span>
                  ) : showUpdatePill && updateStatus?.latestVersion ? (
                    <span className="text-hud-accent-ink font-semibold">↑ v{updateStatus.latestVersion}</span>
                  ) : null}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ModelBar snap={snap} t={t} />
      <SessionRelBar
        snap={snap}
        lang={lang}
        t={t}
        onJumpConversation={onJumpConversation}
        onInspectChildren={onInspectChildren}
      />
    </header>
  );
}
