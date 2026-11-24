import type { DailyHeatmapDay } from '../types/telemetry';
import type { ActivityInsights } from './activityStats';
import { fmtNum, fmtUsd } from './format';

export type PosterThemeId = 'cyber' | 'gold' | 'light';

export interface PosterRenderOptions {
  theme: PosterThemeId;
  span: '16w' | '52w';
  chartMode: 'heatmap' | 'iceberg';
  hideSpend: boolean;
  isZh: boolean;
  days: DailyHeatmapDay[];
  weeks: number;
  insights: ActivityInsights;
  tierLabel?: string;
}

interface ThemePalette {
  bg0: string;
  bg1: string;
  glowA: string;
  glowB: string;
  cardBg: string;
  cardBorder: string;
  fg: string;
  fg2: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  heat: [string, string, string, string, string];
  iceNew: string;
  iceCached: string;
  divider: string;
}

const PALETTES: Record<PosterThemeId, ThemePalette> = {
  cyber: {
    bg0: '#090D16',
    bg1: '#111827',
    glowA: 'rgba(16, 185, 129, 0.22)',
    glowB: 'rgba(99, 102, 241, 0.20)',
    cardBg: 'rgba(255, 255, 255, 0.045)',
    cardBorder: 'rgba(255, 255, 255, 0.10)',
    fg: '#F8FAFC',
    fg2: '#CBD5E1',
    muted: '#94A3B8',
    accent: '#34D399',
    accentSoft: 'rgba(52, 211, 153, 0.14)',
    accentText: '#6EE7B7',
    heat: ['rgba(255,255,255,0.06)', '#065F46', '#059669', '#10B981', '#34D399'],
    iceNew: '#34D399',
    iceCached: 'rgba(99, 102, 241, 0.58)',
    divider: 'rgba(255, 255, 255, 0.09)',
  },
  gold: {
    bg0: '#0D0B08',
    bg1: '#1A150E',
    glowA: 'rgba(245, 185, 70, 0.24)',
    glowB: 'rgba(217, 119, 6, 0.16)',
    cardBg: 'rgba(255, 245, 220, 0.045)',
    cardBorder: 'rgba(245, 200, 100, 0.16)',
    fg: '#FFFBF0',
    fg2: '#E7DCC4',
    muted: '#A89B82',
    accent: '#F5C451',
    accentSoft: 'rgba(245, 196, 81, 0.15)',
    accentText: '#FDE68A',
    heat: ['rgba(255,245,220,0.06)', '#5C3D0E', '#9A6512', '#D49422', '#F5C451'],
    iceNew: '#F5C451',
    iceCached: 'rgba(245, 196, 81, 0.34)',
    divider: 'rgba(245, 200, 100, 0.12)',
  },
  light: {
    bg0: '#F5F7FA',
    bg1: '#EEF2F7',
    glowA: 'rgba(16, 185, 129, 0.12)',
    glowB: 'rgba(59, 130, 246, 0.10)',
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(15, 23, 42, 0.08)',
    fg: '#0F172A',
    fg2: '#334155',
    muted: '#64748B',
    accent: '#059669',
    accentSoft: 'rgba(5, 150, 105, 0.10)',
    accentText: '#047857',
    heat: ['#E2E8F0', '#A7F3D0', '#34D399', '#10B981', '#047857'],
    iceNew: '#0F172A',
    iceCached: 'rgba(15, 23, 42, 0.24)',
    divider: 'rgba(15, 23, 42, 0.08)',
  },
};

