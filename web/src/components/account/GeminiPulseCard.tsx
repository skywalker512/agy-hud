import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import type { GcpActiveIncident, GeminiLocalBaseline, GeminiModelGlobalPulse, GeminiPulseSnapshot } from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { fmtClock, fmtNum, fmtSec, fmtTps } from '../../utils/format';

const EMPTY_MODELS: GeminiModelGlobalPulse[] = [];
const EMPTY_INCIDENTS: GcpActiveIncident[] = [];
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconRefresh,
} from '../common/Icons';

interface GeminiPulseCardProps {
  pulse: GeminiPulseSnapshot | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  t: Translations;
}

type LocalWindow = '30m' | '24h' | '7d';
type PulseView = 'overview' | 'arena';

interface ArenaFighter {
  id: string;
  kind: 'local' | 'global' | 'endpoint';
  family: string;
  name: string;
  shortName: string;
  tag: string;
  ttftSec: number | null;
  tps: number | null;
  cachePct: number | null;
  uptimePct: number | null;
  samples: number;
}

function statusDotClass(status: string): string {
  if (status === 'outage') return 'bg-hud-bad';
  if (status === 'degraded') return 'bg-hud-warn';
  if (status === 'ok') return 'bg-hud-ok';
  return 'bg-hud-muted/50';
}

function shortGeminiLabel(m: GeminiModelGlobalPulse): string {
  return m.label.replace(/^Gemini\s+/i, '');
}

function readLocalWindow(local: GeminiLocalBaseline | null | undefined, win: LocalWindow) {
  if (!local) return { calls: 0, ttft: null, tps: null, cache: null, actualWin: win as LocalWindow };
  if (win === '30m' && (local.calls30m || 0) > 0) {
    return {
      calls: local.calls30m || 0,
      ttft: local.p50Ttft30mSec ?? null,
      tps: local.p50Tps30m ?? null,
      cache: local.cacheHit30mPct ?? null,
      actualWin: '30m' as LocalWindow,
    };
  }
  if (win === '24h' && (local.calls24h || 0) > 0) {
    return {
      calls: local.calls24h || 0,
      ttft: local.p50Ttft24hSec ?? null,
      tps: local.p50Tps24h ?? null,
      cache: local.cacheHit24hPct ?? null,
      actualWin: '24h' as LocalWindow,
    };
  }
  if (win === '7d' && local.calls7d > 0) {
    return {
      calls: local.calls7d,
      ttft: local.p50TtftSec,
      tps: local.p50Tps,
      cache: local.cacheHitPct,
      actualWin: '7d' as LocalWindow,
    };
  }
  // Empty for selected window
  return { calls: 0, ttft: null, tps: null, cache: null, actualWin: win };
}

function readBestLocalWindow(local: GeminiLocalBaseline | null | undefined, preferred: LocalWindow) {
  const direct = readLocalWindow(local, preferred);
  if (direct.calls > 0) return direct;
  const order: LocalWindow[] = preferred === '30m' ? ['24h', '7d'] : preferred === '24h' ? ['30m', '7d'] : ['24h', '30m'];
  for (const w of order) {
    const res = readLocalWindow(local, w);
    if (res.calls > 0) return res;
  }
  return direct;
}

