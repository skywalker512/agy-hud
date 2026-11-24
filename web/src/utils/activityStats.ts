import type { AccountHistory, DailyHeatmapDay } from '../types/telemetry';

export type PersonaTier = 'mythic' | 'gold' | 'emerald' | 'cyan' | 'slate';

export interface ActivityPersona {
  id: string;
  emoji: string;
  tier: PersonaTier;
  titleZh: string;
  titleEn: string;
  taglineZh: string;
  taglineEn: string;
}

export interface ActivityInsights {
  spanDays: number;
  activeDays: number;
  activeRatePct: number;
  currentStreak: number;
  longestStreak: number;
  totalCalls: number;
  totalCostUSD: number;
  totalSavedUSD: number;
  totalOutputTokens: number;
  totalNewTokens: number;
  totalCachedTokens: number;
  totalPromptTokens: number;
  totalAllTokens: number;
  cacheHitPct: number | null;
  avgDailyActiveCostUSD: number;
  avgDailyActiveTokens: number;
  appCalls: number;
  cliCalls: number;
  cliSharePct: number;
  peakDate: string;
  peakCostUSD: number;
  peakCalls: number;
  peakTokens: number;
  persona: ActivityPersona;
}

export function computeActivityInsights(
  days: DailyHeatmapDay[],
  history?: AccountHistory,
  streakOverride?: number,
): ActivityInsights {
  let activeDays = 0;
  let longestStreak = 0;
  let running = 0;
  let totalCalls = 0;
  let totalCostUSD = 0;
  let totalOutputTokens = 0;
  let totalNewTokens = 0;
  let totalCachedTokens = 0;
  let appCalls = 0;
  let cliCalls = 0;

  let peakDate = '';
  let peakCostUSD = 0;
  let peakCalls = 0;
  let peakTokens = 0;

  for (const d of days) {
    const calls = d.calls || 0;
    const cost = d.costUSD || 0;
    const outTok = d.outputTokens || 0;
    const newTok = d.newTokens || 0;
    const cachedTok = d.cachedTokens || 0;
    const isActive = calls > 0 || cost > 0;

    if (isActive) {
      activeDays += 1;
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }

    totalCalls += calls;
    totalCostUSD += cost;
    totalOutputTokens += outTok;
    totalNewTokens += newTok;
    totalCachedTokens += cachedTok;
    appCalls += d.appCalls || 0;
    cliCalls += d.cliCalls || 0;

    const dayTokens = outTok + newTok + cachedTok;
    if (cost > peakCostUSD || (peakCostUSD === 0 && dayTokens > peakTokens)) {
      peakCostUSD = cost;
      peakDate = d.date;
      peakCalls = calls;
      peakTokens = dayTokens;
    }
  }

  let currentStreak = 0;
  if (typeof streakOverride === 'number' && Number.isFinite(streakOverride)) {
    currentStreak = Math.max(0, Math.round(streakOverride));
  } else {
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if ((d.calls || 0) > 0 || (d.costUSD || 0) > 0) {
        currentStreak += 1;
      } else if (i === days.length - 1) {
        continue;
      } else {
        break;
      }
    }
  }
  if (currentStreak > longestStreak) longestStreak = currentStreak;

  const spanDays = Math.max(1, days.length);
  const activeRatePct = Math.round((activeDays / spanDays) * 100);
  const totalPromptTokens = totalNewTokens + totalCachedTokens;
  const totalAllTokens = totalPromptTokens + totalOutputTokens;
  const cacheHitPct = totalPromptTokens > 0 ? Math.round((totalCachedTokens / totalPromptTokens) * 1000) / 10 : null;
  const denomCalls = Math.max(1, appCalls + cliCalls);
  const cliSharePct = Math.round((cliCalls / denomCalls) * 100);
  const avgDailyActiveCostUSD = activeDays > 0 ? totalCostUSD / activeDays : 0;
  const avgDailyActiveTokens = activeDays > 0 ? Math.round(totalAllTokens / activeDays) : 0;

  // Use history.totalSavedUSD scaled cleanly if available, otherwise estimate cache savings (~90% prompt discount)
  const historyTotalCost = history?.totalCostUSD || 0;
  const historySaved = history?.totalSavedUSD || 0;
  const totalSavedUSD =
    historyTotalCost > 0 && historySaved > 0
      ? Math.min(historySaved, totalCostUSD * (historySaved / historyTotalCost))
      : cacheHitPct !== null && cacheHitPct > 0
        ? totalCostUSD * ((cacheHitPct / 100) * 0.8)
        : 0;

  const persona = derivePersona({
    currentStreak,
    longestStreak,
    peakCostUSD,
    totalCostUSD,
    totalAllTokens,
    cacheHitPct,
    cliSharePct,
    activeDays,
  });

  return {
    spanDays,
    activeDays,
    activeRatePct,
    currentStreak,
    longestStreak,
    totalCalls,
    totalCostUSD,
    totalSavedUSD,
    totalOutputTokens,
    totalNewTokens,
    totalCachedTokens,
    totalPromptTokens,
    totalAllTokens,
    cacheHitPct,
    avgDailyActiveCostUSD,
    avgDailyActiveTokens,
    appCalls,
    cliCalls,
    cliSharePct,
    peakDate,
    peakCostUSD,
    peakCalls,
    peakTokens,
    persona,
  };
}

