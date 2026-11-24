/* Auto-extracted shared organic telemetry fixture for AGY-HUD live website embed.
 * Identical organic dataset used by the Retina 2x README screenshots. */
(function () {
// Deterministic seeded PRNG (Mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function evalLogLogistic(p0, t50, k, sec) {
  if (sec <= 0) return 1 - p0;
  return (1 - p0) / (1 + (sec / t50) ** k);
}

/**
 * Build a deeply realistic, organic StatsSnapshot + per-call details.
 * Zero sine waves — uses genuine coding-session regimes, AR(1) autocorrelated noise,
 * model-specific latency/throughput profiles, realistic compaction event, and real-world
 * Cache TTL / Quota Runway / 52w Iceberg distributions.
 */
function buildOrganicFixture(lang = 'en', nowOverrideMs = 0) {
  const rng = makeRng(20261124);
  const NOW = nowOverrideMs || Date.now();
  const CONV_ID = '9a7c4e21-8b3f-4d19-a612-3f8b5e1092c4';
  const isZh = lang === 'zh';

  // Clean 2-model Antigravity Orchestrator pair:
  // Orchestrator (Neon) handles planning, edits & synthesis;
  // Gemini 4 Hydrogen (Orchestrator) executes fast search, reads & test/build checks.
  const MODELS = {
    orch: {
      model: 'gemini-pro-orchestrator-neon',
      modelId: 'gemini-pro-orchestrator-neon',
      modelDisplay: 'Orchestrator (Neon)',
      pricingKey: 'gemini-4-neon',
      quotaPool: 'gemini',
      k: 1.0,
      baseTps: 112,
      tpsSigma: 12.0,
      tpsMin: 84,
      tpsMax: 142,
      baseTtft: 1.44,
      inPerM: 3.0,
      cachePerM: 0.15,
      outPerM: 15.0,
    },
    worker: {
      model: 'gemini-flash-worker-agy',
      modelId: 'gemini-flash-worker-agy',
      modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)',
      pricingKey: 'gemini-4-hydrogen',
      quotaPool: 'gemini',
      k: 1.0,
      baseTps: 154,
      tpsSigma: 14.0,
      tpsMin: 122,
      tpsMax: 188,
      baseTtft: 0.92,
      inPerM: 1.5,
      cachePerM: 0.075,
      outPerM: 7.5,
    },
  };

  // 16 realistic developer turns with organic call counts summing to 64
  const turnSpecs = [
    { calls: 3, en: 'Audit telemetry SQLite schema and protobuf fields', zh: '审计 telemetry SQLite 表结构与 protobuf 字段' },
    { calls: 4, en: 'Inspect Log-Logistic cache TTL survival model', zh: '检查对数逻辑斯蒂缓存 TTL 存活模型' },
    { calls: 5, en: 'Add 52-week daily Iceberg token split (new vs cached)', zh: '增加 52 周每日冰山 Token 拆分（新增 vs 缓存）' },
    { calls: 3, en: 'Add unit tests for 52w rollup and context breakdown', zh: '补充 52 周汇总与上下文拆分的单元测试' },
    { calls: 4, en: 'Refactor HUD surface tokens for layered borderless cards', zh: '重构 HUD 表面 Token 实现分层无边框卡片' },
    { calls: 5, en: 'Build crisp SVG icon set and custom SelectPopover', zh: '构建矢量 SVG 图标集与自定义下拉弹层' },
    { calls: 4, en: 'Slim TopBar chrome and make PulseBar scroll-aware', zh: '精简顶栏层级并实现滚动感知 PulseBar' },
    { calls: 5, en: 'Redesign Context Window X-Ray 2-column table & hover sync', zh: '重构上下文 X-Ray 双列对齐表与悬浮联动' },
    { calls: 4, en: 'Fix TrendChart Y-axis overlap and add area gradient fill', zh: '修复趋势图 Y 轴重叠并加入面积渐变填充' },
    { calls: 3, en: 'Compact context & continue with Quota Runway bar', zh: '压缩上下文并继续实现配额续航斜纹条' }, // compaction right before turn 10
    { calls: 4, en: 'Implement hatched diagonal runway projection in QuotaPoolsList', zh: '在配额池列表中实现斜纹续航预测条' },
    { calls: 5, en: 'Add Monochrome Iceberg view and 16w/52w toggle in ActivityHeatmap', zh: '在活跃度卡片加入单色冰山图与 16w/52w 切换' },
    { calls: 4, en: 'Polish CallLog inspector tiles and narrow 240px responsive layout', zh: '打磨调用日志检查器与 240px 窄侧栏适配' },
    { calls: 3, en: 'Verify Antigravity dark/light & strong-contrast theme parity', zh: '验证 Antigravity 深浅色与高对比度主题同步' },
    { calls: 4, en: 'Run full backend + web + site test suites and typechecks', zh: '运行全量后端、前端与官网测试和类型检查' },
    { calls: 4, en: 'Final polish on Swarm Cockpit rows and copy tightness', zh: '最终打磨 Swarm 驾驶舱列表与文案精简' },
  ];

  // Clean 2-model Orchestrator alternation per turn:
  // Orchestrator (Neon) plans -> Hydrogen Worker executes fast tool checks -> Orchestrator edits & synthesizes
  const modelSeq = [
    'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch', 'worker', 'orch',
    'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
    'orch', 'worker', 'worker', 'orch',
  ];

  const TOOL_POOLS = [
    ['read_file', 'grep_search'],
    ['read_file', 'edit_file'],
    ['edit_file', 'run_command'],
    ['read_file', 'read_file', 'edit_file'],
    ['run_command'],
    ['edit_file', 'edit_file', 'run_command'],
    ['swarm', 'read_file'],
  ];

  const invocations = [];
  const turns = [];
  const callDetails = {};
  const compactions = [];

  // Start ~48 minutes before NOW; last call is 94s before NOW for crisp ~1m34s cache age
  let cursorMs = NOW - 48 * 60 * 1000;
  let stepIdx = 4;
  let ctxTokens = 29_400;

  // AR(1) state per model so consecutive calls have organic momentum + sudden realistic shifts
  const tpsDrift = { orch: 0, worker: 0 };
  const COMPACT_AFTER_IDX = 35; // compaction happens between call #36 (idx 35) and call #37 (idx 36)

  let callIdx = 0;
  for (let ti = 0; ti < turnSpecs.length; ti++) {
    const spec = turnSpecs[ti];
    const turnStartStep = stepIdx;
    const turnStartMs = cursorMs;
    let turnOut = 0;
    let turnSec = 0;
    let turnQuota5h = 0;
    let turnQuota7d = 0;
    let turnHasCompact = false;

    for (let c = 0; c < spec.calls; c++) {
      const mKey = modelSeq[callIdx] || 'orch';
      const prof = MODELS[mKey];

      // Occasional realistic gap (e.g. user read output or took a 6m coffee break at call #24)
      let idleGapSec = 14 + Math.floor(rng() * 44);
      if (callIdx === 24) idleGapSec = 395; // ~6.5m pause -> causes realistic cache hit dip!
      if (callIdx === 48) idleGapSec = 148;
      cursorMs += idleGapSec * 1000;

      // Compaction event right before call #37 (idx 36)
      if (callIdx === COMPACT_AFTER_IDX + 1) {
        const beforeCtx = ctxTokens;
        const afterCtx = 43_850;
        const compTs = cursorMs - 9500;
        compactions.push({
          stepIdx: stepIdx++,
          turnIndex: ti + 1,
          afterGmIdx: COMPACT_AFTER_IDX,
          timestampMs: compTs,
          durationSec: 6.4,
          model: MODELS.orch.model,
          modelId: MODELS.orch.modelId,
          modelDisplay: MODELS.orch.modelDisplay,
          cachedInput: Math.round(beforeCtx * 0.91),
          newInput: Math.round(beforeCtx * 0.09),
          outputTokens: 3240,
          thinkingTokens: 890,
          candidateTokens: 2350,
          beforeCtx,
          afterCtx,
          afterCtxEstimated: false,
          priced: true,
          pricingKey: MODELS.orch.pricingKey,
          costUSD: 0.142,
          cacheSavedUSD: 0.43,
          quotaPool: 'gemini',
          quotaPct5h: 0.09,
          quotaPct5hErr: 0.005,
          quotaPct7d: 0.02,
          quotaMultiplierK: 1.0,
          quotaFitSource: 'fitted',
          hasSummary: true,
          summaryPreview: isZh
            ? '已将前 9 轮架构与 CSS 重构上下文压缩为结构化检查点（保留关键接口契约、类型定义与待办队列）。'
            : 'Compacted turns 1–9 into a structured checkpoint preserving backend additive schemas, surface tokens, and remaining verification items.',
        });
        ctxTokens = afterCtx;
        turnHasCompact = true;
      }

      // Organic AR(1) + occasional regime shock (NO sine wave!)
      const shock = rng() < 0.18 ? gauss(rng) * prof.tpsSigma * 1.15 : 0;
      tpsDrift[mKey] = 0.45 * tpsDrift[mKey] + gauss(rng) * (prof.tpsSigma * 0.72) + shock;
      // Add slight load slowdown at larger contexts (>150k)
      const ctxLoadPenalty = ctxTokens > 150_000 ? ((ctxTokens - 150_000) / 100_000) * 9.5 : 0;
      let genTps = clamp(prof.baseTps + tpsDrift[mKey] - ctxLoadPenalty, prof.tpsMin, prof.tpsMax);

      // Hand-tune last 3 calls for natural crisp hero numbers (and clean Orchestrator alternation)
      if (callIdx === 61) genTps = 152.4;  // Hydrogen Worker fast read
      if (callIdx === 62) genTps = 148.6;  // Hydrogen Worker build verify (expanded in Calls tab)
      if (callIdx === 63) genTps = 110.4;  // Orchestrator (Neon) final synthesis

      // Realistic special events
      const isSlowThinkBurst = callIdx === 18 || callIdx === 44;
      const isBuffered = callIdx === 29;
      const isToolStall = callIdx === 52;

      // Output & thinking tokens (heavy-tailed realistic distribution)
      let outputTokens;
      let thinkingTokens;
      if (isBuffered) {
        outputTokens = 148;
        thinkingTokens = 26;
      } else if (isSlowThinkBurst) {
        thinkingTokens = Math.round(2200 + rng() * 950);
        outputTokens = thinkingTokens + Math.round(1450 + rng() * 900);
      } else if (mKey === 'worker') {
        thinkingTokens = Math.round(140 + rng() * 340);
        outputTokens = thinkingTokens + Math.round(420 + rng() * 880);
      } else {
        thinkingTokens = Math.round(420 + rng() * 980);
        outputTokens = thinkingTokens + Math.round(640 + rng() * 1380);
      }
      if (callIdx === 62) {
        thinkingTokens = 342;
        outputTokens = 1128;
      }
      if (callIdx === 63) {
        thinkingTokens = 986;
        outputTokens = 2048;
      }
      const candidateTokens = Math.max(80, outputTokens - thinkingTokens);

      // TTFT (log-normal-ish with realistic thinking latency)
      let ttftSec = prof.baseTtft * Math.exp(gauss(rng) * 0.28);
      if (isSlowThinkBurst) ttftSec = 4.6 + rng() * 1.9;
      if (callIdx === 62) ttftSec = 0.84;
      if (callIdx === 63) ttftSec = 4.42;
      ttftSec = round(clamp(ttftSec, 0.42, 7.2), 2);

      let genSec = isBuffered ? 0.29 : round(outputTokens / genTps, 2);
      if (isBuffered) genTps = round(outputTokens / genSec, 1);
      else genTps = round(outputTokens / genSec, 1);

      const totalSec = round(ttftSec + genSec, 2);
      const e2eTps = round(outputTokens / totalSec, 2);

      // Cache hit ratio: realistic cold start -> steady 88-95% -> idle dip -> compaction drop -> recovery
      let cacheRatio;
      if (callIdx === 0) cacheRatio = 0.18;
      else if (callIdx === 1) cacheRatio = 0.69;
      else if (callIdx === 24) cacheRatio = 0.54; // after 6.5m break
      else if (callIdx === COMPACT_AFTER_IDX + 1) cacheRatio = 0.41; // immediately post-compaction
      else if (callIdx === COMPACT_AFTER_IDX + 2) cacheRatio = 0.74;
      else cacheRatio = clamp(0.895 + gauss(rng) * 0.032, 0.78, 0.955);

      if (callIdx === 62) cacheRatio = 0.892;
      if (callIdx === 63) cacheRatio = 0.904;

      const totalPromptTokens = ctxTokens;
      const cachedInput = Math.round(totalPromptTokens * cacheRatio);
      const newInput = Math.max(600, totalPromptTokens - cachedInput);
      const cacheHitPct = round((cachedInput / totalPromptTokens) * 100, 1);

      // Cost & cache savings (API-equivalent USD)
      const costUSD = round(
        (newInput * prof.inPerM + cachedInput * prof.cachePerM + outputTokens * prof.outPerM) / 1_000_000,
        4,
      );
      const cacheSavedUSD = round(
        (cachedInput * (prof.inPerM - prof.cachePerM)) / 1_000_000,
        4,
      );

      // Quota impact (5h / 7d)
      const cap5h = prof.quotaPool === 'gemini' ? 150 : 50;
      const cap7d = prof.quotaPool === 'gemini' ? 600 : 200;
      const quotaPct5h = round(((costUSD * prof.k) / cap5h) * 100, 4);
      const quotaPct7d = round(((costUSD * prof.k) / cap7d) * 100, 4);

      const thinkSec = round(genSec * (thinkingTokens / Math.max(1, outputTokens)) * 0.95, 2);
      const toolSet = TOOL_POOLS[(callIdx + Math.floor(rng() * 3)) % TOOL_POOLS.length];
      const stepToolCount = isToolStall ? 5 : toolSet.length;
      const toolGenSec = isToolStall ? 9.4 : round(0.4 + rng() * 2.1, 2);

      const toolCalls =
        callIdx === 62
          ? [
              { name: 'read_file', args: '{"Path":"web/src/components/account/QuotaPoolsList.tsx","StartLine":1,"EndLine":140}' },
              { name: 'run_command', args: '{"CommandLine":"npm --prefix web run build"}' },
            ]
          : toolSet.map((tName) => ({
              name: tName,
              args: tName === 'run_command'
                ? '{"CommandLine":"npm test"}'
                : '{"Path":"web/src/styles/app.css"}',
            }));

      const thinkingPreview = callIdx === 62
        ? (isZh
            ? '检查配额续航条在窄屏（240px）与常规（400px）下的宽度对齐：已用轨迹、斜纹预测区间与剩余实心条比例一致，无文字截断。'
            : 'Verifying hatched runway stripe alignment across 240px and 400px widths: solid post-reset remainder + diagonal projected burn matches 5h reset horizon with zero text clipping.')
        : (isZh
            ? `分析第 ${ti + 1} 轮改动影响范围，核对类型定义与深浅色主题对比度边界。`
            : `Reviewing turn #${ti + 1} surface token changes and verifying dark/light/strong-contrast parity before patching.`);

      const replyPreview = callIdx === 62
        ? (isZh
            ? '已完成 `QuotaPoolsList.tsx` 与 `web` 生产构建校验：0 TypeScript 错误，斜纹续航条在深浅双色模式下对比度清晰。'
            : 'Verified `QuotaPoolsList.tsx` and ran the production `web` build: 0 TypeScript errors, hatched runway stripe renders crisply in both dark and light host themes.')
        : (isZh
            ? `已完成第 ${ti + 1} 轮目标变更并验证局部渲染行为正常。`
            : `Applied turn #${ti + 1} changes cleanly and verified component behavior.`);

      const inv = {
        idx: callIdx,
        stepIdx: stepIdx++,
        turnIndex: ti + 1,
        lastStepIndex: stepIdx + stepToolCount,
        botId: `bot_${callIdx + 1}`,
        modelEnum: mKey === 'orch' ? 1537 : 1669,
        model: prof.model,
        modelId: prof.modelId,
        modelDisplay: prof.modelDisplay,
        parentCascadeId: '',
        subagentType: '',
        newInput,
        cachedInput,
        totalPromptTokens,
        cacheHitPct,
        outputTokens,
        thinkingTokens,
        candidateTokens,
        ttftSec,
        genSec,
        totalSec,
        isBuffered,
        genTps,
        e2eTps,
        totalContext: totalPromptTokens + outputTokens,
        contextLimit: 256_000,
        contextPct: round(((totalPromptTokens + outputTokens) / 256_000) * 100, 1),
        timestampMs: cursorMs,
        priced: true,
        pricingKey: prof.pricingKey,
        costUSD,
        cacheSavedUSD,
        quotaPool: prof.quotaPool,
        quotaPct5h,
        quotaPct5hErr: round(quotaPct5h * 0.045, 4),
        quotaPct7d,
        quotaMultiplierK: prof.k,
        quotaFitSource: 'fitted',
        thinkSec,
        toolGenSec,
        stepToolCount,
        isToolStall,
        hasThinking: true,
        hasReply: true,
        toolCount: toolCalls.length,
        thinkingChars: thinkingPreview.length * 14,
        replyChars: replyPreview.length * 18,
        thinkingPreview,
        replyPreview,
        toolCalls,
      };

      invocations.push(inv);
      callDetails[`${CONV_ID}:inv:${callIdx}`] = {
        thinkingPreview,
        thinkingChars: inv.thinkingChars,
        replyPreview,
        replyChars: inv.replyChars,
        toolCalls,
      };

      turnOut += outputTokens;
      turnSec += totalSec;
      turnQuota5h += quotaPct5h;
      turnQuota7d += quotaPct7d;

      // Advance context organically per call (tool results + model output)
      // Faster growth pre-compaction (29k -> ~210k), steady growth post-compaction (43.8k -> ~112.5k)
      const deltaCtx = callIdx <= COMPACT_AFTER_IDX
        ? Math.round(outputTokens + 2400 + rng() * 3200)
        : Math.round(outputTokens * 0.65 + 1150 + rng() * 1450);
      ctxTokens = Math.min(218_000, ctxTokens + deltaCtx);
      stepIdx += stepToolCount;
      callIdx++;
    }

    turns.push({
      turnIndex: ti + 1,
      stepIdx: turnStartStep,
      timestampMs: turnStartMs,
      promptPreview: isZh ? spec.zh : spec.en,
      promptFull: isZh ? spec.zh : spec.en,
      hasFullPrompt: true,
      isCompact: turnHasCompact,
      compactCount: turnHasCompact ? 1 : 0,
      callCount: spec.calls,
      outputTokens: turnOut,
      totalSec: round(turnSec, 1),
      quotaPool: 'gemini',
      quotaPct5h: round(turnQuota5h, 3),
      quotaPct7d: round(turnQuota7d, 3),
      quotaFitSource: 'fitted',
    });
  }

  // Shift all timestamps so the very last call lands exactly 94 seconds before NOW (1m34s age)
  const lastTs = invocations[invocations.length - 1].timestampMs;
  const shiftMs = (NOW - 94_000) - lastTs;
  for (const inv of invocations) inv.timestampMs += shiftMs;
  for (const c of compactions) c.timestampMs += shiftMs;
  for (const u of turns) u.timestampMs += shiftMs;

  // Align latest context cleanly to 114,620 / 256,000 (44.8%) while keeping call #63 monotonic
  const prevCall = invocations[invocations.length - 2];
  const latest = invocations[invocations.length - 1];
  const targetLatestCtx = Math.max(114_620, prevCall.totalContext + 3_200);
  latest.totalContext = targetLatestCtx;
  latest.totalPromptTokens = targetLatestCtx - latest.outputTokens;
  latest.cachedInput = Math.round(latest.totalPromptTokens * 0.904);
  latest.newInput = latest.totalPromptTokens - latest.cachedInput;
  latest.cacheHitPct = round((latest.cachedInput / latest.totalPromptTokens) * 100, 1);
  latest.contextPct = round((latest.totalContext / 256_000) * 100, 1);

  // Aggregate summary accurately from the 64 invocations
  const sustained = invocations.filter((x) => !x.isBuffered);
  const totalOutput = invocations.reduce((s, x) => s + x.outputTokens, 0);
  const totalThinking = invocations.reduce((s, x) => s + x.thinkingTokens, 0);
  const totalCandidate = invocations.reduce((s, x) => s + x.candidateTokens, 0);
  const totalCachedInput = invocations.reduce((s, x) => s + x.cachedInput, 0);
  const totalNewInput = invocations.reduce((s, x) => s + x.newInput, 0);
  const totalModelSec = round(invocations.reduce((s, x) => s + x.totalSec, 0), 1);
  const totalToolSec = round(invocations.reduce((s, x) => s + x.toolGenSec, 0), 1);
  const totalCostUSD = round(invocations.reduce((s, x) => s + x.costUSD, 0), 2);
  const totalSavedUSD = round(invocations.reduce((s, x) => s + x.cacheSavedUSD, 0), 2);
  const avgGenTps = round(
    sustained.reduce((s, x) => s + x.outputTokens, 0) /
      Math.max(1, sustained.reduce((s, x) => s + x.genSec, 0)),
    2,
  );
  const avgE2eTps = round(
    invocations.reduce((s, x) => s + x.outputTokens, 0) /
      Math.max(1, invocations.reduce((s, x) => s + x.totalSec, 0)),
    2,
  );
  const peakGenTps = round(Math.max(...sustained.map((x) => x.genTps)), 1);
  const avgTtftSec = round(invocations.reduce((s, x) => s + x.ttftSec, 0) / invocations.length, 2);
  const avgCacheHitPct = round((totalCachedInput / Math.max(1, totalCachedInput + totalNewInput)) * 100, 1);

  const gem5h = round(invocations.filter((x) => x.quotaPool === 'gemini').reduce((s, x) => s + (x.quotaPct5h || 0), 0), 2);
  const gem7d = round(invocations.filter((x) => x.quotaPool === 'gemini').reduce((s, x) => s + (x.quotaPct7d || 0), 0), 2);
  const claude5h = round(invocations.filter((x) => x.quotaPool === 'claude_gpt').reduce((s, x) => s + (x.quotaPct5h || 0), 0), 2);
  const claude7d = round(invocations.filter((x) => x.quotaPool === 'claude_gpt').reduce((s, x) => s + (x.quotaPct7d || 0), 0), 2);

  // Build Monday-aligned 52 weeks (matching hud-backend buildAccountHistory exactly)
  const dayRng = makeRng(20260917);
  const days52 = [];
  const baseDate = new Date(Date.UTC(2026, 10, 23)); // Mon 2026-11-23
  const dowMon0 = (baseDate.getUTCDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  const totalGridDays16 = 15 * 7 + dowMon0 + 1;
  const totalGridDays52 = 51 * 7 + dowMon0 + 1;
  let peakCostUSD52 = 0;
  let peakDate52 = '';

  for (let i = totalGridDays52 - 1; i >= 0; i--) {
    const d = new Date(baseDate.getTime() - i * 86_400_000);
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    const iso = d.toISOString().slice(0, 10);

    // Realistic weekday/weekend cadence + occasional vacation/light week + 14-day active streak at end
    const isWeekend = dow === 0 || dow === 6;
    const isHolidayDip = i > 180 && i < 191;
    const forceActive = i <= 13; // 14-day current streak!
    let activeProb = isWeekend ? 0.42 : 0.88;
    if (isHolidayDip) activeProb *= 0.25;
    // Slight ramp up in usage over the year
    const growthFactor = 0.65 + 0.45 * ((totalGridDays52 - 1 - i) / Math.max(1, totalGridDays52 - 1));

    const active = forceActive || dayRng() < activeProb;
    if (!active) {
      days52.push({
        date: iso,
        calls: 0,
        appCalls: 0,
        cliCalls: 0,
        costUSD: 0,
        outputTokens: 0,
        newTokens: 0,
        cachedTokens: 0,
      });
      continue;
    }

    const intensity = (isWeekend ? 0.55 : 1.0) * growthFactor * (0.4 + dayRng() * 1.35 + (dayRng() < 0.12 ? 0.9 : 0));
    const calls = Math.max(4, Math.round(intensity * 95));
    const cliShare = clamp(0.12 + dayRng() * 0.28, 0.05, 0.45);
    const cliCalls = Math.round(calls * cliShare);
    const appCalls = Math.max(0, calls - cliCalls);
    const outputTokens = Math.round(calls * (980 + dayRng() * 720));
    const newInputTok = Math.round(calls * (2800 + dayRng() * 3400));
    const newTokens = outputTokens + newInputTok; // non-cached input + output (output includes thinking)
    const cacheMult = 5.2 + dayRng() * 4.8; // realistic 84%–91% cache ratio
    const cachedTokens = Math.round(newInputTok * cacheMult);
    const costUSD = round((newInputTok * 2.1 + cachedTokens * 0.21 + outputTokens * 9.5) / 1_000_000, 2);

    if (costUSD > peakCostUSD52) {
      peakCostUSD52 = costUSD;
      peakDate52 = iso;
    }

    days52.push({
      date: iso,
      calls,
      appCalls,
      cliCalls,
      costUSD,
      outputTokens,
      newTokens,
      cachedTokens,
    });
  }

  // Ensure today's entry is strictly >= session cost & calls
  const todayEntry = days52[days52.length - 1];
  todayEntry.calls = Math.max(148, invocations.length + 84);
  todayEntry.appCalls = Math.round(todayEntry.calls * 0.76);
  todayEntry.cliCalls = todayEntry.calls - todayEntry.appCalls;
  todayEntry.costUSD = round(totalCostUSD + 2.48, 2);
  todayEntry.outputTokens = Math.max(186_400, totalOutput + 94_000);
  todayEntry.newTokens = 642_000;
  todayEntry.cachedTokens = 5_180_000;
  if (todayEntry.costUSD > peakCostUSD52) {
    peakCostUSD52 = todayEntry.costUSD;
    peakDate52 = todayEntry.date;
  }

  const days16 = days52.slice(days52.length - totalGridDays16);
  const activeDays16 = days16.filter((d) => d.calls > 0).length;
  const activeDays52 = days52.filter((d) => d.calls > 0).length;
  let streak = 0;
  for (let i = days52.length - 1; i >= 0; i--) {
    if (days52[i].calls > 0) streak++;
    else break;
  }
  const peak16 = days16.reduce((best, d) => (d.costUSD > best.costUSD ? d : best), days16[0]);

  // Cache TTL Survival models (realistic Log-Logistic curves + empirical buckets)
  const BUCKET_DEFS = [
    { key: '0-1m', label: '<1m', minSec: 0, maxSec: 60, midSec: 20 },
    { key: '1-5m', label: '1-5m', minSec: 60, maxSec: 300, midSec: 150 },
    { key: '5-10m', label: '5-10m', minSec: 300, maxSec: 600, midSec: 420 },
    { key: '10-20m', label: '10-20m', minSec: 600, maxSec: 1200, midSec: 840 },
    { key: '20-60m', label: '20-60m', minSec: 1200, maxSec: 3600, midSec: 2100 },
    { key: '1-2h', label: '1-2h', minSec: 3600, maxSec: 7200, midSec: 5100 },
    { key: '2h+', label: '2h+', minSec: 7200, maxSec: null, midSec: 10800 },
  ];

  function makeTtlModel({ family, providerKind, p0, t50, k, counts, hitRates, missCostUSD }) {
    const buckets = BUCKET_DEFS.map((b, i) => {
      const count = counts[i];
      const hits = Math.round(count * hitRates[i]);
      return {
        ...b,
        count,
        hits,
        hitRate: count > 0 ? round(hits / count, 3) : null,
        predictedRate: round(evalLogLogistic(p0, t50, k, b.midSec), 3),
      };
    });
    const sampleCount = buckets.reduce((s, b) => s + b.count, 0);
    const hitCount = buckets.reduce((s, b) => s + b.hits, 0);
    const missCount = sampleCount - hitCount;
    const longGapCount = buckets.slice(2).reduce((s, b) => s + b.count, 0);
    const expiredMissCount = buckets.slice(1).reduce((s, b) => s + (b.count - b.hits), 0);
    const solveQ = (q) => Math.round(t50 * Math.max(0.01, (1 - p0) / q - 1) ** (1 / k));
    return {
      family,
      providerKind,
      confidence: 'fitted',
      sampleCount,
      longGapCount,
      hitCount,
      missCount,
      expiredMissCount,
      missCostUSD,
      bgMissRate: p0,
      t50Sec: t50,
      shapeK: k,
      p80Sec: solveQ(0.8),
      p50Sec: solveQ(0.5),
      p20Sec: solveQ(0.2),
      buckets,
    };
  }

  const gemTtl = makeTtlModel({
    family: 'gemini-4-neon',
    providerKind: 'gemini',
    p0: 0.017,
    t50: 3211, // ~53.5m empirical LRU decay (sanitized from real telemetry)
    k: 1.09,
    counts: [2171, 353, 40, 24, 11, 4, 2],
    hitRates: [0.983, 0.949, 0.9, 0.792, 0.545, 0.25, 0.0],
    missCostUSD: 14.6,
  });

  const claudeTtl = makeTtlModel({
    family: 'claude-opus-5-5',
    providerKind: 'claude',
    p0: 0.005,
    t50: 304, // ~5.1m sharp Anthropic TTL cliff
    k: 10.0,
    counts: [96, 42, 18, 9, 6, 3, 1],
    hitRates: [0.99, 0.929, 0.056, 0.0, 0.0, 0.0, 0.0],
    missCostUSD: 3.85,
  });

  const cacheTtl = {
    totalPairs: gemTtl.sampleCount + claudeTtl.sampleCount,
    totalLongGapPairs: gemTtl.longGapCount + claudeTtl.longGapCount,
    totalExpiredMisses: gemTtl.expiredMissCount + claudeTtl.expiredMissCount,
    totalMissCostUSD: round(gemTtl.missCostUSD + claudeTtl.missCostUSD, 2),
    models: [gemTtl, claudeTtl],
    currentSession: {
      family: 'gemini-4-neon',
      providerKind: 'gemini',
      confidence: 'fitted',
      sampleCount: gemTtl.sampleCount,
      longGapCount: gemTtl.longGapCount,
      bgMissRate: gemTtl.bgMissRate,
      t50Sec: gemTtl.t50Sec,
      shapeK: gemTtl.shapeK,
      p80Sec: gemTtl.p80Sec,
      p50Sec: gemTtl.p50Sec,
      p20Sec: gemTtl.p20Sec,
      lastCallMs: latest.timestampMs,
      cachedContextTokens: latest.cachedInput,
      missPenaltyUSD: 0.34,
      missPenaltyQuota5hPct: 0.06,
    },
  };

  // Sanitized realistic 6-worker Orchestrator Swarm Cockpit (clean 2-model split: Orchestrator Neon + Hydrogen Worker)
  const childSessions = [
    {
      id: '3c1f8b92-4a21-4e77-9b10-1a2b3c4d5e01',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? '配额 IRLS 校准与滞后结算归并' : 'Quota IRLS calibration & delayed settlement merge',
      calls: 28,
      outputTokens: 32_840,
      costUSD: 2.14,
      savedUSD: 9.62,
      pricedCount: 28,
      unpricedCount: 0,
      updatedMs: NOW - 14_000,
      latestTsMs: NOW - 14_000,
      quotaUsage: { gemini: { pct5h: 0.36, pct7d: 0.09, isFitted: true } },
      swarm: {
        rosterName: 'quota-solver',
        swarmRole: 'worker',
        swarmState: 'working',
        threadId: 't-core',
        threadTitle: isZh ? '核心遥测与配额求解' : 'Core Telemetry & Quota Solver',
        taskTitle: isZh ? '脏突发守恒护栏 + 配额校准' : 'Dirty-burst guard + quota calibration',
        model: 'gemini-pro-orchestrator-neon',
        workspaceMode: 'share',
        lastReadSeq: 64,
        lastPostSeq: 63,
        lastPostSnippet: isZh ? '92 项 sidecar 单测全绿，正在校验 Ultra 20x 配额边界' : 'All 92 sidecar tests green; verifying Ultra 20x pool caps',
        lastPostTime: '2026-11-24 20:54:12',
      },
    },
    {
      id: '7d4e2a11-9c08-4f31-8a12-1a2b3c4d5e02',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? 'HUD 趋势图拆解与 NowContext 性能优化' : 'TrendChart split & NowContext perf refactor',
      calls: 34,
      outputTokens: 41_920,
      costUSD: 2.78,
      savedUSD: 12.45,
      pricedCount: 34,
      unpricedCount: 0,
      updatedMs: NOW - 9_000,
      latestTsMs: NOW - 9_000,
      quotaUsage: { gemini: { pct5h: 0.46, pct7d: 0.12, isFitted: true } },
      swarm: {
        rosterName: 'hud-ui',
        swarmRole: 'worker',
        swarmState: 'working',
        threadId: 't-core',
        threadTitle: isZh ? '核心遥测与配额求解' : 'Core Telemetry & Quota Solver',
        taskTitle: isZh ? '趋势图回调 Ref 修复、键盘无障碍与 memo 优化' : 'Chart callback-ref fix, keyboard a11y & memoization',
        model: 'gemini-pro-orchestrator-neon',
        workspaceMode: 'share',
        lastReadSeq: 64,
        lastPostSeq: 64,
        lastPostSnippet: isZh ? '已修复 Session↔Global 切换后缩放失效，UI 构建通过' : 'Fixed Session↔Global resize/wheel detachment; UI build green',
        lastPostTime: '2026-11-24 20:54:28',
      },
    },
    {
      id: '5e9a0c33-1b72-4d90-a214-1a2b3c4d5e03',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? '深度代码审校与安全边界加固' : 'Deep code audit & security boundary hardening',
      calls: 16,
      outputTokens: 12_463,
      costUSD: 0.81,
      savedUSD: 3.27,
      pricedCount: 16,
      unpricedCount: 0,
      updatedMs: NOW - 38_000,
      latestTsMs: NOW - 38_000,
      quotaUsage: { gemini: { pct5h: 0.14, pct7d: 0.04, isFitted: true } },
      swarm: {
        rosterName: 'code-auditor',
        swarmRole: 'worker',
        swarmState: 'waiting',
        threadId: 't-core',
        threadTitle: isZh ? '核心遥测与配额求解' : 'Core Telemetry & Quota Solver',
        taskTitle: isZh ? '审校 Worker 鉴权、链接白名单与 P0 缺陷' : 'Audit Worker HMAC auth, URL allowlists & P0 defects',
        model: 'gemini-pro-orchestrator-neon',
        workspaceMode: 'inherit',
        lastReadSeq: 64,
        lastPostSeq: 61,
        lastPostSnippet: isZh ? '15 项 P0–P2 审查结论已发回协调者，待命复检' : 'Sent 15 P0–P2 audit findings to coordinator; standing by',
        lastPostTime: '2026-11-24 20:53:40',
      },
    },
    {
      id: '8b2c6f44-6e15-4a82-b319-1a2b3c4d5e04',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? 'Cloudflare 5 分钟 Pulse 采集器与公共核心' : 'Cloudflare 5m Pulse collector & shared pulse-core',
      calls: 19,
      outputTokens: 18_640,
      costUSD: 0.64,
      savedUSD: 2.94,
      pricedCount: 19,
      unpricedCount: 0,
      updatedMs: NOW - 52_000,
      latestTsMs: NOW - 52_000,
      quotaUsage: { gemini: { pct5h: 0.11, pct7d: 0.03, isFitted: true } },
      swarm: {
        rosterName: 'pulse-worker',
        swarmRole: 'worker',
        swarmState: 'waiting',
        threadId: 't-launch',
        threadTitle: isZh ? '云端大盘与官网发布' : 'Global Pulse & Site Launch',
        taskTitle: isZh ? '抽取 pulse-core.ts 并完善 KV 空响应保护' : 'Extract pulse-core.ts & add KV empty-response guard',
        model: 'gemini-flash-worker-agy',
        workspaceMode: 'share',
        lastReadSeq: 64,
        lastPostSeq: 60,
        lastPostSnippet: isZh ? 'Wrangler dry-run 36 KiB 通过，等待最终发布' : 'Wrangler dry-run 36 KiB clean; ready for deploy',
        lastPostTime: '2026-11-24 20:52:55',
      },
    },
    {
      id: '4f7d91a0-2c38-4b65-8d21-1a2b3c4d5e05',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? '官网 8 卡展示与 16 套官方主题同步' : 'Launch site 8-card Bento wall & 16-theme sync',
      calls: 22,
      outputTokens: 24_180,
      costUSD: 1.48,
      savedUSD: 6.12,
      pricedCount: 22,
      unpricedCount: 0,
      updatedMs: NOW - 115_000,
      latestTsMs: NOW - 115_000,
      quotaUsage: { gemini: { pct5h: 0.25, pct7d: 0.06, isFitted: true } },
      swarm: {
        rosterName: 'site-launch',
        swarmRole: 'worker',
        swarmState: 'killed',
        threadId: 't-launch',
        threadTitle: isZh ? '云端大盘与官网发布' : 'Global Pulse & Site Launch',
        taskTitle: isZh ? '生成 1200×630 OG 图与双语发布文档' : 'Generate 1200×630 OG cards & bilingual launch docs',
        model: 'gemini-pro-orchestrator-neon',
        workspaceMode: 'share',
        lastReadSeq: 58,
        lastPostSeq: 58,
        lastPostSnippet: isZh ? '任务完成并已合入主干，工作区已清理' : 'Merged cleanly into main; share workspace cleaned up',
        lastPostTime: '2026-11-24 20:51:10',
      },
    },
    {
      id: '9e1b3c72-8f44-4d12-9a35-1a2b3c4d5e06',
      kind: 'subagent',
      subagentType: 'swarm_worker',
      title: isZh ? '全量 CI 类型检查与跨平台安装测试' : 'Full CI typechecks & cross-platform installer tests',
      calls: 14,
      outputTokens: 9_820,
      costUSD: 0.42,
      savedUSD: 1.88,
      pricedCount: 14,
      unpricedCount: 0,
      updatedMs: NOW - 160_000,
      latestTsMs: NOW - 160_000,
      quotaUsage: { gemini: { pct5h: 0.07, pct7d: 0.02, isFitted: true } },
      swarm: {
        rosterName: 'verifier',
        swarmRole: 'worker',
        swarmState: 'killed',
        threadId: 't-launch',
        threadTitle: isZh ? '云端大盘与官网发布' : 'Global Pulse & Site Launch',
        taskTitle: isZh ? '执行 101 项测试、Bundle 校验与 --doctor 验收' : 'Run 101 unit tests, bundle parity & --doctor check',
        model: 'gemini-flash-worker-agy',
        workspaceMode: 'inherit',
        lastReadSeq: 59,
        lastPostSeq: 59,
        lastPostSnippet: isZh ? '101/101 测试全过，发布验收完成' : '101/101 tests green; release verification complete',
        lastPostTime: '2026-11-24 20:50:22',
      },
    },
  ];

  // Compute recursive treeTotals across root + Swarm childSessions for live demo parity
  let demoChildCalls = 0;
  let demoChildOut = 0;
  let demoChildCost = 0;
  let demoChildSaved = 0;
  let demoChildPriced = 0;
  let demoChildGem5h = 0;
  let demoChildGem7d = 0;
  let demoChildClaude5h = 0;
  let demoChildClaude7d = 0;
  for (const ch of childSessions) {
    demoChildCalls += ch.calls || 0;
    demoChildOut += ch.outputTokens || 0;
    demoChildCost += ch.costUSD || 0;
    demoChildSaved += ch.savedUSD || 0;
    demoChildPriced += ch.pricedCount || 0;
    demoChildGem5h += ch.quotaUsage?.gemini?.pct5h || 0;
    demoChildGem7d += ch.quotaUsage?.gemini?.pct7d || 0;
    demoChildClaude5h += ch.quotaUsage?.claude_gpt?.pct5h || 0;
    demoChildClaude7d += ch.quotaUsage?.claude_gpt?.pct7d || 0;
  }

  // Build rich realistic OpenRouter Gemini 30m + 7d/24h time-series pulse for demo
  const pulseDayDates = [];
  for (let d = 7; d >= 0; d--) {
    const dt = new Date(NOW - d * 86_400_000);
    pulseDayDates.push(dt.toISOString().slice(0, 10));
  }
  const mkDailySeries = (baseVertex, baseStudio, jitter, digits, minV, maxV) =>
    pulseDayDates.map((x, idx) => {
      const wave = Math.sin(idx * 0.9 + baseVertex) * jitter;
      const v = clamp(round(baseVertex + wave, digits), minV, maxV);
      const s = clamp(round(baseStudio + wave * 0.85, digits), minV, maxV);
      return {
        x,
        tsMs: Date.parse(`${x}T12:00:00Z`),
        value: v,
        byProvider: { 'Google Vertex': v, 'AI Studio': s },
      };
    });
  const mkUptime24h = (baseAvail, dipIdx, dipDepth) => {
    const buckets = [];
    for (let i = 47; i >= 0; i--) {
      const tsMs = NOW - i * 30 * 60_000;
      const d = new Date(tsMs);
      const x = d.toISOString().slice(0, 16).replace('T', ' ');
      const idx = 47 - i;
      const dip = dipIdx >= 0 && Math.abs(idx - dipIdx) <= 2 ? dipDepth * (1 - Math.abs(idx - dipIdx) * 0.3) : 0;
      const avail = clamp(round(baseAvail - dip + (rng() - 0.5) * 0.35, 2), 45, 100);
      const raw = clamp(round(avail - 0.7 - dip * 0.35, 2), 35, 100);
      buckets.push({ x, tsMs, availability: avail, rawAvailability: raw });
    }
    return buckets;
  };

  const mkLocalDaily = (baseTtft, baseTps, baseCache) =>
    pulseDayDates.map((x, idx) => ({
      x,
      calls: 12 + (idx % 4) * 5,
      p50TtftSec: clamp(round(baseTtft + Math.sin(idx * 1.1 + baseTtft) * 0.24, 2), 0.4, 8),
      p50Tps: clamp(round(baseTps + Math.cos(idx * 0.8 + baseTtft) * 6.5, 1), 30, 180),
      cacheHitPct: clamp(round(baseCache + Math.sin(idx * 0.7) * 3.2, 1), 40, 97),
    }));

  const geminiPulseModels = [
    {
      family: 'gemini-4-neon',
      slug: 'google/gemini-4-neon',
      permaslug: 'google/gemini-4-neon-20261118',
      label: 'Gemini 4 Neon',
      status: 'ok',
      p50TtftSec: 4.18,
      p75TtftSec: 6.42,
      p90TtftSec: 9.85,
      p50Tps: 84.0,
      p90Tps: 32.0,
      cacheHitPct: 83.9,
      uptime30mPct: 100,
      requestCount30m: 38420,
      windowMinutes: 30,
      primaryProvider: 'Google Vertex',
      degradedProviders: [],
      endpoints: [
        { endpointId: 'ep-neon-v', providerName: 'Google Vertex', providerSlug: 'google-vertex', cacheHitPct: 83.2, p50TtftSec: 4.18, p75TtftSec: 6.42, p90TtftSec: 9.85, p50Tps: 84.0, p90Tps: 32.0, requestCount: 31200, windowMinutes: 30 },
        { endpointId: 'ep-neon-s', providerName: 'Google AI Studio', providerSlug: 'google-ai-studio', cacheHitPct: 85.6, p50TtftSec: 5.12, p75TtftSec: 7.4, p90TtftSec: 11.4, p50Tps: 76.5, p90Tps: 27.0, requestCount: 7220, windowMinutes: 30 },
      ],
      series: {
        ttft7d: mkDailySeries(3.85, 4.75, 0.75, 2, 1.5, 9),
        tps7d: mkDailySeries(84, 77, 8, 1, 45, 130),
        cache7d: mkDailySeries(83.5, 85.2, 4.2, 1, 55, 96),
        uptime24h: mkUptime24h(99.6, -1, 0),
      },
      local: {
        calls7d: 142,
        p50TtftSec: 1.82,
        p90TtftSec: 3.95,
        hitP50TtftSec: 1.44,
        missP50TtftSec: 4.6,
        p50Tps: 98.4,
        cacheHitPct: 89.2,
        calls30m: 14,
        p50Ttft30mSec: 1.56,
        p50Tps30m: 102.3,
        cacheHit30mPct: 91.4,
        calls24h: 48,
        p50Ttft24hSec: 1.74,
        p50Tps24h: 99.1,
        cacheHit24hPct: 89.8,
        daily7d: mkLocalDaily(1.78, 98.4, 89.2),
      },
    },
    {
      family: 'gemini-4-hydrogen',
      slug: 'google/gemini-4-hydrogen',
      permaslug: 'google/gemini-4-hydrogen-20261112',
      label: 'Gemini 4 Hydrogen',
      status: 'ok',
      p50TtftSec: 1.52,
      p75TtftSec: 2.24,
      p90TtftSec: 3.31,
      p50Tps: 142.0,
      p90Tps: 74.0,
      cacheHitPct: 79.6,
      uptime30mPct: 100,
      requestCount30m: 26180,
      windowMinutes: 30,
      primaryProvider: 'Google Vertex',
      degradedProviders: [],
      endpoints: [
        { endpointId: 'ep-hydro-v', providerName: 'Google Vertex', providerSlug: 'google-vertex', cacheHitPct: 79.1, p50TtftSec: 1.52, p75TtftSec: 2.24, p90TtftSec: 3.31, p50Tps: 142.0, p90Tps: 74.0, requestCount: 20400, windowMinutes: 30 },
        { endpointId: 'ep-hydro-s', providerName: 'Google AI Studio', providerSlug: 'google-ai-studio', cacheHitPct: 81.0, p50TtftSec: 1.88, p75TtftSec: 2.7, p90TtftSec: 3.9, p50Tps: 131.0, p90Tps: 66.0, requestCount: 5780, windowMinutes: 30 },
      ],
      series: {
        ttft7d: mkDailySeries(1.48, 1.84, 0.28, 2, 0.7, 4),
        tps7d: mkDailySeries(141, 130, 12, 1, 90, 185),
        cache7d: mkDailySeries(79.4, 81.2, 3.8, 1, 55, 95),
        uptime24h: mkUptime24h(99.8, -1, 0),
      },
      local: {
        calls7d: 88,
        p50TtftSec: 0.96,
        p90TtftSec: 2.1,
        hitP50TtftSec: 0.84,
        missP50TtftSec: 2.6,
        p50Tps: 148.6,
        cacheHitPct: 84.5,
        calls30m: 9,
        p50Ttft30mSec: 0.92,
        p50Tps30m: 151.2,
        cacheHit30mPct: 86.1,
        calls24h: 31,
        p50Ttft24hSec: 0.95,
        p50Tps24h: 149.4,
        cacheHit24hPct: 85.0,
        daily7d: mkLocalDaily(0.95, 148.6, 84.5),
      },
    },
    {
      family: 'gemini-4-carbon',
      slug: 'google/gemini-4-carbon',
      permaslug: 'google/gemini-4-carbon-20261110',
      label: 'Gemini 4 Carbon',
      status: 'degraded',
      p50TtftSec: 6.45,
      p75TtftSec: 10.8,
      p90TtftSec: 17.6,
      p50Tps: 56.0,
      p90Tps: 21.0,
      cacheHitPct: 81.8,
      uptime30mPct: 94.2,
      requestCount30m: 29470,
      windowMinutes: 30,
      primaryProvider: 'Google Vertex',
      degradedProviders: ['Google Vertex'],
      endpoints: [
        { endpointId: 'ep-carb-v', providerName: 'Google Vertex', providerSlug: 'google-vertex', cacheHitPct: 81.4, p50TtftSec: 6.45, p75TtftSec: 10.8, p90TtftSec: 17.6, p50Tps: 56.0, p90Tps: 21.0, requestCount: 23800, windowMinutes: 30 },
        { endpointId: 'ep-carb-s', providerName: 'Google AI Studio', providerSlug: 'google-ai-studio', cacheHitPct: 83.1, p50TtftSec: 4.92, p75TtftSec: 7.9, p90TtftSec: 12.8, p50Tps: 68.0, p90Tps: 28.0, requestCount: 5670, windowMinutes: 30 },
      ],
      series: {
        ttft7d: mkDailySeries(5.9, 4.8, 1.35, 2, 2.5, 13),
        tps7d: mkDailySeries(58, 69, 9, 1, 28, 105),
        cache7d: mkDailySeries(81.5, 83.2, 4.6, 1, 55, 95),
        uptime24h: mkUptime24h(98.4, 34, 14),
      },
      local: {
        calls7d: 196,
        p50TtftSec: 1.48,
        p90TtftSec: 3.42,
        hitP50TtftSec: 1.32,
        missP50TtftSec: 4.2,
        p50Tps: 94.2,
        cacheHitPct: 88.6,
        calls30m: 18,
        p50Ttft30mSec: 1.44,
        p50Tps30m: 96.8,
        cacheHit30mPct: 90.2,
        calls24h: 64,
        p50Ttft24hSec: 1.46,
        p50Tps24h: 95.1,
        cacheHit24hPct: 89.1,
        daily7d: mkLocalDaily(1.48, 94.2, 88.6),
      },
    },
    {
      family: 'gemini-3.8-flash',
      slug: 'google/gemini-3.8-flash',
      permaslug: 'google/gemini-3.8-flash-20260902',
      label: 'Gemini 3.8 Flash',
      status: 'ok',
      p50TtftSec: 1.98,
      p75TtftSec: 2.74,
      p90TtftSec: 4.35,
      p50Tps: 91.0,
      p90Tps: 42.0,
      cacheHitPct: 68.4,
      uptime30mPct: 100,
      requestCount30m: 268400,
      windowMinutes: 30,
      primaryProvider: 'Google Vertex',
      degradedProviders: [],
      endpoints: [
        { endpointId: 'ep-fl-v', providerName: 'Google Vertex', providerSlug: 'google-vertex', cacheHitPct: 67.9, p50TtftSec: 1.98, p75TtftSec: 2.74, p90TtftSec: 4.35, p50Tps: 91.0, p90Tps: 42.0, requestCount: 214000, windowMinutes: 30 },
        { endpointId: 'ep-fl-s', providerName: 'Google AI Studio', providerSlug: 'google-ai-studio', cacheHitPct: 70.1, p50TtftSec: 2.34, p75TtftSec: 3.25, p90TtftSec: 5.1, p50Tps: 84.0, p90Tps: 37.0, requestCount: 54400, windowMinutes: 30 },
      ],
      series: {
        ttft7d: mkDailySeries(1.94, 2.3, 0.35, 2, 0.9, 5),
        tps7d: mkDailySeries(90, 84, 7, 1, 55, 130),
        cache7d: mkDailySeries(68.2, 70.4, 5.0, 1, 45, 88),
        uptime24h: mkUptime24h(99.9, -1, 0),
      },
      local: {
        calls7d: 210,
        p50TtftSec: 0.78,
        p90TtftSec: 1.64,
        hitP50TtftSec: 0.72,
        missP50TtftSec: 1.9,
        p50Tps: 121.4,
        cacheHitPct: 82.1,
        calls30m: 12,
        p50Ttft30mSec: 0.76,
        p50Tps30m: 124.0,
        cacheHit30mPct: 84.0,
        calls24h: 52,
        p50Ttft24hSec: 0.77,
        p50Tps24h: 122.5,
        cacheHit24hPct: 83.2,
        daily7d: mkLocalDaily(0.78, 121.4, 82.1),
      },
    },
  ];
  const activePulseModel = geminiPulseModels[0]; // gemini-4-neon matches latest invocation
  const geminiPulse = {
    enabled: true,
    available: true,
    loading: false,
    stale: false,
    fetchedAtMs: NOW - 42_000,
    overallStatus: 'degraded',
    models: geminiPulseModels,
    incidents: [],
    activeFamily: 'gemini-4-neon',
    activeModel: activePulseModel,
    attribution: {
      verdict: 'normal',
      family: 'gemini-4-neon',
      label: 'Gemini 4 Neon',
      currentTtftSec: latest.ttftSec,
      currentTps: latest.genTps,
      currentCachePct: latest.cacheHitPct,
      currentNewInput: latest.newInput,
      inFlightCount: 0,
      localP50TtftSec: 1.38,
      localP90TtftSec: 3.12,
      localBucket: 'hit',
      globalP50TtftSec: activePulseModel.p50TtftSec,
      globalP90TtftSec: activePulseModel.p90TtftSec,
      globalP50Tps: activePulseModel.p50Tps,
      globalCachePct: activePulseModel.cacheHitPct,
      globalUptime30mPct: activePulseModel.uptime30mPct,
      globalStatus: activePulseModel.status,
      globalRequests30m: activePulseModel.requestCount30m,
      activeIncidentCount: 0,
    },
  };

  const snapshot = {
    found: true,
    etag: 'hd-fixture-v4',
    bootId: 'boot-hd-20261124',
    assetKey: 'asset-hd-v4',
    mode: 'auto',
    conversationId: CONV_ID,
    dbPath: '/Users/dev/.gemini/antigravity/conversations/9a7c4e21.db',
    serverTimeMs: NOW,
    conversations: [
      {
        id: CONV_ID,
        updatedMs: NOW - 8_000,
        title: isZh ? 'AGY-HUD v1.2 遥测与发布协作' : 'AGY-HUD v1.2 Telemetry & Launch Swarm',
        kind: 'main',
        source: 'app',
        childCount: childSessions.length,
        costUSD: totalCostUSD,
        quotaUsage: {
          gemini: { pct5h: gem5h, pct7d: gem7d, isFitted: true },
        },
      },
      ...childSessions.map((ch) => ({
        id: ch.id,
        updatedMs: ch.updatedMs,
        title: ch.title,
        kind: 'subagent',
        source: 'app',
        parentId: CONV_ID,
        childCount: 0,
        costUSD: ch.costUSD,
        quotaUsage: ch.quotaUsage,
        swarmRosterName: ch.swarm.rosterName,
        swarmState: ch.swarm.swarmState,
      })),
    ],
    sessionInfo: {
      id: CONV_ID,
      title: isZh ? 'AGY-HUD v1.2 遥测与发布协作' : 'AGY-HUD v1.2 Telemetry & Launch Swarm',
      kind: 'main',
      subagentType: '',
      quotaUsage: {
        gemini: { pct5h: gem5h, pct7d: gem7d, isFitted: true },
      },
      parentSession: null,
      childSessions,
      treeTotals: {
        descendantCount: childSessions.length,
        swarmWorkerCount: childSessions.length,
        calls: invocations.length + demoChildCalls,
        outputTokens: totalOutput + demoChildOut,
        costUSD: totalCostUSD + demoChildCost,
        savedUSD: totalSavedUSD + demoChildSaved,
        pricedCount: invocations.length + demoChildPriced,
        unpricedCount: 0,
        childCalls: demoChildCalls,
        childOutputTokens: demoChildOut,
        childCostUSD: demoChildCost,
        childSavedUSD: demoChildSaved,
        childPricedCount: demoChildPriced,
        childUnpricedCount: 0,
        quotaUsage: {
          gemini: { pct5h: gem5h + demoChildGem5h, pct7d: gem7d + demoChildGem7d, isFitted: true },
        },
      },
      swarm: {
        swarmId: 'swarm-agy-hud-v12',
        coordinatorConvId: CONV_ID,
        swarmTitle: isZh ? 'AGY-HUD v1.2 遥测与发布协作' : 'AGY-HUD v1.2 Release Swarm',
        goalTitle: isZh ? 'Orchestrator 双模型编排与发布' : 'Orchestrator Dual-Model Swarm & Launch',
        goalLine: isZh ? 'Orchestrator (Neon) + Hydrogen Worker 双模型并行完成校准、审校与验收' : 'Orchestrator (Neon) + Hydrogen Worker shipping calibration, audit & CI',
        createdAt: '2026-11-24 20:10:00',
        boardSeq: 64,
        memberCount: 6,
        workingCount: 2,
        waitingCount: 2,
        stoppedCount: 0,
        killedCount: 2,
        isCoordinatorView: true,
        selfMember: {
          rosterName: 'coordinator',
          swarmRole: 'coordinator',
          swarmState: 'working',
          model: 'gemini-pro-orchestrator-neon',
        },
        threads: [
          {
            id: 't-core',
            title: isZh ? '核心遥测、配额与代码审校' : 'Core Telemetry, Quota & Code Audit',
            members: ['quota-solver', 'hud-ui', 'code-auditor'],
          },
          {
            id: 't-launch',
            title: isZh ? '云端大盘、官网与 CI 验收' : 'Global Pulse, Site & CI Verification',
            members: ['pulse-worker', 'site-launch', 'verifier'],
          },
        ],
      },
    },
    invocations,
    latest,
    latestSustained: latest,
    currentModel: {
      model: latest.model,
      modelId: latest.modelId,
      modelDisplay: latest.modelDisplay,
      isActive: false,
      stepType: null,
      toolName: '',
      statusName: 'IDLE',
    },
    summary: {
      count: invocations.length,
      userTurns: turns.length,
      totalSteps: stepIdx,
      toolStepCount: invocations.reduce((s, x) => s + x.stepToolCount, 0),
      totalOutput,
      totalThinking,
      totalCandidate,
      totalCachedInput,
      totalNewInput,
      avgCacheHitPct,
      avgTtftSec,
      totalModelSec,
      totalToolSec,
      avgGenTps,
      avgE2eTps,
      peakGenTps,
      totalCostUSD,
      totalSavedUSD,
      pricedCount: invocations.length,
      unpricedCount: 0,
      latestCallMs: latest.timestampMs,
      sessionQuota: {
        gemini: { pct5h: gem5h, pct7d: gem7d, isFitted: true },
      },
    },
    activeStep: null,
    pendingCompact: null,
    compactions,
    turns,
    contextBreakdown: {
      reportedTotal: 114_620,
      contextLimit: 256_000,
      systemPrompt: 11_840,
      toolsSchema: 15_280,
      chatMessages: 87_500,
      userInput: 6_920,
      assistant: 19_640,
      toolResults: 54_120,
      checkpoint: 4_820,
      sysMsg: 2_000,
      otherChat: 0,
      userAndOther: 13_740,
      // Additive finer breakdown fields (used by upgraded HUD X-Ray when present)
      mcpTools: 4_620,
      skills: 3_180,
      rules: 1_940,
      checkpointTokens: 4_820,
      systemPromptItems: [
        { name: 'identity', tokens: 2_820 },
        { name: 'guidelines', tokens: 2_000 },
        { name: 'skills', tokens: 3_180 },
        { name: 'workspace_rules', tokens: 1_940 },
        { name: 'swarm_protocol', tokens: 1_900 },
      ],
      toolSchemaItems: [
        { name: 'read_file', tokens: 2_860 },
        { name: 'edit_file', tokens: 2_440 },
        { name: 'run_command', tokens: 2_120 },
        { name: 'mcp_github_pull_requests', tokens: 2_840 },
        { name: 'mcp_browser_inspect', tokens: 1_780 },
        { name: 'swarm', tokens: 3_240 },
      ],
      toolResultsByTool: [
        { name: 'read_file', tokens: 23_840 },
        { name: 'run_command', tokens: 14_620 },
        { name: 'edit_file', tokens: 8_360 },
        { name: 'grep_search', tokens: 4_880 },
        { name: 'swarm', tokens: 2_420 },
      ],
    },
    accountQuota: {
      available: true,
      deferred: false,
      stale: false,
      name: 'Google AI Ultra',
      tierName: 'Google AI Ultra',
      planName: 'Pro',
      source: 'local_ls',
      fetchedAtMs: NOW - 8_000,
      pools: [
        {
          label: 'Gemini Pool',
          remainingPct: 68.4,
          resetTime: new Date(NOW + 3 * 3600_000 + 8 * 60_000).toISOString(),
          resetAtMs: NOW + 3 * 3600_000 + 8 * 60_000,
          modelCount: 5,
          heldByWeekly: false,
          windows: [
            {
              spanKey: '5h',
              label: '5h',
              remainingPct: 68.4,
              resetTime: new Date(NOW + 3 * 3600_000 + 8 * 60_000).toISOString(),
              resetAtMs: NOW + 3 * 3600_000 + 8 * 60_000,
              estSpentUSD: 15.8,
              estEffectiveSpentUSD: 47.4,
              estFullUSD: 150.0,
              estConfidence: 'high',
              estPricedCalls: 142,
              runway: {
                status: 'safe',
                burnPctPerHour: 7.4,
                exhaustInSec: Math.round((68.4 / 7.4) * 3600),
                exhaustAtMs: NOW + Math.round((68.4 / 7.4) * 3600_000),
                willExhaustBeforeReset: false,
                projectedRemAtResetPct: 45.2,
                basis: 'active_blend',
                habitBlended: true,
                habitWeight: 0.34,
                histBurnPctPerHour: 6.8,
              },
            },
            {
              spanKey: '7d',
              label: '7d',
              remainingPct: 81.6,
              resetTime: new Date(NOW + (4 * 24 + 11) * 3600_000).toISOString(),
              resetAtMs: NOW + (4 * 24 + 11) * 3600_000,
              estSpentUSD: 36.8,
              estEffectiveSpentUSD: 110.4,
              estFullUSD: 600.0,
              estConfidence: 'high',
              estPricedCalls: 940,
              runway: {
                status: 'safe',
                burnPctPerHour: 0.24,
                exhaustInSec: Math.round((81.6 / 0.24) * 3600),
                exhaustAtMs: NOW + Math.round((81.6 / 0.24) * 3600_000),
                willExhaustBeforeReset: false,
                projectedRemAtResetPct: 55.8,
                basis: 'active_blend',
                habitBlended: true,
                habitWeight: 0.28,
                histBurnPctPerHour: 0.22,
                activeHoursPerDay: 5.4,
              },
            },
          ],
          fitSummary: {
            quality: 'high',
            driftWarning: false,
            full5hUSD: 600.0,
            full7dUSD: 2400.0,
            gamma: 4.0,
            sampleCount: 46,
            shortCleanCount: 24,
            holdoutCount: 8,
            oosRelErrPct: 0.02,
            relErrPct: 0.02,
            models: [
              {
                family: 'gemini-4-neon',
                k: 1.0,
                beta: 0.1667,
                betaPlusMinus: 0.0014,
                source: 'fitted',
                mode: 'scalar',
                obsCalls: 2180,
              },
              {
                family: 'gemini-4-hydrogen',
                k: 1.0,
                beta: 0.1667,
                betaPlusMinus: 0.02,
                source: 'fitted',
                mode: 'scalar',
                obsCalls: 510,
              },
              {
                family: 'gemini-4-carbon',
                k: 3.0,
                beta: 0.5,
                betaPlusMinus: 0.05,
                source: 'fitted',
                mode: 'scalar',
                obsCalls: 86,
              },
            ],
          },
        },
        {
          label: 'Claude / GPT Pool',
          remainingPct: 84.5,
          resetTime: new Date(NOW + 3 * 3600_000 + 36 * 60_000).toISOString(),
          resetAtMs: NOW + 3 * 3600_000 + 36 * 60_000,
          modelCount: 4,
          heldByWeekly: false,
          windows: [
            {
              spanKey: '5h',
              label: '5h',
              remainingPct: 84.5,
              resetTime: new Date(NOW + 3 * 3600_000 + 36 * 60_000).toISOString(),
              resetAtMs: NOW + 3 * 3600_000 + 36 * 60_000,
              estSpentUSD: 3.08,
              estEffectiveSpentUSD: 3.08,
              estFullUSD: 20.69,
              estConfidence: 'high',
              estPricedCalls: 51,
              runway: {
                status: 'safe',
                burnPctPerHour: 12.4,
                exhaustInSec: Math.round((84.5 / 12.4) * 3600),
                exhaustAtMs: NOW + Math.round((84.5 / 12.4) * 3600_000),
                willExhaustBeforeReset: false,
                projectedRemAtResetPct: 39.8,
                basis: 'active_blend',
              },
            },
            {
              spanKey: '7d',
              label: '7d',
              remainingPct: 91.6,
              resetTime: new Date(NOW + (6 * 24 + 14) * 3600_000).toISOString(),
              resetAtMs: NOW + (6 * 24 + 14) * 3600_000,
              estSpentUSD: 3.08,
              estEffectiveSpentUSD: 3.08,
              estFullUSD: 41.38,
              estConfidence: 'high',
              estPricedCalls: 51,
              runway: {
                status: 'safe',
                burnPctPerHour: 0.42,
                exhaustInSec: Math.round((91.6 / 0.42) * 3600),
                exhaustAtMs: NOW + Math.round((91.6 / 0.42) * 3600_000),
                willExhaustBeforeReset: false,
                projectedRemAtResetPct: 74.2,
                basis: 'active_blend',
              },
            },
          ],
          fitSummary: {
            quality: 'provisional',
            driftWarning: false,
            full5hUSD: 20.69,
            full7dUSD: 41.38,
            gamma: 2.0,
            sampleCount: 7,
            shortCleanCount: 0,
            holdoutCount: 1,
            oosRelErrPct: 17.4,
            relErrPct: 17.4,
            models: [
              {
                family: 'claude-opus-5-5',
                k: 1.0,
                beta: 4.8328,
                betaPlusMinus: 1.39,
                source: 'provisional',
                mode: 'scalar',
                obsCalls: 51,
              },
            ],
          },
        },
      ],
    },
    accountHistory: {
      dbCount: 138,
      dbCountBySource: { app: 94, cli: 44 },
      indexedCount: 138,
      indexing: false,
      callsBySource: { app: 7120, cli: 2490 },
      costBySource: { app: 228.4, cli: 79.8 },
      totalCalls: 9610,
      totalOutput: 11_840_000,
      totalCostUSD: 308.2,
      totalSavedUSD: 892.6,
      pricedCount: 9580,
      unpricedCount: 30,
      todayCalls: todayEntry.calls,
      todayCostUSD: todayEntry.costUSD,
      todaySavedUSD: 14.2,
      monthCalls: 2340,
      monthCostUSD: 74.6,
      monthSavedUSD: 218.4,
      dailyHeatmap: {
        weeks: 16,
        weeks52: 52,
        activeDays: activeDays16,
        activeDays52,
        streakDays: streak,
        peakCostUSD: peak16.costUSD,
        peakDate: peak16.date,
        peakCostUSD52,
        peakDate52,
        days: days16,
        days52,
      },
    },
    cacheTtl,
    geminiPulse,
  };

  const updateStatus = {
    ok: true,
    status: 'up_to_date',
    currentVersion: '1.2.0',
    latestVersion: '1.2.0',
    updateAvailable: false,
    canSelfUpdate: true,
    blockReason: 'no_update',
    isLinked: false,
    installPath: '/Users/dev/.gemini/config/plugins/agy-hud',
    releaseUrl: 'https://github.com/skywalker512/agy-hud/releases/tag/v1.2.0',
    downloadUrl: null,
    assetKind: 'tar.gz',
    releaseNotes: null,
    publishedAt: '2026-11-24T12:56:00Z',
    checkedAtMs: NOW - 120_000,
    cached: true,
    updating: false,
  };

  // Align contextBreakdown.reportedTotal with latest.totalContext
  const ctxDelta = latest.totalContext - 114_620;
  if (ctxDelta !== 0) {
    snapshot.contextBreakdown.reportedTotal = latest.totalContext;
    snapshot.contextBreakdown.toolResults += ctxDelta;
    snapshot.contextBreakdown.chatMessages += ctxDelta;
    snapshot.contextBreakdown.toolResultsByTool[0].tokens += ctxDelta;
  }

  return { snapshot, callDetails, updateStatus, NOW };
}

window.__AGY_HUD_BUILD_FIXTURE__ = buildOrganicFixture;
})();