function scoreMatchup(a: ArenaFighter, b: ArenaFighter) {
  let winsA = 0;
  let winsB = 0;
  let ptsA = 0;
  let ptsB = 0;
  let dims = 0;

  // TTFT: lower is better
  let ttftWinner: 'a' | 'b' | 'tie' = 'tie';
  if (a.ttftSec !== null && b.ttftSec !== null && a.ttftSec > 0 && b.ttftSec > 0) {
    dims += 1;
    const ratio = a.ttftSec / b.ttftSec;
    if (ratio <= 0.92) {
      ttftWinner = 'a';
      winsA += 1;
    } else if (ratio >= 1.08) {
      ttftWinner = 'b';
      winsB += 1;
    }
    ptsA += Math.min(100, (Math.min(a.ttftSec, b.ttftSec) / a.ttftSec) * 100);
    ptsB += Math.min(100, (Math.min(a.ttftSec, b.ttftSec) / b.ttftSec) * 100);
  }

  // TPS: higher is better
  let tpsWinner: 'a' | 'b' | 'tie' = 'tie';
  if (a.tps !== null && b.tps !== null && a.tps > 0 && b.tps > 0) {
    dims += 1;
    const ratio = a.tps / b.tps;
    if (ratio >= 1.08) {
      tpsWinner = 'a';
      winsA += 1;
    } else if (ratio <= 0.92) {
      tpsWinner = 'b';
      winsB += 1;
    }
    const maxTps = Math.max(a.tps, b.tps);
    ptsA += (a.tps / maxTps) * 100;
    ptsB += (b.tps / maxTps) * 100;
  }

  // Cache: higher is better
  let cacheWinner: 'a' | 'b' | 'tie' = 'tie';
  if (a.cachePct !== null && b.cachePct !== null) {
    dims += 1;
    const diff = a.cachePct - b.cachePct;
    if (diff >= 3) {
      cacheWinner = 'a';
      winsA += 1;
    } else if (diff <= -3) {
      cacheWinner = 'b';
      winsB += 1;
    }
    const maxC = Math.max(1, a.cachePct, b.cachePct);
    ptsA += (a.cachePct / maxC) * 100;
    ptsB += (b.cachePct / maxC) * 100;
  }

  // Uptime: higher is better (when both have uptime)
  let upWinner: 'a' | 'b' | 'tie' = 'tie';
  if (a.uptimePct !== null && b.uptimePct !== null) {
    dims += 1;
    const diff = a.uptimePct - b.uptimePct;
    if (diff >= 1.5) {
      upWinner = 'a';
      winsA += 1;
    } else if (diff <= -1.5) {
      upWinner = 'b';
      winsB += 1;
    }
    ptsA += a.uptimePct;
    ptsB += b.uptimePct;
  }

  const scoreA = dims > 0 ? Math.round(ptsA / dims) : 0;
  const scoreB = dims > 0 ? Math.round(ptsB / dims) : 0;
  const overallWinner: 'a' | 'b' | 'tie' =
    winsA > winsB ? 'a' : winsB > winsA ? 'b' : scoreA > scoreB + 2 ? 'a' : scoreB > scoreA + 2 ? 'b' : 'tie';

  return { ttftWinner, tpsWinner, cacheWinner, upWinner, winsA, winsB, scoreA, scoreB, overallWinner };
}