const FONT_UI =
  '"Google Sans Flex", "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const FONT_MONO =
  '"Google Sans Code", "JetBrains Mono", Consolas, SFMono-Regular, Menlo, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", monospace';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function renderActivityPoster(canvas: HTMLCanvasElement, opts: PosterRenderOptions): void {
  const W = 1200;
  const H = 1480;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const p = PALETTES[opts.theme];
  const { insights, isZh, span, chartMode, hideSpend, days, weeks, tierLabel } = opts;

  // 1. Background gradient + ambient radial glows
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, p.bg0);
  bgGrad.addColorStop(1, p.bg1);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const glow1 = ctx.createRadialGradient(W * 0.16, H * 0.1, 20, W * 0.16, H * 0.1, 560);
  glow1.addColorStop(0, p.glowA);
  glow1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(W * 0.86, H * 0.82, 20, W * 0.86, H * 0.82, 540);
  glow2.addColorStop(0, p.glowB);
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Subtle decorative dot grid
  ctx.fillStyle = opts.theme === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(255,255,255,0.028)';
  for (let gx = 48; gx < W; gx += 40) {
    for (let gy = 48; gy < H; gy += 40) {
      ctx.fillRect(gx, gy, 2, 2);
    }
  }

  const padX = 72;
  const contentW = W - padX * 2;
  let y = 76;

  // 2. Top Brand Row
  ctx.font = `700 22px ${FONT_MONO}`;
  ctx.fillStyle = p.accentText;
  ctx.fillText('AGY-HUD // WRAPPED', padX, y + 22);

  // Span + Tier pill on right
  const rightTag = [
    tierLabel ? tierLabel : '',
    span === '52w' ? (isZh ? '近 52 周' : '52 WEEKS') : isZh ? '近 16 周' : '16 WEEKS',
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.font = `600 20px ${FONT_UI}`;
  const tagW = ctx.measureText(rightTag).width + 36;
  roundRect(ctx, W - padX - tagW, y - 6, tagW, 40, 20);
  ctx.fillStyle = p.accentSoft;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = p.accentText;
  ctx.textAlign = 'center';
  ctx.fillText(rightTag, W - padX - tagW / 2, y + 21);
  ctx.textAlign = 'left';

  y += 72;

  // 3. Persona Hero Banner Card
  const personaH = 224;
  roundRect(ctx, padX, y, contentW, personaH, 28);
  ctx.fillStyle = p.cardBg;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const personaTitle = `${insights.persona.emoji}  ${isZh ? insights.persona.titleZh : insights.persona.titleEn}`;
  const personaTagline = isZh ? insights.persona.taglineZh : insights.persona.taglineEn;

  ctx.font = `800 54px ${FONT_UI}`;
  ctx.fillStyle = p.fg;
  ctx.fillText(personaTitle, padX + 40, y + 92);

  ctx.font = `500 26px ${FONT_UI}`;
  ctx.fillStyle = p.fg2;
  ctx.fillText(personaTagline, padX + 42, y + 144);

  // Streak + Active Rate inline chips inside Persona card
  const chip1 = isZh
    ? `🔥 连肝 ${insights.currentStreak} 天 · 最长 ${insights.longestStreak} 天`
    : `🔥 ${insights.currentStreak}d Streak · Best ${insights.longestStreak}d`;
  const chip2 = isZh
    ? `📅 活跃 ${insights.activeDays}/${insights.spanDays} 天 (${insights.activeRatePct}%)`
    : `📅 Active ${insights.activeDays}/${insights.spanDays}d (${insights.activeRatePct}%)`;

  let cx = padX + 40;
  for (const chip of [chip1, chip2]) {
    ctx.font = `600 20px ${FONT_UI}`;
    const cw = ctx.measureText(chip).width + 30;
    roundRect(ctx, cx, y + 166, cw, 38, 12);
    ctx.fillStyle = p.accentSoft;
    ctx.fill();
    ctx.fillStyle = p.accentText;
    ctx.fillText(chip, cx + 15, y + 192);
    cx += cw + 14;
  }

  y += personaH + 30;

  // 4. Primary 3-Metric Hero KPI Strip
  const kpiH = 176;
  const kpiGap = 22;
  const kpiW = (contentW - kpiGap * 2) / 3;

  const kpis = [
    {
      k: isZh ? '累计吞吐 TOKEN' : 'TOTAL TOKENS',
      v: fmtNum(insights.totalAllTokens),
      sub: isZh ? `输出 ${fmtNum(insights.totalOutputTokens)}` : `Out ${fmtNum(insights.totalOutputTokens)}`,
      highlight: false,
    },
    {
      k: hideSpend ? (isZh ? '累计调用次数' : 'TOTAL CALLS') : isZh ? '等效 API 价值' : 'EQUIV. API VALUE',
      v: hideSpend ? fmtNum(insights.totalCalls) : fmtUsd(insights.totalCostUSD),
      sub: hideSpend
        ? isZh
          ? `日均 ${fmtNum(insights.avgDailyActiveTokens)} tok`
          : `${fmtNum(insights.avgDailyActiveTokens)} tok / active day`
        : isZh
          ? `日均 ${fmtUsd(insights.avgDailyActiveCostUSD)}`
          : `${fmtUsd(insights.avgDailyActiveCostUSD)} / active day`,
      highlight: true,
    },
    {
      k: isZh ? '缓存冰山命中率' : 'CACHE HIT RATE',
      v: insights.cacheHitPct !== null ? `${insights.cacheHitPct.toFixed(1)}%` : '--',
      sub: hideSpend
        ? isZh
          ? `缓存读取 ${fmtNum(insights.totalCachedTokens)}`
          : `Cached ${fmtNum(insights.totalCachedTokens)}`
        : isZh
          ? `预估节省 ${fmtUsd(insights.totalSavedUSD)}`
          : `Est. saved ${fmtUsd(insights.totalSavedUSD)}`,
      highlight: false,
    },
  ];

  kpis.forEach((item, idx) => {
    const kx = padX + idx * (kpiW + kpiGap);
    roundRect(ctx, kx, y, kpiW, kpiH, 24);
    ctx.fillStyle = p.cardBg;
    ctx.fill();
    ctx.strokeStyle = item.highlight ? p.accent : p.cardBorder;
    ctx.lineWidth = item.highlight ? 2 : 1.5;
    ctx.stroke();

    ctx.font = `700 18px ${FONT_UI}`;
    ctx.fillStyle = p.muted;
    ctx.fillText(item.k, kx + 28, y + 44);

    ctx.font = `800 50px ${FONT_MONO}`;
    ctx.fillStyle = item.highlight ? p.accentText : p.fg;
    ctx.fillText(item.v, kx + 28, y + 110);

    ctx.font = `500 20px ${FONT_UI}`;
    ctx.fillStyle = p.muted;
    ctx.fillText(item.sub, kx + 28, y + 148);
  });

  y += kpiH + 30;

  // 5. Visual Chart Card (Heatmap Matrix OR Iceberg Cache Chart)
  const chartCardH = 440;
  roundRect(ctx, padX, y, contentW, chartCardH, 28);
  ctx.fillStyle = p.cardBg;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const chartTitle =
    chartMode === 'iceberg'
      ? isZh
        ? '上下文冰山（上：新增 Token · 下：缓存读取）'
        : 'CONTEXT ICEBERG (TOP: NEW · BOTTOM: CACHED)'
      : isZh
        ? `算力贡献热力图 · ${span === '52w' ? '近 52 周' : '近 16 周'}`
        : `ACTIVITY MATRIX · ${span === '52w' ? '52 WEEKS' : '16 WEEKS'}`;
  ctx.font = `700 22px ${FONT_UI}`;
  ctx.fillStyle = p.fg2;
  ctx.fillText(chartTitle, padX + 36, y + 50);

  // Date span on top-right
  const rangeStr = days.length > 0 ? `${days[0].date}  →  ${days[days.length - 1].date}` : '';
  ctx.font = `500 18px ${FONT_MONO}`;
  ctx.fillStyle = p.muted;
  ctx.textAlign = 'right';
  ctx.fillText(rangeStr, padX + contentW - 36, y + 50);
  ctx.textAlign = 'left';

  const plotX = padX + 36;
  const plotY = y + 84;
  const plotW = contentW - 72;
  const plotH = chartCardH - 134;

  if (chartMode === 'iceberg') {
    const slice = span === '52w' ? bucketWeekly(days) : days.slice(-56).map((d) => ({
      newTok: d.newTokens || 0,
      cachedTok: d.cachedTokens || 0,
    }));
    const maxNew = Math.max(1, ...slice.map((b) => b.newTok));
    const maxCached = Math.max(1, ...slice.map((b) => b.cachedTok));
    const midY = plotY + plotH / 2;

    // Zero baseline
    ctx.strokeStyle = p.divider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(plotX, midY);
    ctx.lineTo(plotX + plotW, midY);
    ctx.stroke();

    const gap = 4;
    const barW = Math.max(4, (plotW - gap * (slice.length - 1)) / Math.max(1, slice.length));
    const halfH = plotH / 2 - 14;

    slice.forEach((b, i) => {
      const bx = plotX + i * (barW + gap);
      if (b.newTok > 0) {
        const h = Math.max(6, (b.newTok / maxNew) * halfH);
        roundRect(ctx, bx, midY - 3 - h, barW, h, 3);
        ctx.fillStyle = p.iceNew;
        ctx.fill();
      }
      if (b.cachedTok > 0) {
        const h = Math.max(6, (b.cachedTok / maxCached) * halfH);
        roundRect(ctx, bx, midY + 3, barW, h, 3);
        ctx.fillStyle = p.iceCached;
        ctx.fill();
      }
    });

    // Legend
    ctx.font = `600 18px ${FONT_UI}`;
    ctx.fillStyle = p.muted;
    ctx.fillText(
      isZh
        ? `▲ 新增 ${fmtNum(insights.totalNewTokens)}   ▼ 缓存复用 ${fmtNum(insights.totalCachedTokens)}`
        : `▲ New ${fmtNum(insights.totalNewTokens)}   ▼ Cached ${fmtNum(insights.totalCachedTokens)}`,
      plotX,
      y + chartCardH - 22,
    );
  } else {
    // Heatmap Matrix (7 rows x N weeks)
    const activeCosts = days
      .map((d) => d.costUSD || 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const refMax = activeCosts.length
      ? Math.max(0.05, activeCosts[Math.min(activeCosts.length - 1, Math.floor(activeCosts.length * 0.88))])
      : 1;

    const numCols = Math.max(1, weeks);
    const cellGap = span === '52w' ? 5 : 10;
    const cellW = Math.min(44, (plotW - cellGap * (numCols - 1)) / numCols);
    const cellH = Math.min(cellW, (plotH - cellGap * 6) / 7);
    const cell = Math.max(8, Math.min(cellW, cellH));
    const matrixW = numCols * cell + (numCols - 1) * cellGap;
    const matrixH = 7 * cell + 6 * cellGap;
    const startX = plotX + (plotW - matrixW) / 2;
    const startY = plotY + (plotH - matrixH) / 2;
    const cellRadius = span === '52w' ? 4 : 8;

    for (let c = 0; c < numCols; c++) {
      for (let r = 0; r < 7; r++) {
        const idx = c * 7 + r;
        if (idx >= days.length) continue;
        const d = days[idx];
        let lvl = 0;
        if ((d.costUSD || 0) > 0) {
          const ratio = d.costUSD / refMax;
          lvl = ratio <= 0.22 ? 1 : ratio <= 0.48 ? 2 : ratio <= 0.78 ? 3 : 4;
        } else if ((d.calls || 0) > 0) {
          lvl = 1;
        }

        const cxCell = startX + c * (cell + cellGap);
        const cyCell = startY + r * (cell + cellGap);
        roundRect(ctx, cxCell, cyCell, cell, cell, cellRadius);
        ctx.fillStyle = p.heat[lvl];
        ctx.fill();

        if (lvl === 4 && opts.theme !== 'light') {
          ctx.save();
          ctx.shadowColor = p.accent;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Bottom legend
    const legY = y + chartCardH - 22;
    ctx.font = `500 18px ${FONT_UI}`;
    ctx.fillStyle = p.muted;
    ctx.fillText(isZh ? '低' : 'Less', plotX, legY);
    let lx = plotX + (isZh ? 34 : 52);
    for (let i = 0; i < 5; i++) {
      roundRect(ctx, lx, legY - 14, 16, 16, 4);
      ctx.fillStyle = p.heat[i];
      ctx.fill();
      lx += 22;
    }
    ctx.fillStyle = p.muted;
    ctx.fillText(isZh ? '高' : 'More', lx + 6, legY);
  }

  y += chartCardH + 30;

  // 6. Bottom 2x2 Highlights Strip
  const subH = 198;
  const subGap = 22;
  const subW = (contentW - subGap) / 2;

  // Left card: Peak Day
  roundRect(ctx, padX, y, subW, subH, 24);
  ctx.fillStyle = p.cardBg;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `700 19px ${FONT_UI}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(isZh ? '🏆 巅峰单日 PEAK DAY' : '🏆 PEAK DAY', padX + 32, y + 48);

  ctx.font = `800 44px ${FONT_MONO}`;
  ctx.fillStyle = p.fg;
  const peakMain = hideSpend ? fmtNum(insights.peakTokens) : insights.peakCostUSD > 0 ? fmtUsd(insights.peakCostUSD) : '--';
  ctx.fillText(peakMain, padX + 32, y + 114);

  ctx.font = `500 20px ${FONT_UI}`;
  ctx.fillStyle = p.fg2;
  const peakSub = insights.peakDate
    ? isZh
      ? `${insights.peakDate} · ${insights.peakCalls} 次调用 · ${fmtNum(insights.peakTokens)} tok`
      : `${insights.peakDate} · ${insights.peakCalls} calls · ${fmtNum(insights.peakTokens)} tok`
    : '--';
  ctx.fillText(peakSub, padX + 32, y + 158);

  // Right card: App vs CLI Split & Call Volume
  const rx = padX + subW + subGap;
  roundRect(ctx, rx, y, subW, subH, 24);
  ctx.fillStyle = p.cardBg;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `700 19px ${FONT_UI}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(isZh ? '⚡ 调用分布 WORKFLOW' : '⚡ WORKFLOW SPLIT', rx + 32, y + 48);

  ctx.font = `800 44px ${FONT_MONO}`;
  ctx.fillStyle = p.fg;
  ctx.fillText(`${fmtNum(insights.totalCalls)}`, rx + 32, y + 114);
  ctx.font = `600 22px ${FONT_UI}`;
  ctx.fillStyle = p.muted;
  const callsW = ctx.measureText(`${fmtNum(insights.totalCalls)}`).width;
  ctx.fillText(isZh ? ' 次对话调用' : ' calls', rx + 32 + callsW + 30, y + 112);

  // Split bar
  const barX = rx + 32;
  const barY = y + 140;
  const barFullW = subW - 64;
  const appPct = 100 - insights.cliSharePct;
  roundRect(ctx, barX, barY, barFullW, 12, 6);
  ctx.fillStyle = p.heat[0];
  ctx.fill();
  if (appPct > 0) {
    roundRect(ctx, barX, barY, Math.max(12, (barFullW * appPct) / 100), 12, 6);
    ctx.fillStyle = p.accent;
    ctx.fill();
  }
  ctx.font = `500 17px ${FONT_MONO}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(`Desktop ${appPct}% · CLI ${insights.cliSharePct}%`, barX, y + 178);

  // 7. Footer Watermark
  const footY = H - 56;
  ctx.strokeStyle = p.divider;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, footY - 38);
  ctx.lineTo(W - padX, footY - 38);
  ctx.stroke();

  ctx.font = `600 20px ${FONT_UI}`;
  ctx.fillStyle = p.muted;
  ctx.fillText('Powered by AGY-HUD · Native Telemetry for Google Antigravity', padX, footY);

  const todayStr = new Date().toISOString().slice(0, 10);
  ctx.font = `600 20px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(todayStr, W - padX, footY);
  ctx.textAlign = 'left';
}

function bucketWeekly(days: DailyHeatmapDay[]) {
  const out: Array<{ newTok: number; cachedTok: number }> = [];
  for (let i = 0; i < days.length; i += 7) {
    let newTok = 0;
    let cachedTok = 0;
    for (let j = i; j < Math.min(days.length, i + 7); j++) {
      newTok += days[j].newTokens || 0;
      cachedTok += days[j].cachedTokens || 0;
    }
    out.push({ newTok, cachedTok });
  }
  return out;
}

export function buildWrappedTextReport(opts: {
  insights: ActivityInsights;
  span: '16w' | '52w';
  hideSpend: boolean;
  isZh: boolean;
  tierLabel?: string;
}): string {
  const { insights, span, hideSpend, isZh, tierLabel } = opts;
  const spanLabel = span === '52w' ? (isZh ? '近 52 周' : '52w') : isZh ? '近 16 周' : '16w';
  const persona = `${insights.persona.emoji} ${isZh ? insights.persona.titleZh : insights.persona.titleEn}`;
  if (isZh) {
    return [
      `🚀 我的 Antigravity ${spanLabel} 算力战报${tierLabel ? ` (${tierLabel})` : ''}`,
      `段位称号：${persona}`,
      `🔥 连肝 ${insights.currentStreak} 天（最长 ${insights.longestStreak} 天 · 活跃 ${insights.activeDays} 天）`,
      `⚡ 总吞吐 ${fmtNum(insights.totalAllTokens)} tokens · ${fmtNum(insights.totalCalls)} 次调用`,
      hideSpend
        ? `🧊 缓存命中 ${insights.cacheHitPct !== null ? `${insights.cacheHitPct.toFixed(1)}%` : '--'}（复用 ${fmtNum(insights.totalCachedTokens)} tok）`
        : `💰 等效 API ${fmtUsd(insights.totalCostUSD)} · 缓存命中 ${insights.cacheHitPct !== null ? `${insights.cacheHitPct.toFixed(1)}%` : '--'}（省 ${fmtUsd(insights.totalSavedUSD)}）`,
      insights.peakDate
        ? `🏆 巅峰单日 ${insights.peakDate}：${hideSpend ? `${fmtNum(insights.peakTokens)} tok` : fmtUsd(insights.peakCostUSD)}`
        : '',
      `— via AGY-HUD`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `🚀 My Antigravity ${spanLabel} Wrapped${tierLabel ? ` (${tierLabel})` : ''}`,
    `Persona: ${persona}`,
    `🔥 ${insights.currentStreak}d Streak (Best ${insights.longestStreak}d · ${insights.activeDays} active days)`,
    `⚡ ${fmtNum(insights.totalAllTokens)} tokens · ${fmtNum(insights.totalCalls)} calls`,
    hideSpend
      ? `🧊 Cache hit ${insights.cacheHitPct !== null ? `${insights.cacheHitPct.toFixed(1)}%` : '--'} (${fmtNum(insights.totalCachedTokens)} cached)`
      : `💰 Equiv. API ${fmtUsd(insights.totalCostUSD)} · Cache ${insights.cacheHitPct !== null ? `${insights.cacheHitPct.toFixed(1)}%` : '--'} (saved ${fmtUsd(insights.totalSavedUSD)})`,
    insights.peakDate
      ? `🏆 Peak Day ${insights.peakDate}: ${hideSpend ? `${fmtNum(insights.peakTokens)} tok` : fmtUsd(insights.peakCostUSD)}`
      : '',
    `— via AGY-HUD`,
  ]
    .filter(Boolean)
    .join('\n');
}