function derivePersona(m: {
  currentStreak: number;
  longestStreak: number;
  peakCostUSD: number;
  totalCostUSD: number;
  totalAllTokens: number;
  cacheHitPct: number | null;
  cliSharePct: number;
  activeDays: number;
}): ActivityPersona {
  if (m.totalCostUSD >= 400 || m.peakCostUSD >= 60 || m.totalAllTokens >= 250_000_000) {
    return {
      id: 'ultra_titan',
      emoji: '👑',
      tier: 'mythic',
      titleZh: 'Ultra 算力霸主',
      titleEn: 'Ultra Compute Titan',
      taglineZh: '单日烧穿算力天花板，Token 当水喝',
      taglineEn: 'Burning tokens at industrial scale',
    };
  }
  if (m.cacheHitPct !== null && m.cacheHitPct >= 86 && m.totalAllTokens >= 20_000_000) {
    return {
      id: 'cache_alchemist',
      emoji: '🧊',
      tier: 'emerald',
      titleZh: '缓存炼金术士',
      titleEn: 'Cache Alchemist',
      taglineZh: '极高上下文复用，每一刀都砍在缓存上',
      taglineEn: 'Turning warm context into pure savings',
    };
  }
  if (m.longestStreak >= 14 || m.currentStreak >= 10) {
    return {
      id: 'streak_machine',
      emoji: '🔥',
      tier: 'gold',
      titleZh: '永动连肝战神',
      titleEn: 'Unstoppable Streak',
      taglineZh: '连续高强度输出，键盘从未冷却',
      taglineEn: 'Relentless daily shipping momentum',
    };
  }
  if (m.cliSharePct >= 35 && m.activeDays >= 3) {
    return {
      id: 'cli_phantom',
      emoji: '⌨️',
      tier: 'cyan',
      titleZh: '终端极客',
      titleEn: 'Terminal Speedrunner',
      taglineZh: '偏好 CLI 极速直连，双手不离键盘',
      taglineEn: 'Lives in the CLI, ships at warp speed',
    };
  }
  if (m.totalAllTokens >= 50_000_000) {
    return {
      id: 'iceberg_architect',
      emoji: '⚡',
      tier: 'emerald',
      titleZh: '冰山架构师',
      titleEn: 'Iceberg Architect',
      taglineZh: '庞大上下文驾轻就熟，稳步构筑工程',
      taglineEn: 'Commanding massive contexts with ease',
    };
  }
  if (m.activeDays >= 5) {
    return {
      id: 'steady_shipper',
      emoji: '🚀',
      tier: 'cyan',
      titleZh: '高频推进者',
      titleEn: 'Steady Shipper',
      taglineZh: '节奏稳定，持续让 AI 替你打工',
      taglineEn: 'Consistent daily AI-assisted velocity',
    };
  }
  return {
    id: 'spark_explorer',
    emoji: '✨',
    tier: 'slate',
    titleZh: '星火探索者',
    titleEn: 'First Spark',
    taglineZh: '刚刚启程，准备点亮整片热力图',
    taglineEn: 'Just getting started on the grid',
  };
}