function GeminiPulseCardImpl({
  pulse,
  refreshing,
  onRefresh,
  onToggleEnabled,
  t,
}: GeminiPulseCardProps) {
  const [open, toggleOpen] = usePersistedOpen('gemini-pulse', true);
  const [view, setView] = useState<PulseView>('overview');
  const [localWin, setLocalWin] = useState<LocalWindow>('30m');
  const [fighterAId, setFighterAId] = useState<string>('');
  const [fighterBId, setFighterBId] = useState<string>('');
  const [copiedPk, setCopiedPk] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const isZh = t.lang === 'zh';
  const enabled = pulse ? pulse.enabled : true;
  const models = pulse?.models || EMPTY_MODELS;
  const incidents = pulse?.incidents || EMPTY_INCIDENTS;
  const overall = pulse?.overallStatus || 'unknown';
  const fetchedClock = pulse?.fetchedAtMs ? fmtClock(pulse.fetchedAtMs) : '';
  const isBusy = refreshing || Boolean(pulse?.loading);

  // Build unified fighter roster for Cyber Cricket PK Arena
  const fighters = useMemo<ArenaFighter[]>(() => {
    const list: ArenaFighter[] = [];
    for (const m of models) {
      const short = shortGeminiLabel(m);
      const loc = readBestLocalWindow(m.local, localWin);
      if (loc.calls > 0 && (loc.ttft !== null || loc.tps !== null)) {
        list.push({
          id: `local:${m.family}`,
          kind: 'local',
          family: m.family,
          name: isZh ? `本机 · ${short} (${loc.actualWin})` : `Mine · ${short} (${loc.actualWin})`,
          shortName: isZh ? `本机 ${short}` : `Mine ${short}`,
          tag: isZh ? `${loc.actualWin} · ${loc.calls}次` : `${loc.actualWin} · ${loc.calls} calls`,
          ttftSec: loc.ttft,
          tps: loc.tps,
          cachePct: loc.cache,
          uptimePct: null,
          samples: loc.calls,
        });
      }
      list.push({
        id: `global:${m.family}`,
        kind: 'global',
        family: m.family,
        name: isZh ? `大盘 · ${short} (30m)` : `Global · ${short} (30m)`,
        shortName: isZh ? `大盘 ${short}` : `Glb ${short}`,
        tag: `OpenRouter 30m · ${fmtNum(m.requestCount30m)}`,
        ttftSec: m.p50TtftSec,
        tps: m.p50Tps,
        cachePct: m.cacheHitPct,
        uptimePct: m.uptime30mPct,
        samples: m.requestCount30m,
      });
      if (Array.isArray(m.endpoints) && m.endpoints.length >= 2) {
        for (const ep of m.endpoints.slice(0, 3)) {
          const prov = /vertex/i.test(ep.providerName || ep.providerSlug)
            ? 'Vertex'
            : /ai[- ]?studio/i.test(ep.providerName || ep.providerSlug)
              ? 'AI Studio'
              : ep.providerName || ep.providerSlug || ep.endpointId.slice(0, 10);
          list.push({
            id: `ep:${m.family}:${ep.endpointId}`,
            kind: 'endpoint',
            family: m.family,
            name: `${prov} · ${short} (30m)`,
            shortName: `${prov} ${short}`,
            tag: `30m · ${fmtNum(ep.requestCount)} req`,
            ttftSec: ep.p50TtftSec,
            tps: ep.p50Tps,
            cachePct: ep.cacheHitPct,
            uptimePct: null,
            samples: ep.requestCount,
          });
        }
      }
    }
    return list;
  }, [models, localWin, isZh]);

  // Default smart matchup: local active model vs its OpenRouter global, or top 2 global models
  const defaultMatchup = useMemo(() => {
    const activeFam = pulse?.activeFamily || '';
    const activeLocal = fighters.find((f) => f.id === `local:${activeFam}`);
    const activeGlobal = fighters.find((f) => f.id === `global:${activeFam}`);
    if (activeLocal && activeGlobal) return [activeLocal.id, activeGlobal.id];

    const anyLocal = fighters.find((f) => f.kind === 'local');
    if (anyLocal) {
      const peerGlobal = fighters.find((f) => f.id === `global:${anyLocal.family}`);
      if (peerGlobal) return [anyLocal.id, peerGlobal.id];
    }

    const globals = fighters.filter((f) => f.kind === 'global');
    if (globals.length >= 2) return [globals[0].id, globals[1].id];
    return [fighters[0]?.id || '', fighters[1]?.id || fighters[0]?.id || ''];
  }, [fighters, pulse?.activeFamily]);

  const resolvedA = fighters.find((f) => f.id === fighterAId) || fighters.find((f) => f.id === defaultMatchup[0]) || null;
  const resolvedB = fighters.find((f) => f.id === fighterBId) || fighters.find((f) => f.id === defaultMatchup[1]) || null;

  const matchupResult = useMemo(
    () => (resolvedA && resolvedB ? scoreMatchup(resolvedA, resolvedB) : null),
    [resolvedA, resolvedB],
  );

  const applyPreset = (preset: 'me-vs-global' | 'speed-duel' | 'endpoint-duel') => {
    if (preset === 'me-vs-global') {
      const activeLocal = fighters.find((f) => f.id === `local:${pulse?.activeFamily || ''}`) || fighters.find((f) => f.kind === 'local');
      if (activeLocal) {
        setFighterAId(activeLocal.id);
        setFighterBId(`global:${activeLocal.family}`);
        return;
      }
    }
    if (preset === 'endpoint-duel') {
      const byFam = new Map<string, ArenaFighter[]>();
      for (const f of fighters) {
        if (f.kind !== 'endpoint') continue;
        const arr = byFam.get(f.family) || [];
        arr.push(f);
        byFam.set(f.family, arr);
      }
      for (const arr of byFam.values()) {
        if (arr.length >= 2) {
          setFighterAId(arr[0].id);
          setFighterBId(arr[1].id);
          return;
        }
      }
    }
    // Speed duel: fastest vs slowest global model by TTFT
    const globals = fighters.filter((f) => f.kind === 'global' && f.ttftSec !== null).sort((a, b) => (a.ttftSec || 99) - (b.ttftSec || 99));
    if (globals.length >= 2) {
      setFighterAId(globals[0].id);
      setFighterBId(globals[globals.length - 1].id);
    }
  };

  const handleCopyArenaReport = () => {
    if (!resolvedA || !resolvedB || !matchupResult) return;
    const winnerName =
      matchupResult.overallWinner === 'a'
        ? resolvedA.name
        : matchupResult.overallWinner === 'b'
          ? resolvedB.name
          : isZh
            ? '势均力敌'
            : 'Draw';
    const lines = [
      isZh
        ? `⚔️ AGY-HUD 赛博斗蛐蛐 · ${resolvedA.shortName} vs ${resolvedB.shortName}`
        : `⚔️ AGY-HUD Cyber Arena · ${resolvedA.shortName} vs ${resolvedB.shortName}`,
      `TTFT: ${resolvedA.ttftSec !== null ? fmtSec(resolvedA.ttftSec) : '--'} vs ${resolvedB.ttftSec !== null ? fmtSec(resolvedB.ttftSec) : '--'}`,
      `TPS: ${resolvedA.tps !== null ? `${fmtTps(resolvedA.tps)} t/s` : '--'} vs ${resolvedB.tps !== null ? `${fmtTps(resolvedB.tps)} t/s` : '--'}`,
      `Cache: ${resolvedA.cachePct !== null ? `${Math.round(resolvedA.cachePct)}%` : '--'} vs ${resolvedB.cachePct !== null ? `${Math.round(resolvedB.cachePct)}%` : '--'}`,
      isZh
        ? `🏆 胜者：${winnerName}（战力分 ${matchupResult.scoreA} : ${matchupResult.scoreB}）`
        : `🏆 Winner: ${winnerName} (Score ${matchupResult.scoreA} : ${matchupResult.scoreB})`,
    ];
    void copyText(lines.join('\n')).then((ok) => {
      if (!ok) return;
      setCopiedPk(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedPk(false), 1400);
    });
  };

  const statusBadge = !enabled
    ? { cls: 'text-hud-muted bg-hud-fill', text: t.pulseStatusOff }
    : isBusy && models.length === 0
      ? { cls: 'text-hud-accent-ink bg-tint-accent font-medium', text: isZh ? '加载中' : 'Loading' }
      : overall === 'outage'
        ? { cls: 'text-hud-bad bg-tint-bad font-semibold', text: t.pulseStatusOutage }
        : overall === 'degraded'
          ? { cls: 'text-hud-warn bg-tint-warn font-semibold', text: t.pulseStatusDegraded }
          : overall === 'ok'
            ? { cls: 'text-hud-ok bg-hud-fill font-medium', text: t.pulseStatusOk }
            : { cls: 'text-hud-muted bg-hud-fill', text: t.pulseStatusUnknown };

  const hasEndpointDuel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of fighters) {
      if (f.kind === 'endpoint') counts.set(f.family, (counts.get(f.family) || 0) + 1);
    }
    return [...counts.values()].some((c) => c >= 2);
  }, [fighters]);

  const hasLocalFighter = useMemo(() => fighters.some((f) => f.kind === 'local'), [fighters]);

  // Compute commentary sentence for the PK matchup
  const arenaCommentary = useMemo(() => {
    if (!resolvedA || !resolvedB || !matchupResult) return '';
    const bits: string[] = [];
    if (resolvedA.ttftSec && resolvedB.ttftSec) {
      if (resolvedA.ttftSec < resolvedB.ttftSec * 0.92) {
        const mult = (resolvedB.ttftSec / resolvedA.ttftSec).toFixed(1);
        bits.push(isZh ? `${resolvedA.shortName} 首字快 ${mult}x` : `${resolvedA.shortName} TTFT ${mult}x faster`);
      } else if (resolvedB.ttftSec < resolvedA.ttftSec * 0.92) {
        const mult = (resolvedA.ttftSec / resolvedB.ttftSec).toFixed(1);
        bits.push(isZh ? `${resolvedB.shortName} 首字快 ${mult}x` : `${resolvedB.shortName} TTFT ${mult}x faster`);
      }
    }
    if (resolvedA.tps && resolvedB.tps) {
      if (resolvedA.tps > resolvedB.tps * 1.08) {
        const mult = (resolvedA.tps / resolvedB.tps).toFixed(1);
        bits.push(isZh ? `${resolvedA.shortName} 吐字快 ${mult}x` : `${resolvedA.shortName} TPS ${mult}x faster`);
      } else if (resolvedB.tps > resolvedA.tps * 1.08) {
        const mult = (resolvedB.tps / resolvedA.tps).toFixed(1);
        bits.push(isZh ? `${resolvedB.shortName} 吐字快 ${mult}x` : `${resolvedB.shortName} TPS ${mult}x faster`);
      }
    }
    if (resolvedA.cachePct !== null && resolvedB.cachePct !== null) {
      const d = Math.round(resolvedA.cachePct - resolvedB.cachePct);
      if (Math.abs(d) >= 4) {
        const who = d > 0 ? resolvedA.shortName : resolvedB.shortName;
        bits.push(isZh ? `${who} 缓存高 +${Math.abs(d)}pp` : `${who} cache +${Math.abs(d)}pp`);
      }
    }
    if (!bits.length) {
      return isZh ? '两方各项实测表现势均力敌，难分伯仲。' : 'Neck-and-neck across measured metrics.';
    }
    return bits.join(isZh ? '，' : ' · ');
  }, [resolvedA, resolvedB, matchupResult, isZh]);

  const renderMetricDuelRow = (
    label: string,
    valA: number | null,
    valB: number | null,
    fmt: (v: number) => string,
    winner: 'a' | 'b' | 'tie',
    lowerIsBetter: boolean,
  ) => {
    const maxV = Math.max(0.001, valA || 0, valB || 0);
    // For lowerIsBetter (TTFT), invert bar visual so faster = fuller bar!
    const pctA =
      valA === null
        ? 0
        : lowerIsBetter
          ? Math.max(12, Math.round((Math.min(valA, valB ?? valA) / Math.max(0.01, valA)) * 100))
          : Math.max(8, Math.round((valA / maxV) * 100));
    const pctB =
      valB === null
        ? 0
        : lowerIsBetter
          ? Math.max(12, Math.round((Math.min(valA ?? valB, valB) / Math.max(0.01, valB)) * 100))
          : Math.max(8, Math.round((valB / maxV) * 100));

    return (
      <div className="flex flex-col gap-0.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-hud-mono text-[10px] tabular-nums">
          <div className={`flex items-center gap-1 ${winner === 'a' ? 'text-hud-ok font-bold' : 'text-hud-fg/85'}`}>
            <span>{valA !== null ? fmt(valA) : '--'}</span>
            {winner === 'a' && <span className="text-[9px]">★</span>}
          </div>
          <span className="font-hud text-[9px] font-semibold uppercase tracking-[0.03em] text-hud-muted">{label}</span>
          <div className={`flex items-center justify-end gap-1 ${winner === 'b' ? 'text-hud-accent-ink font-bold' : 'text-hud-fg/85'}`}>
            {winner === 'b' && <span className="text-[9px]">★</span>}
            <span>{valB !== null ? fmt(valB) : '--'}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 h-[5px]">
          <div className="w-full h-full rounded-full bg-hud-fill overflow-hidden flex justify-end">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pctA}%`,
                background: winner === 'a' ? 'var(--hud-ok)' : 'color-mix(in srgb, var(--hud-ok) 48%, transparent)',
              }}
            />
          </div>
          <div className="w-full h-full rounded-full bg-hud-fill overflow-hidden flex justify-start">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pctB}%`,
                background: winner === 'b' ? 'var(--seg-input)' : 'color-mix(in srgb, var(--seg-input) 48%, transparent)',
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="hud-card">
      <div
        className="card-head flex items-center justify-between gap-2 cursor-pointer select-none"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="card-k truncate">{t.pulseTitle}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] whitespace-nowrap ${statusBadge.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBusy ? 'bg-hud-accent animate-pulse' : enabled ? statusDotClass(overall) : 'bg-hud-muted/40'}`} />
            <span>{statusBadge.text}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {enabled && (
            <button
              type="button"
              className="collapse-btn"
              aria-label={isZh ? '刷新 Gemini 全局大盘' : 'Refresh Gemini Pulse'}
              disabled={isBusy}
              data-tip={t.pulseRefreshTip(fetchedClock)}
              onClick={onRefresh}
            >
              <IconRefresh size={11} className={isBusy ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            type="button"
            className="px-1.5 py-[1px] rounded font-hud text-[9.5px] text-hud-muted hover:text-hud-fg bg-hud-fill transition-colors cursor-pointer"
            data-tip={enabled ? t.pulseDisableTip : t.pulseEnableTip}
            onClick={() => onToggleEnabled(!enabled)}
          >
            {enabled ? t.pulseToggleOn : t.pulseToggleOff}
          </button>
          <button
            type="button"
            className="collapse-btn"
            aria-expanded={open}
            onClick={toggleOpen}
          >
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="hud-expand-anim mt-2.5 flex flex-col gap-2 min-w-0">
          {!enabled ? (
            <div className="l2-well px-2.5 py-2 text-[10.5px] font-hud text-hud-muted leading-[1.4]">
              {t.pulseDisabledNote}
            </div>
          ) : (
            <>
              {/* Top sub-toolbar: Overview / Cyber Cricket PK + Local Comparison Window (30m/24h/7d) */}
              {models.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                  <div className="metric-tabs" role="tablist" aria-label={isZh ? '大盘视图模式' : 'Pulse mode'}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'overview'}
                      className={`metric-tab${view === 'overview' ? ' is-active' : ''}`}
                      onClick={() => setView('overview')}
                    >
                      {isZh ? '大盘总览' : 'Overview'}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'arena'}
                      className={`metric-tab${view === 'arena' ? ' is-active' : ''}`}
                      onClick={() => setView('arena')}
                    >
                      {isZh ? '⚔ 赛博斗蛐蛐' : '⚔ Arena PK'}
                    </button>
                  </div>

                  <div
                    className="flex items-center gap-1"
                    data-tip={
                      isZh
                        ? '切换本机对比时间窗：30m 与 OpenRouter 统计窗口严格对齐；若近 30 分钟本地无调用，可切 24h 或 7d。注意 OpenRouter 含中转路由延迟（约 +50~150ms）且混合不同 prompt 长度。'
                        : 'Choose your local comparison window: 30m aligns strictly with OpenRouter 30m stats; switch to 24h/7d when 30m local samples are empty. Note OpenRouter includes ~50-150ms proxy overhead across mixed prompt lengths.'
                    }
                  >
                    <span className="font-hud text-[9px] text-hud-muted">{isZh ? '本机窗' : 'Mine'}</span>
                    <div className="metric-tabs" role="group" aria-label={isZh ? '本机统计窗口' : 'Local window'}>
                      {(['30m', '24h', '7d'] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          className={`metric-tab font-hud-mono${localWin === w ? ' is-active' : ''}`}
                          onClick={() => setLocalWin(w)}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Live loading / syncing indicator banner */}
              {isBusy && models.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-tint-accent text-[9.5px] font-hud text-hud-accent-ink">
                  <IconRefresh size={10} className="animate-spin shrink-0" />
                  <span>{isZh ? '正在同步 OpenRouter 近 30 分钟实时数据…' : 'Syncing live OpenRouter 30m stats…'}</span>
                </div>
              )}

              {incidents.length > 0 && (
                <div className="l2-well px-2.5 py-1.5 flex items-start gap-1.5 text-[10px] font-hud text-hud-warn border border-hud-warn/25">
                  <IconAlert size={12} className="shrink-0 mt-[1px]" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-hud-fg truncate">
                      {incidents[0].service} · {incidents[0].severity.toUpperCase()}
                    </div>
                    <div className="text-hud-muted leading-[1.35] break-words">{incidents[0].summary}</div>
                  </div>
                </div>
              )}

              {models.length === 0 ? (
                <div className="l2-well px-2.5 py-2 flex items-center gap-2 text-[10.5px] font-hud text-hud-muted">
                  {isBusy && <IconRefresh size={11} className="animate-spin shrink-0 text-hud-accent-ink" />}
                  <span>{pulse?.error ? t.pulseErrorNote(pulse.error) : t.pulseLoading}</span>
                </div>
              ) : view === 'overview' ? (
                <div className="l2-well px-2 py-1.5 flex flex-col gap-1 min-w-0">
                  {/* Column header */}
                  <div className="grid grid-cols-[minmax(0,1.45fr)_44px_40px_36px_36px] items-center gap-1 px-1 pb-1 border-b border-hud-hairline font-hud text-[9px] font-semibold uppercase tracking-[0.03em] text-hud-muted">
                    <span>{t.pulseColModel}</span>
                    <span className="text-right">TTFT</span>
                    <span className="text-right">TPS</span>
                    <span className="text-right">{t.pulseColCache}</span>
                    <span className="text-right">{t.pulseColUp}</span>
                  </div>

                  {models.map((m) => {
                    const isActive = pulse?.activeFamily === m.family;
                    const ttftStr = m.p50TtftSec !== null ? fmtSec(m.p50TtftSec) : '--';
                    const tpsStr = m.p50Tps !== null ? fmtTps(m.p50Tps) : '--';
                    const cacheStr = m.cacheHitPct !== null ? `${Math.round(m.cacheHitPct)}%` : '--';
                    const upStr = m.uptime30mPct !== null ? `${Math.round(m.uptime30mPct)}%` : '--';

                    const loc = readLocalWindow(m.local, localWin);
                    const ttftRatio =
                      loc.ttft !== null && m.p50TtftSec !== null && m.p50TtftSec > 0 ? loc.ttft / m.p50TtftSec : null;
                    const vsBadge =
                      ttftRatio !== null
                        ? ttftRatio <= 0.85
                          ? { cls: 'text-hud-ok bg-tint-ok', text: isZh ? `快${(1 / ttftRatio).toFixed(1)}x` : `${(1 / ttftRatio).toFixed(1)}x↑` }
                          : ttftRatio >= 1.35
                            ? { cls: 'text-hud-bad bg-tint-bad', text: isZh ? `慢${ttftRatio.toFixed(1)}x` : `${ttftRatio.toFixed(1)}x↓` }
                            : { cls: 'text-hud-muted bg-hud-fill', text: isZh ? '持平' : '~1x' }
                        : null;

                    const ttftCls =
                      m.p50TtftSec !== null && m.p50TtftSec >= 8
                        ? 'text-hud-bad font-semibold'
                        : m.p50TtftSec !== null && m.p50TtftSec >= 4
                          ? 'text-hud-warn font-medium'
                          : 'text-hud-fg';
                    const upCls =
                      m.uptime30mPct !== null && m.uptime30mPct < 90
                        ? 'text-hud-bad font-semibold'
                        : m.uptime30mPct !== null && m.uptime30mPct < 99
                          ? 'text-hud-warn font-medium'
                          : 'text-hud-ok';

                    const localLine =
                      loc.calls > 0
                        ? isZh
                          ? `你的本机 ${loc.actualWin}（${loc.calls} 次）：首字 P50 ${loc.ttft !== null ? fmtSec(loc.ttft) : '--'} · 速度 ${loc.tps !== null ? fmtTps(loc.tps) : '--'} · 缓存 ${loc.cache !== null ? `${loc.cache.toFixed(0)}%` : '--'}`
                          : `Your ${loc.actualWin} local (${loc.calls} calls): TTFT P50 ${loc.ttft !== null ? fmtSec(loc.ttft) : '--'} · TPS ${loc.tps !== null ? fmtTps(loc.tps) : '--'} · Cache ${loc.cache !== null ? `${loc.cache.toFixed(0)}%` : '--'}`
                        : isZh
                          ? `你的本机 ${localWin}：暂无调用（可切换 24h / 7d 查看）`
                          : `Your ${localWin} local: no calls yet (try 24h / 7d)`;

                    const rowTip = t.pulseRowTip({
                      label: m.label,
                      provider: m.primaryProvider || 'Google',
                      req30m: m.requestCount30m > 0 ? fmtNum(m.requestCount30m) : '--',
                      p50Ttft: ttftStr,
                      p90Ttft: m.p90TtftSec !== null ? fmtSec(m.p90TtftSec) : '--',
                      p50Tps: tpsStr,
                      cachePct: m.cacheHitPct !== null ? `${m.cacheHitPct.toFixed(1)}%` : '--',
                      uptimePct: m.uptime30mPct !== null ? `${m.uptime30mPct.toFixed(1)}%` : '--',
                      degraded: m.degradedProviders.join(', '),
                      localLine,
                    });

                    return (
                      <div
                        key={m.family}
                        role="button"
                        tabIndex={0}
                        className={`grid grid-cols-[minmax(0,1.45fr)_44px_40px_36px_36px] items-center gap-1 px-1 py-[3px] rounded cursor-pointer font-hud-mono text-[10px] tabular-nums transition-colors hover:bg-hud-fill/75${
                          isActive ? ' bg-hud-fill/80' : ''
                        }`}
                        data-tip={`${rowTip}\n${isZh ? '点击进入「赛博斗蛐蛐」单挑对比' : 'Click to open in Cyber Arena PK'}`}
                        onClick={() => {
                          const locF = fighters.find((f) => f.id === `local:${m.family}`);
                          if (locF) {
                            setFighterAId(locF.id);
                            setFighterBId(`global:${m.family}`);
                          } else {
                            setFighterAId(`global:${m.family}`);
                            const other = fighters.find((f) => f.kind === 'global' && f.family !== m.family);
                            if (other) setFighterBId(other.id);
                          }
                          setView('arena');
                        }}
                      >
                        <div className="flex items-center gap-1 min-w-0 font-hud text-[10.5px]">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(m.status)}`} />
                          <span className={`truncate ${isActive ? 'font-semibold text-hud-fg' : 'text-hud-fg/90'}`}>
                            {shortGeminiLabel(m)}
                          </span>
                          {vsBadge && (
                            <span className={`px-1 py-[0.5px] rounded font-hud-mono text-[8.5px] font-semibold shrink-0 ${vsBadge.cls}`}>
                              {vsBadge.text}
                            </span>
                          )}
                        </div>
                        <span className={`text-right ${ttftCls}`}>{ttftStr}</span>
                        <span className="text-right text-hud-fg/90">{tpsStr}</span>
                        <span className="text-right text-hud-muted">{cacheStr}</span>
                        <span className={`text-right ${upCls}`}>{upStr}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Cyber Cricket Arena PK View */
                <div className="l2-well px-2.5 py-2 flex flex-col gap-2 min-w-0">
                  {/* Quick matchup preset pills */}
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex flex-wrap items-center gap-1">
                      {hasLocalFighter && (
                        <button
                          type="button"
                          className="px-1.5 py-[2px] rounded-full bg-hud-card border border-hud-hairline font-hud text-[9.5px] text-hud-fg/90 hover:border-hud-accent cursor-pointer transition-colors"
                          onClick={() => applyPreset('me-vs-global')}
                        >
                          {isZh ? '我 vs 大盘' : 'Me vs Global'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-1.5 py-[2px] rounded-full bg-hud-card border border-hud-hairline font-hud text-[9.5px] text-hud-fg/90 hover:border-hud-accent cursor-pointer transition-colors"
                        onClick={() => applyPreset('speed-duel')}
                      >
                        {isZh ? '快慢极速战' : 'Fast vs Slow'}
                      </button>
                      {hasEndpointDuel && (
                        <button
                          type="button"
                          className="px-1.5 py-[2px] rounded-full bg-hud-card border border-hud-hairline font-hud text-[9.5px] text-hud-fg/90 hover:border-hud-accent cursor-pointer transition-colors"
                          onClick={() => applyPreset('endpoint-duel')}
                        >
                          {isZh ? '节点互搏' : 'Vertex vs AI Studio'}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded bg-hud-fill hover:bg-hud-card font-hud text-[9.5px] text-hud-muted hover:text-hud-fg cursor-pointer transition-colors"
                      onClick={handleCopyArenaReport}
                    >
                      {copiedPk ? <IconCheck size={10} className="text-hud-ok" /> : <IconCopy size={10} />}
                      <span>{copiedPk ? (isZh ? '已复制' : 'Copied') : isZh ? '复制战报' : 'Copy PK'}</span>
                    </button>
                  </div>

                  {/* Fighter selectors (Red vs Blue) */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                    <select
                      aria-label={isZh ? '左侧对战模型' : 'Left contestant'}
                      className="w-full min-w-0 px-1.5 py-1 rounded-md bg-hud-card border border-hud-ok/35 font-hud text-[10px] font-semibold text-hud-fg outline-none cursor-pointer truncate"
                      value={resolvedA?.id || ''}
                      onChange={(e) => setFighterAId((e.target as HTMLSelectElement).value)}
                    >
                      {fighters.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <span className="font-hud-mono text-[10px] font-bold text-hud-muted px-0.5">VS</span>
                    <select
                      aria-label={isZh ? '右侧对战模型' : 'Right contestant'}
                      className="w-full min-w-0 px-1.5 py-1 rounded-md bg-hud-card border border-seg-input/40 font-hud text-[10px] font-semibold text-hud-fg outline-none cursor-pointer truncate"
                      value={resolvedB?.id || ''}
                      onChange={(e) => setFighterBId((e.target as HTMLSelectElement).value)}
                    >
                      {fighters.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Scoreboard header */}
                  {resolvedA && resolvedB && matchupResult && (
                    <>
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-hud-card border border-hud-hairline">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-hud-mono text-[12px] font-bold text-hud-ok tabular-nums">
                            <span>{matchupResult.scoreA}</span>
                            {matchupResult.overallWinner === 'a' && (
                              <span className="px-1 py-[0.5px] rounded bg-tint-ok font-hud text-[8.5px] font-semibold">
                                {isZh ? '胜' : 'WIN'}
                              </span>
                            )}
                          </div>
                          <div className="font-hud text-[9px] text-hud-muted truncate">{resolvedA.tag}</div>
                        </div>

                        <div className="font-hud text-[9.5px] text-hud-muted text-center shrink-0">
                          {matchupResult.overallWinner === 'tie' ? (isZh ? '势均力敌' : 'DRAW') : isZh ? '综合战力' : 'SCORE'}
                        </div>

                        <div className="min-w-0 text-right">
                          <div className="flex items-center justify-end gap-1 font-hud-mono text-[12px] font-bold text-hud-accent-ink tabular-nums">
                            {matchupResult.overallWinner === 'b' && (
                              <span className="px-1 py-[0.5px] rounded bg-tint-accent font-hud text-[8.5px] font-semibold">
                                {isZh ? '胜' : 'WIN'}
                              </span>
                            )}
                            <span>{matchupResult.scoreB}</span>
                          </div>
                          <div className="font-hud text-[9px] text-hud-muted truncate">{resolvedB.tag}</div>
                        </div>
                      </div>

                      {/* Metric PK bars */}
                      <div className="flex flex-col gap-1.5">
                        {renderMetricDuelRow(
                          isZh ? '首字 TTFT' : 'TTFT',
                          resolvedA.ttftSec,
                          resolvedB.ttftSec,
                          (v) => fmtSec(v),
                          matchupResult.ttftWinner,
                          true,
                        )}
                        {renderMetricDuelRow(
                          isZh ? '吐字 TPS' : 'TPS',
                          resolvedA.tps,
                          resolvedB.tps,
                          (v) => `${fmtTps(v)} t/s`,
                          matchupResult.tpsWinner,
                          false,
                        )}
                        {renderMetricDuelRow(
                          isZh ? '缓存命中' : 'Cache',
                          resolvedA.cachePct,
                          resolvedB.cachePct,
                          (v) => `${Math.round(v)}%`,
                          matchupResult.cacheWinner,
                          false,
                        )}
                        {(resolvedA.uptimePct !== null || resolvedB.uptimePct !== null) &&
                          renderMetricDuelRow(
                            isZh ? '30m 可用率' : '30m Uptime',
                            resolvedA.uptimePct,
                            resolvedB.uptimePct,
                            (v) => `${v.toFixed(1)}%`,
                            matchupResult.upWinner,
                            false,
                          )}
                      </div>

                      {/* Commentary */}
                      <div className="px-2 py-1 rounded bg-hud-fill/65 font-hud text-[9.5px] text-hud-fg/85 leading-[1.4]">
                        💬 {arenaCommentary}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="text-[9.5px] font-hud text-hud-muted leading-[1.35]">
                {t.pulseFootnote(fetchedClock)}
                {isZh ? ' · 对比口径：OpenRouter 为 30m 路由 P50（含中转开销）' : ' · OpenRouter 30m P50 includes proxy overhead'}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export const GeminiPulseCard = memo(GeminiPulseCardImpl);
