import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { IconArrowUpRight, IconGitHub } from '../components/Icons';
import { BrandLogo } from '../components/Navbar';
import { ThemePicker } from '../components/ThemePicker';
import { detectInitialLocale, saveLocale, type Locale } from '../i18n/content';
import {
  applyAgyThemeToDocument,
  getInitialContrast,
  getInitialThemeId,
  getThemeById,
  saveContrast,
  saveThemeId,
  type ContrastMode,
} from '../themes/agyThemes';
import {
  fetchLiveGeminiPulse,
  GEMINI_SPECS,
  getSavedFeedUrl,
  loadCachedPulse,
  sanitizeGcpIncidentUrl,
  saveFeedUrl,
  type PulseDashboardData,
  type PulseModelData,
} from './pulseApi';
import { PulseChart, type PulseChartMetric } from './PulseChart';
import { computePulseInsights, fmtClock } from './pulseInsights';
import { PulseInsightsStrip, PulseScorecards } from './PulseScorecards';
import { PulseRoutesTable, PulseTelemetryMatrix } from './PulseTables';

export function PulseApp() {
  const [themeId, setThemeId] = useState<string>(() => getInitialThemeId());
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [contrast, setContrast] = useState<ContrastMode>(() => getInitialContrast());
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
  const isZh = locale === 'zh';

  const [feedUrl, setFeedUrl] = useState<string>(() => getSavedFeedUrl());
  const [feedDraft, setFeedDraft] = useState<string>(() => getSavedFeedUrl());
  const [feedOpen, setFeedOpen] = useState<boolean>(false);

  const [data, setData] = useState<PulseDashboardData | null>(() => loadCachedPulse());
  const [loading, setLoading] = useState<boolean>(true);
  const [metric, setMetric] = useState<PulseChartMetric>('ttft');
  const [granularity, setGranularity] = useState<'7d' | '5m'>('5m');
  const [userPickedGranularity, setUserPickedGranularity] = useState<boolean>(false);
  const [intradayHours, setIntradayHours] = useState<2 | 6 | 24>(24);
  const [splitProviders, setSplitProviders] = useState<boolean>(false);
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>(() =>
    GEMINI_SPECS.slice(0, 4).map((s) => s.family),
  );
  const [routeModelFamily, setRouteModelFamily] = useState<string>('gemini-4-neon');

  const activeTheme = getThemeById(themeId);
  const displayTheme = previewThemeId ? getThemeById(previewThemeId) : activeTheme;

  useEffect(() => {
    applyAgyThemeToDocument(displayTheme, contrast);
  }, [displayTheme, contrast]);
  useEffect(() => {
    saveThemeId(themeId);
  }, [themeId]);
  useEffect(() => {
    saveContrast(contrast);
  }, [contrast]);
  useEffect(() => {
    document.documentElement.lang = isZh ? 'zh-CN' : 'en';
    document.title = isZh
      ? 'Gemini 实时脉冲雷达 — AGY-HUD 全球监控'
      : 'Gemini Pulse — Live Global Gemini Telemetry · AGY-HUD';
    saveLocale(locale);
  }, [locale, isZh]);

  const loadData = useCallback(async (urlOverride?: string) => {
    setLoading(true);
    try {
      const next = await fetchLiveGeminiPulse(urlOverride !== undefined ? urlOverride : feedUrl);
      setData(next);
    } finally {
      setLoading(false);
    }
  }, [feedUrl]);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => {
      void loadData();
    }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const models = data?.models || [];
  const incidents = data?.incidents || [];

  const maxIntradayPts = useMemo(
    () => models.reduce((acc, m) => Math.max(acc, m.series.intraday30m.length), 0),
    [models],
  );

  useEffect(() => {
    if (userPickedGranularity || loading || !models.length) return;
    if (maxIntradayPts >= 2 && granularity !== '5m') {
      setGranularity('5m');
    } else if (maxIntradayPts < 2 && granularity !== '7d') {
      setGranularity('7d');
    }
  }, [maxIntradayPts, loading, models.length, userPickedGranularity, granularity]);

  const insights = useMemo(() => computePulseInsights(models), [models]);

  const singleModel: PulseModelData | null =
    selectedFamilies.length === 1 ? models.find((m) => m.family === selectedFamilies[0]) || null : null;

  const canSplitProviders = useMemo(() => {
    if (!singleModel) return false;
    if (granularity === '5m') {
      const provs = new Set<string>();
      for (const b of singleModel.series.intraday30m) {
        for (const k of Object.keys(b.byProvider || {})) provs.add(k);
      }
      return provs.size >= 2;
    }
    const arr =
      metric === 'ttft'
        ? singleModel.series.ttft7d
        : metric === 'e2e'
          ? singleModel.series.e2e7d
          : metric === 'tps'
            ? singleModel.series.tps7d
            : metric === 'cache'
              ? singleModel.series.cache7d
              : singleModel.series.uptime7d;
    const provs = new Set<string>();
    for (const pt of arr) {
      for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
    }
    return provs.size >= 2;
  }, [singleModel, granularity, metric]);

  const overallStatus = useMemo<'ok' | 'degraded' | 'outage' | 'loading'>(() => {
    if (!models.length && loading) return 'loading';
    if (incidents.some((i) => i.severity === 'high' || /OUTAGE/i.test(i.impact)) || models.some((m) => m.status === 'outage')) {
      return 'outage';
    }
    if (incidents.length > 0 || models.some((m) => m.status === 'degraded')) return 'degraded';
    return 'ok';
  }, [models, incidents, loading]);

  const toggleFamily = (fam: string) => {
    setSelectedFamilies((prev) =>
      prev.includes(fam) ? (prev.length > 1 ? prev.filter((x) => x !== fam) : prev) : [...prev, fam],
    );
  };

  const activeRouteModel = models.find((m) => m.family === routeModelFamily) || models[0] || null;

  const handleSaveFeed = (e: Event) => {
    e.preventDefault();
    const clean = feedDraft.trim().replace(/\/+$/, '');
    saveFeedUrl(clean);
    setFeedUrl(clean);
    setFeedOpen(false);
    void loadData(clean);
  };

  return (
    <div class="site-ambient min-h-screen text-[var(--fg)]">
      {/* Top Navbar */}
      <header class="glass-nav sticky top-0 z-50">
        <div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div class="flex items-center gap-3">
            <a
              href="../"
              class="flex items-center gap-2 text-[var(--fg)] no-underline transition-opacity hover:opacity-85"
            >
              <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <BrandLogo size={16} />
              </span>
              <span class="text-[14px] font-semibold tracking-tight">AGY-HUD</span>
            </a>
            <span class="text-[var(--faint)]">/</span>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--fg)]">
              <span
                class="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    overallStatus === 'outage'
                      ? '#ef4444'
                      : overallStatus === 'degraded'
                        ? '#f59e0b'
                        : '#34d399',
                }}
              />
              <span>{isZh ? 'Gemini 实时雷达' : 'Gemini Pulse'}</span>
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFeedOpen((v) => !v)}
              class={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors ${
                data?.mode === 'worker'
                  ? 'border-[var(--seg-cache)]/50 bg-[var(--seg-cache)]/10 text-[var(--fg)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'
              }`}
              title={isZh ? '接入你自己的 Cloudflare Worker 采集源以解锁 5 分钟粒度曲线、P99 长尾与 Tool 错误率' : 'Connect your Cloudflare Worker feed for 5-minute curves, P99 tail latency & tool error rate'}
            >
              <span class="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              <span class="hidden sm:inline">
                {data?.mode === 'worker'
                  ? isZh ? 'Worker 5m 已连' : 'Worker 5m Live'
                  : isZh ? 'Worker 采集源' : 'Worker Feed'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 font-mono text-[11.5px] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)] disabled:opacity-50"
            >
              <span class={loading ? 'animate-spin' : ''}>↻</span>
              <span class="hidden md:inline">{loading ? (isZh ? '同步中' : 'Sync') : fmtClock(data?.fetchedAtMs || 0)}</span>
            </button>

            <ThemePicker
              locale={locale}
              activeTheme={activeTheme}
              contrast={contrast}
              onSelectTheme={setThemeId}
              onPreviewTheme={setPreviewThemeId}
              onSelectContrast={setContrast}
            />

            <button
              type="button"
              onClick={() => setLocale((l) => (l === 'en' ? 'zh' : 'en'))}
              class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            >
              <span class={locale === 'en' ? 'font-semibold text-[var(--fg)]' : ''}>EN</span>
              <span class="text-[var(--faint)]">/</span>
              <span class={locale === 'zh' ? 'font-semibold text-[var(--fg)]' : ''}>中文</span>
            </button>

            <a
              href="https://github.com/skywalker512/agy-hud"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--fg)] transition-colors hover:border-[var(--border-strong)]"
            >
              <IconGitHub size={14} />
            </a>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Optional Cloudflare Worker Feed Config Drawer */}
        {feedOpen && (
          <form
            onSubmit={handleSaveFeed}
            class="mb-6 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-4 sm:p-5"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 class="text-[14px] font-semibold text-[var(--fg)]">
                  {isZh ? '接入 Cloudflare Worker 5m 采集源（可选 · 免费免绑卡）' : 'Connect Cloudflare Worker 5m Feed (Optional · $0 Free Tier)'}
                </h2>
                <p class="mt-1 text-[12.5px] text-[var(--muted)]">
                  {isZh
                    ? '默认浏览器直连 OpenRouter + GCP 官方接口即可看 7 天曲线与实时可用率；填上你部署的 Worker 地址可额外解锁真 5 分钟粒度趋势曲线、P99 长尾延迟、Tool Call 报错率与 Vertex/AI Studio 节点拆解。'
                    : 'Direct browser mode already streams live 7d curves & 5m/30m/1d uptime with zero backend. Add your deployed Worker URL to unlock true 5-minute intraday curves, P99 tail latency, Tool Call error rate, and Vertex vs AI Studio splits.'}
                </p>
              </div>
              <a
                href="https://github.com/skywalker512/agy-hud/tree/main/workers/gemini-pulse"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-ink)] hover:underline"
              >
                <span>{isZh ? '3 分钟部署模板' : '3-min Deploy Guide'}</span>
                <IconArrowUpRight size={12} />
              </a>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={feedDraft}
                onInput={(e) => setFeedDraft((e.target as HTMLInputElement).value)}
                placeholder="https://agy-hud.512.pub"
                class="h-9 min-w-[240px] flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 font-mono text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                class="h-9 cursor-pointer rounded-lg bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                {isZh ? '保存并拉取' : 'Connect'}
              </button>
              {feedUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setFeedDraft('');
                    saveFeedUrl('');
                    setFeedUrl('');
                    setFeedOpen(false);
                    void loadData('');
                  }}
                  class="h-9 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  {isZh ? '切回直连' : 'Use Direct'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Header + GCP Service Health Status Strip */}
        <section class="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="font-mono text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent-ink)]">
              {isZh ? 'GLOBAL GEMINI TELEMETRY · 实时公开观测站' : 'GLOBAL GEMINI TELEMETRY · LIVE PUBLIC RADAR'}
            </p>
            <h1 class="display-heading mt-1.5 text-[28px] font-bold tracking-tight text-[var(--fg)] sm:text-[36px]">
              {isZh ? 'Gemini 全球大盘健康与速度监控' : 'Gemini Global Health & Speed Pulse'}
            </h1>
            <p class="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--muted)]">
              {isZh
                ? '实时汇总 OpenRouter 全球公开统计与 Google Cloud 官方故障通告，覆盖 Gemini 4 Neon / Hydrogen / Carbon / Argon 与 3.8 Flash 的首字延迟、E2E 总耗时、生成速度、缓存命中与 Google Vertex / AI Studio 线路可用率。'
                : 'Live public telemetry from OpenRouter & Google Cloud Service Health across Gemini 4 Neon, Hydrogen, Carbon, Argon, and 3.8 Flash — TTFT, E2E latency, TPS, cache hit rate, and Vertex vs AI Studio route uptime.'}
            </p>
          </div>

          <div
            class={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              overallStatus === 'outage'
                ? 'border-red-500/40 bg-red-500/10'
                : overallStatus === 'degraded'
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-[var(--border-strong)] bg-[var(--surface)]'
            }`}
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                background:
                  overallStatus === 'outage'
                    ? '#ef4444'
                    : overallStatus === 'degraded'
                      ? '#f59e0b'
                      : overallStatus === 'loading'
                        ? 'var(--faint)'
                        : '#34d399',
              }}
            />
            <div class="min-w-0">
              <div class="text-[13px] font-semibold text-[var(--fg)]">
                {overallStatus === 'outage'
                  ? isZh ? '检测到 Gemini / Vertex AI 严重故障' : 'Active Gemini / Vertex AI Outage'
                  : overallStatus === 'degraded'
                    ? isZh ? '部分 Gemini 线路延迟偏高或降级' : 'Partial Gemini Degradation Detected'
                    : overallStatus === 'loading'
                      ? isZh ? '正在探测全球 Gemini 节点…' : 'Probing global Gemini endpoints…'
                      : isZh ? 'Google Vertex & AI Studio 全线正常' : 'All Gemini & Vertex AI Systems Operational'}
              </div>
              <div class="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                {data?.mode === 'worker'
                  ? isZh
                    ? `Worker 5m 采集源 · 已缓存 ${maxIntradayPts} 个 5m 切片`
                    : `Worker 5m Feed · ${maxIntradayPts} intraday buckets`
                  : isZh
                    ? '浏览器实时直连 OpenRouter + GCP Status'
                    : 'Direct Browser Live · OpenRouter + GCP Status'}
              </div>
            </div>
          </div>
        </section>

        {/* Active GCP Incidents Alert List */}
        {incidents.length > 0 && (
          <section class="mb-6 flex flex-col gap-2">
            {incidents.map((inc) => (
              <a
                key={inc.id}
                href={sanitizeGcpIncidentUrl(inc.url)}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-start justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[var(--fg)] no-underline transition-colors hover:border-amber-500/70"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-[12.5px] font-semibold">
                    <span class="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-amber-400">
                      {inc.severity}
                    </span>
                    <span>{inc.service}</span>
                  </div>
                  <p class="mt-1 text-[12.5px] text-[var(--muted)]">{inc.summary}</p>
                </div>
                <IconArrowUpRight size={14} class="mt-0.5 shrink-0 text-[var(--muted)]" />
              </a>
            ))}
          </section>
        )}

        <PulseScorecards
          models={models}
          selectedFamilies={selectedFamilies}
          isZh={isZh}
          onSelectModel={(fam) => {
            toggleFamily(fam);
            setRouteModelFamily(fam);
          }}
        />

        {insights && <PulseInsightsStrip insights={insights} isZh={isZh} />}

        {/* Main Interactive Multi-Model Curve Panel */}
        <section class="mb-7 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
              {(
                [
                  ['ttft', isZh ? 'TTFT 首字延迟' : 'TTFT Latency'],
                  ['e2e', isZh ? 'E2E 总耗时' : 'E2E Latency'],
                  ['tps', isZh ? 'TPS 生成速度' : 'Throughput'],
                  ['cache', isZh ? '缓存命中率' : 'Cache Hit %'],
                  ['uptime', isZh ? '可用率 Uptime' : 'Uptime %'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMetric(key)}
                  class={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    metric === key
                      ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {metric !== 'e2e' && (
                <div class="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 font-mono text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setUserPickedGranularity(true);
                      setGranularity('5m');
                    }}
                    class={`cursor-pointer rounded-md px-2.5 py-1 transition-colors ${
                      granularity === '5m' ? 'bg-[var(--surface)] font-semibold text-[var(--fg)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    {maxIntradayPts > 0 ? `5m (${maxIntradayPts})` : '5m'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUserPickedGranularity(true);
                      setGranularity('7d');
                    }}
                    class={`cursor-pointer rounded-md px-2.5 py-1 transition-colors ${
                      granularity === '7d' ? 'bg-[var(--surface)] font-semibold text-[var(--fg)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    7d
                  </button>
                </div>
              )}

              {granularity === '5m' && metric !== 'e2e' && (
                <div class="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 font-mono text-[11px]">
                  {([2, 6, 24] as const).map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => setIntradayHours(hrs)}
                      class={`cursor-pointer rounded-md px-2 py-1 transition-colors ${
                        intradayHours === hrs ? 'bg-[var(--surface)] font-semibold text-[var(--fg)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      {hrs}h
                    </button>
                  ))}
                </div>
              )}

              {singleModel && canSplitProviders && (
                <button
                  type="button"
                  onClick={() => setSplitProviders((v) => !v)}
                  class={`cursor-pointer rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    splitProviders
                      ? 'border-[var(--accent)] bg-[var(--tint-accent)] text-[var(--accent-ink)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {isZh ? 'Vertex vs AI Studio 拆解' : 'Split Vertex vs AI Studio'}
                </button>
              )}
            </div>
          </div>

          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              {GEMINI_SPECS.map((spec) => {
                const isSel = selectedFamilies.includes(spec.family);
                return (
                  <button
                    key={spec.family}
                    type="button"
                    onClick={() => toggleFamily(spec.family)}
                    onDblClick={() => setSelectedFamilies([spec.family])}
                    class={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      isSel
                        ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                        : 'border-transparent bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                    style={isSel ? { borderColor: `${spec.color}88` } : undefined}
                    title={isZh ? '单击叠加/取消；双击独显该模型' : 'Click to toggle; double-click to solo'}
                  >
                    <span
                      class="h-2 w-2 rounded-full"
                      style={{ background: spec.color, opacity: isSel ? 1 : 0.35 }}
                    />
                    <span>{spec.label}</span>
                  </button>
                );
              })}
              {selectedFamilies.length < GEMINI_SPECS.length && (
                <button
                  type="button"
                  onClick={() => setSelectedFamilies(GEMINI_SPECS.map((s) => s.family))}
                  class="cursor-pointer rounded-full px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  {isZh ? '全选' : 'Select All'}
                </button>
              )}
            </div>
            <span class="text-[11px] text-[var(--faint)]">
              {isZh ? '双击模型胶囊可独显并对比供应商线路' : 'Double-click any model pill to solo'}
            </span>
          </div>

          <PulseChart
            models={models}
            selectedFamilies={selectedFamilies}
            metric={metric}
            granularity={granularity}
            intradayHours={intradayHours}
            splitProviders={splitProviders && canSplitProviders}
            locale={locale}
          />
        </section>

        <PulseTelemetryMatrix
          models={models}
          insights={insights}
          routeModelFamily={routeModelFamily}
          isZh={isZh}
          onSelectRouteModel={setRouteModelFamily}
        />

        <PulseRoutesTable
          activeRouteModel={activeRouteModel}
          routeModelFamily={routeModelFamily}
          loading={loading}
          isZh={isZh}
          onSelectRouteModel={setRouteModelFamily}
        />

        {/* Bottom CTA back to AGY-HUD Plugin */}
        <section class="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 class="text-[16px] font-semibold text-[var(--fg)]">
              {isZh
                ? '想把「你自己的本地实测曲线」直接叠在这张大盘图上？'
                : 'Want to overlay your own local latency curve on top of this global chart?'}
            </h2>
            <p class="mt-1 text-[13px] text-[var(--muted)]">
              {isZh
                ? '安装 AGY-HUD 官方侧边栏插件，在 Antigravity 内把本机 7d/30m 真实首字、吐字速度与缓存命中直接和全球大盘同图对比。'
                : 'Install the native AGY-HUD side-pane plugin for Google Antigravity to compare your local 7d/30m TTFT, TPS, and cache hit rate directly against the global Gemini pool.'}
            </p>
          </div>
          <a
            href="../#install"
            class="mt-4 inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[13px] font-semibold text-white no-underline transition-opacity hover:opacity-90 sm:mt-0"
          >
            <span>{isZh ? '一行命令安装 AGY-HUD' : 'Install AGY-HUD'}</span>
            <IconArrowUpRight size={14} />
          </a>
        </section>
      </main>
    </div>
  );
}
