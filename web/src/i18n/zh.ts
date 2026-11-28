import type { Translations } from './types';

export const zh: Translations = {
  lang: 'zh',
  title: 'AGY HUD',
  connecting: '连接中…',
  waitingModel: '等待模型响应数据…',
  optAuto: '跟随当前对话',
  optLatest: '自动最新活跃',
  tabLive: '实时',
  tabCalls: '调用',
  tabAccount: '账户',
  genLabel: '生成速度',
  livePill: '生成中',
  e2eLabel: '端到端速度',
  ctxLabel: '上下文窗口',
  kCache: '缓存',
  kIn: '新输入',
  kThk: '思考',
  kOut: '输出',
  kSys: '开销',
  kFree: '剩余',
  kSysPrompt: '系统提示',
  kToolsDef: '工具定义',
  kToolRes: '工具返回',
  kModel: '模型回复',
  kUserOther: '用户/存档',
  ctxToolsLabel: '工具占用',
  ctxToolDefsLabel: '工具定义',
  ctxTurnLabel: '本轮计费',
  ctxMoreTools: (n) => `其余 ${n} 项`,
  ctxToolChipTip: (name, tok, usedPct, winPct) =>
    `${name}: ${tok.toLocaleString()} tok（占已用 ${usedPct.toFixed(1)}% · 占窗口 ${winPct.toFixed(1)}%）`,
  ctxSysSecTitle: '系统提示明细:',
  ctxTdefTitle: (n) => `工具定义 Schema（共 ${n} 个）:`,
  ctxUserSplit: (u, c, s) =>
    `用户输入 ${u.toLocaleString()} · 检查点 ${c.toLocaleString()}${s > 0 ? ` · 系统消息 ${s.toLocaleString()}` : ''}`,
  avgGen: '加权 Gen',
  peakTps: '峰值速度',
  avgCache: '缓存 ',
  modelTime: '模型用时',
  toolTime: '工具 ',
  avgTtft: '平均 TTFT',
  totOut: '输出 ',
  recentTitle: '最近调用',
  viewAll: '查看全部',
  chartTitle: '调用趋势',
  tabTps: '速度',
  tabTtft: '首字',
  tabOut: '输出',
  tabCache: '缓存率',
  tabCtx: '上下文',
  tabQuota: '配额%',
  noCalls: '暂无调用记录',
  histTitle: '逐次调用明细',
  histHint: '点击行展开详情',
  badgeWait: (s) => `等首字 ${s}s`,
  badgeGen: (s) => `生成中 ${s}s`,
  badgeCompact: (s) => `压缩中 ${s}s`,
  badgeTool: (tool, s) => (tool ? `工具 · ${tool}${s ? ` ${s}s` : ''}` : `工具执行中${s ? ` ${s}s` : ''}`),
  badgeToolWait: (tool, s) => (tool ? `待确认 · ${tool}${s ? ` ${s}s` : ''}` : `等待中${s ? ` ${s}s` : ''}`),
  badgeStandby: '空闲',
  badgeStandbyTip: '已连接并监听会话库，当前无模型或工具请求在执行',
  badgeWaitTip: '请求已发出，正在等待首字返回 (TTFT)',
  badgeGenTip: '已收到首字，模型正在流式输出中',
  badgeCompactTip: '正在把历史上下文摘要压缩为检查点',
  badgeIdle: '等待对话',
  badgeRetry: '重连中…',
  noDb: '暂未检测到会话数据库',
  readErr: (e) => `读取失败: ${e}`,
  waitFirstCall: (id) => (id ? `会话 ${id}… · 等待首次模型调用` : '新对话 · 等待首次模型调用'),
  sessionMeta: (turns, steps, calls) => `${turns}轮 ${steps}步 · ${calls}次`,
  modelWaiting: (m) => `等首字 · ${m}`,
  modelRunning: (m) => `生成中 · ${m}`,
  modelCompact: (m) => `压缩中 · ${m}`,
  modelTool: (m, tool) => (tool ? `${m} · ${tool}` : `${m} · 工具中`),
  chartMeta: (n) => `${n} 次调用`,
  genSubSust: (sust, ms, tok) => `上次流式 ${sust} · 本次单包 ${ms}ms (${tok} tok)`,
  genSubBuf: (ms, tok) => `单包缓冲 ${ms}ms · 输出 ${tok} tok`,
  genSubOk: (tok, sec) => `${tok} tok · ${sec}`,
  e2eSub: (ttft, tot) => `TTFT ${ttft} · 共 ${tot}`,
  cacheBadge: (pct) => (pct === null ? '缓存 --' : `缓存 ${pct.toFixed(1)}%`),
  headroomLabel: (n) => `约余 ${n} 轮`,
  headroomTip: (n, avgDelta) =>
    `上下文余量估算：约还能进行 ${n} 轮\n按近期中位每轮增量 ~${avgDelta.toLocaleString()} tok 估算`,
  segTip: (name, tok, winPct, usedPct) =>
    `${name}: ${tok.toLocaleString()} tok（占窗口 ${winPct.toFixed(1)}% · 占已用 ${usedPct.toFixed(1)}%）`,
  tipBuf: (idx, m, ms, e2e, tok, cache, ttft) =>
    `#${idx} [${m}] · 单包缓冲 (${ms}ms) · E2E ${e2e} tok/s · TTFT ${ttft} · ${tok} tok · 缓存 ${cache}`,
  tipOk: (idx, m, gen, e2e, tok, cache, ttft) =>
    `#${idx} [${m}] · Gen ${gen} tok/s (E2E ${e2e}) · TTFT ${ttft} · ${tok} tok · 缓存 ${cache}`,
  tipTtft: (idx, m, ttft, gen, tot) => `#${idx} [${m}] · TTFT ${ttft} · 生成 ${gen} · 总耗时 ${tot}`,
  tipOut: (idx, m, out, thk, vis, gen) => `#${idx} [${m}] · 输出 ${out} tok（思考 ${thk} / 可见 ${vis}）· 生成 ${gen}`,
  tipCache: (idx, m, cachePct, cached, newIn) => `#${idx} [${m}] · 缓存命中 ${cachePct}（缓存 ${cached} / 新增 ${newIn}）`,
  tipCtx: (idx, m, used, lim, pct) => `#${idx} [${m}] · 上下文 ${used}/${lim} (${pct.toFixed(1)}%)`,
  tipQuota: (idx, m, pct5h, pct7d, kStr, costStr) =>
    `#${idx} [${m}] · 扣 5h 配额 -${pct5h}${pct7d ? `（7d -${pct7d}）` : ''} · ${kStr}× 倍率${costStr ? ` · 官网价 ${costStr}` : ''}`,
  chartSubTps: (n, avg, max, last) => `近 ${n} 次: 均值 ${avg} · 峰值 ${max} · 最新 ${last} tok/s`,
  chartSubTtft: (n, avg, max, last) => `近 ${n} 次: 均值 ${avg} · 最大 ${max} · 最新 ${last}`,
  chartSubOut: (n, avg, max, last) => `近 ${n} 次: 均值 ${avg} · 最大 ${max} · 最新 ${last} tok`,
  chartSubCache: (n, avg, min, last) => `近 ${n} 次: 均值 ${avg} · 最低 ${min} · 最新 ${last}`,
  chartSubCtx: (n, last, max) => `近 ${n} 次: 峰值 ${max} · 最新 ${last}`,
  chartSubQuota: (n, sum, avg, max) => `近 ${n} 次: 累计 -${sum} · 均次 -${avg} · 单次最高 -${max} (5h)`,
  chartAllModels: (n) => `全部 ${n}`,
  chartModelFilterTip: (name, count, avgStr, active) =>
    `${name} · ${count} 次调用${avgStr ? ` · 均值 ${avgStr}` : ''}\n${active ? '点击恢复全部模型' : '点击仅看该模型趋势'}`,
  histDetail: (tm, cached, newIn, out, thk, _ttft, gen, stallNote = '') =>
    `${tm ? tm + ' · ' : ''}生成 ${gen}${stallNote} · 输入 ${cached}+${newIn} · 输出 ${out} (思 ${thk})`,
  histStallNote: (sec) => ` · 工具等待 ${sec}`,
  histPhaseLine: (thkSec, tcSec, n) => `\n阶段: 思考 ${thkSec} · 工具生成 ${tcSec}${n ? `（${n} 个工具）` : ''}`,
  histFull: (idx, model, tm, cPct, cached, newIn, out, thk, vis, ttft, gen, e2e, ctxUsed, ctxLim, ctxPct) =>
    `#${idx} · ${model}${tm ? ' · ' + tm : ''}\n输入: 缓存 ${cached} + 新增 ${newIn}（命中 ${cPct}）\n输出: ${out} tok（思考 ${thk} / 可见 ${vis}）\n耗时: TTFT ${ttft} · 生成 ${gen} · E2E ${e2e} tok/s\n上下文: ${ctxUsed} / ${ctxLim}（${ctxPct.toFixed(1)}%）`,
  histBuf: (ms) => `缓冲 ${ms}ms`,
  loadingDetail: '正在按需加载正文详情…',
  noDetailBody: '该步骤无思考摘要 / 回复正文或工具调用记录。',
  waitOut: '等待模型输出…',
  liveWaitBadge: '等待首字',
  liveStreamBadge: '流式生成',
  liveRowTagWait: '等待中',
  liveRowTagStream: '进行中',
  liveWaitDetail: (sec, startTm) => `等待 TTFT ${sec}s…${startTm ? `（发于 ${startTm}）` : ''}`,
  liveStreamDetail: (ttftStr, genSec) => `TTFT ${ttftStr} 已返回 · 生成中 ${genSec}s…`,
  lblThinking: '思考摘要',
  lblReply: '模型回复',
  lblChars: (c, trunc) => (trunc ? ` · 最新段 · ${c} 字` : ` · ${c} 字`),
  lblToolCalls: '工具调用',
  lblSummary: '压缩摘要内容',
  compactFilterBtn: (n, on) => (on ? `压缩记录 (${n})` : `含 ${n} 次压缩`),
  compactBadge: '上下文压缩',
  compactLiveBadge: '压缩中',
  compactLiveDetail: (sec, startTm, ctxStr) =>
    `正在压缩${ctxStr ? ` ${ctxStr}` : ''} 上下文 · ${sec}s…${startTm ? `（开始于 ${startTm}）` : ''}`,
  compactDetail: (tm, cached, newIn, out, sec, dropStr) =>
    `${tm ? tm + ' · ' : ''}${sec} · ${dropStr ? dropStr + ' · ' : ''}输入 ${cached}+${newIn} · 摘要 ${out}`,
  compactFull: (stepIdx, model, tm, dropStr, cached, newIn, out, thk, vis, sec) =>
    `上下文压缩 step #${stepIdx} · ${model}${tm ? ' · ' + tm : ''}${dropStr ? `\n窗口变化: ${dropStr}` : ''}\n输入: 缓存 ${cached} + 新增 ${newIn}\n摘要输出: ${out} tok（思考 ${thk} / 摘要 ${vis}）\n耗时: ${sec}`,
  noCompactions: '暂无上下文压缩记录',
  foldAllTurns: '折叠轮次',
  unfoldAllTurns: '展开轮次',
  showAllHistoryBtn: (shown, total) => `展开全部 ${total} 条调用（当前显示最近 ${shown} 条）`,
  collapseHistoryBtn: (limit) => `仅显示最近 ${limit} 条`,
  turnDividerBadge: (n) => `第 ${n} 轮`,
  turnDividerStats: (calls, outStr, secStr, compacts = 0, quotaStr = '') => {
    const parts: string[] = [];
    if (calls > 0) parts.push(`${calls}次`);
    if (compacts > 0) parts.push(calls > 0 ? `+${compacts}压缩` : '压缩');
    if (outStr) parts.push(outStr);
    if (secStr) parts.push(secStr);
    if (quotaStr) parts.push(`-${quotaStr}`);
    return parts.join(' · ');
  },
  turnDividerTip: (n, tm, calls, outTok, secStr, prompt, compacts = 0, quotaStr = '') =>
    `第 ${n} 轮对话${tm ? ' · ' + tm : ''}\n模型调用: ${calls} 次${compacts > 0 ? ` · 上下文压缩: ${compacts} 次` : ''} · 输出: ${outTok.toLocaleString()} tok${secStr ? ' · 耗时: ' + secStr : ''}${quotaStr ? ` · 扣 5h 配额: -${quotaStr}` : ''}${prompt ? `\n\n${prompt}` : ''}`,
  btnCopyId: '复制 ID',
  btnCopyJsonl: '复制 JSONL',
  btnCopyJsonlFull: '完整 JSONL',
  copied: '已复制',
  tipCopyId: (id) => `点击复制对话 ID:\n${id}`,
  tipCopyJsonl: (p, exists) => `点击复制 transcript.jsonl 路径${exists ? '' : '（暂未生成）'}:\n${p}`,
  tipCopyJsonlFull: (p, exists) => `点击复制 transcript_full.jsonl 路径${exists ? '' : '（暂未生成）'}:\n${p}`,
  kindMain: '主会话',
  kindSq: 'SIDE Q',
  kindSub: '子会话',
  backParent: (lbl) => `返回父会话 · ${lbl}`,
  linkedCount: (n) => `${n} 个关联会话`,
  linkedRunningCount: (active, total) => `${active}/${total} 运行中`,
  childRunningBadge: (kind) =>
    kind === 'gen' ? '生成中' : kind === 'tool' ? '工具中' : kind === 'compact' ? '压缩中' : '进行中',
  childFinishedBadge: '已结束',
  childHeaderRunning: (n) => `${n} 进行中`,
  linkedTitle: '挂载子会话 / Side Q',
  linkedHint: '点击跳转查看',
  jumpAction: '进入',
  linkedMeta: (calls, outStr, costStr, quotaStr = '') =>
    `${calls} 次调用 · 输出 ${outStr}${costStr ? ` · ${costStr}` : ''}${quotaStr ? ` · 配额 ${quotaStr}` : ''}`,
  cacheAgeLabel: (ageStr) => `距上次 ${ageStr}`,
  cacheAgeTip: (ageStr, tm) =>
    `距上次模型调用已过 ${ageStr}（${tm}）\n可用于估算缓存余温（平台未直接暴露服务端 TTL）`,
  sessionCostPill: (costStr, savedStr) => `${costStr}${savedStr ? ` · 省 ${savedStr}` : ''}`,
  sessionCostTip: (costStr, savedStr, priced, unpriced) =>
    `API 等价成本: ${costStr}\n缓存节省: ${savedStr}\n已计价调用: ${priced} 次${unpriced ? ` · 未定价模型 (GPT-OSS): ${unpriced} 次` : ''}`,
  sessionQuotaPill: (val) => `配额 ${val}`,
  sessionQuotaPoolLine: (poolName, active5h, active7d, expired5h, fallback5h, isFitted) => {
    if (!active5h && !active7d && fallback5h) {
      return `${poolName} 池: 约 -${fallback5h}（按 5h 池折算）`;
    }
    const tag = isFitted ? '' : ' [初估]';
    const cur5 = active5h ? `-${active5h}` : '0%（已随重置清零）';
    const cur7 = active7d ? `\n  • 当前 7d 周窗口占用: -${active7d}` : '';
    const exp = expired5h ? `\n  （更早窗口的 -${expired5h} 已随 5h 刷新清零，不再占当前 5h 池）` : '';
    return `${poolName} 池${tag}:\n  • 当前 5h 窗口占用: ${cur5}${cur7}${exp}`;
  },
  sessionQuotaTip: (lines) => `本对话当前实际占用的额度比例:\n${lines}`,
  accountTitle: '配额与消耗',
  tierBadgeTip: ({ tierId, multiplier, source, fitted5hStr }) => {
    const lines: string[] = [];
    if (multiplier) {
      if (source === 'verified') {
        lines.push(`已核验 ${multiplier} 档位（官方 Tier ID 与实测 5h 容量一致）`);
      } else if (source === 'tier_id') {
        lines.push(`来自官方 Tier ID 的 ${multiplier} 档位（待实测样本交叉核验）`);
      } else if (source === 'fitted') {
        lines.push(`基于实测 5h 容量推算的 ~${multiplier} 档位`);
      }
    }
    if (tierId) lines.push(`Tier ID: ${tierId}`);
    if (fitted5hStr) lines.push(`Gemini 实测 5h 容量: ~${fitted5hStr}`);
    return lines.join('\n');
  },
  creditsRealMini: (c) => `额外积分: ${c}`,
  creditsRealTip: (c) => `当前可用额外积分 (Credits): ${c}`,
  quotaRefreshTip: (tm) => `强制刷新配额（默认 5 分钟缓存，且仅在打开账户页时请求）${tm ? `\n上次同步: ${tm}` : ''}`,
  quotaDeferred: '正在同步账户双窗口配额…',
  quotaOffline: '未注入 LS 环境变量，暂无法拉取实时配额（本地账单统计正常）',
  heldByWeeklyTag: '受周限锁定',
  winMeta: (pct, resetStr) => `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%${resetStr ? ` · ${resetStr}` : ''}`,
  winBudgetEst: (spent, full, lowSample, remote, effSpent) =>
    `满额 ~${full}${lowSample ? ' (初估)' : ''} · 本机 ${spent}${effSpent ? ` (折算 ${effSpent})` : ''}${remote ? ` + 约${remote} 他端` : ''}`,
  winSpentOnly: (spent, minPct = '0.5%') => `窗内已用 ${spent} (<${minPct} 样本)`,
  winTokCapLine: (remTok, fullTok, cachePct, isProv) =>
    `约余 ${remTok} / 满 ${fullTok} tok（按 ${cachePct} 缓存${isProv ? ' · 初估' : ''}）`,
  winTokCapCompact: (remTok, fullTok, cachePct) =>
    `约余 ${remTok} / ${fullTok} tok · ${cachePct} 缓存`,
  winTokCapTip: ({
    spanLabel,
    remTok,
    fullTok,
    remCacheTok,
    remNewTok,
    remOutTok,
    fullCacheTok,
    fullNewTok,
    fullOutTok,
    cachePct,
    outSharePct,
    calls,
    basisWindow,
    isProv,
  }) =>
    `按现有缓存比例推算的 ${spanLabel} 额度 Token 量${isProv ? '（初估）' : ''}：\n` +
    `• 当前剩余可用：约 ${remTok} tok（缓存 ${remCacheTok} · 新入 ${remNewTok} · 输出 ${remOutTok}）\n` +
    `• 满池总容量：约 ${fullTok} tok（缓存 ${fullCacheTok} · 新入 ${fullNewTok} · 输出 ${fullOutTok}）\n` +
    `• 推算依据：该池近 ${basisWindow === '7d' ? '7天' : '30天'} ${calls.toLocaleString()} 次本地调用均值（缓存命中 ${cachePct} · 输出占比 ${outSharePct}）\n` +
    `注：实际可用 Token 量会随所选模型倍率与缓存命中率动态变化。`,
  rulesTankTokSub: (remTok, fullTok, cachePct) => `余 ~${remTok} / ${fullTok} tok（${cachePct}缓存）`,
  winRunwayWarn: (dur, clock) => `照此速度约 ${dur} 后触顶 (${clock})`,
  winRunwaySafe: (remAtReset) => `重置前预计余 ~${remAtReset}`,
  winRunwayExhausted: '额度已耗尽 · 等待窗口重置',
  winRunwayTip: (burnPerHr, exhaustDur, exhaustClock, remAtReset, willExhaust, isRecent, habitBlended, activeHoursPerDay) => {
    const basisNote = habitBlended
      ? `融合了你的历史作息节奏${activeHoursPerDay ? `（日均活跃约 ${activeHoursPerDay.toFixed(1)} 小时）` : ''}，避免周期初期短时冲高导致预测失真`
      : isRecent
        ? '近期活跃速率 + 窗口均速加权'
        : '按当前窗口平均速率';
    return `当前消耗节奏: 约 -${burnPerHr}/小时（${basisNote}）\n${
      willExhaust
        ? `预计在重置前约 ${exhaustDur} 后（${exhaustClock} 左右）触及上限`
        : `若维持当前节奏，等到窗口重置时预计还剩 ~${remAtReset}`
    }`;
  },
  rulesTitle: '配额扣费规则',
  rulesAccHigh: (errStr, wins) => `${wins}窗实测 · 误差 ${errStr}`,
  rulesAccProv: (wins) => `校准积累中 (${wins}窗)`,
  rulesDriftBadge: '计费变动重算中',
  rules5hTankLabel: '5h 充值池面值',
  rules7dTankLabel: (ratioStr) => `7d 周池面值 (${ratioStr ? `${ratioStr}× 5h池` : '7d'})`,
  rulesTankRemSub: (remPct, remUsd) => `剩 ${remPct}（约余 ${remUsd}）`,
  rulesTankTip: (cap5h, cap7d) =>
    `可以把这个配额池当成一张面值约 ${cap5h} 的「虚拟额度卡」（每 5 小时自动补满${cap7d ? `；7d 周池面值约 ${cap7d}` : ''}）：\n• 1× 标准模型：官网 API 算出来值 $1，池子就实扣 $1（满池真能跑 ${cap5h} 的量）；\n• 3× 高倍模型：官网 API 算出来值 $1，池子会按 3 倍扣掉 $3（所以全用它满池只够跑 1/3 的量）。\n注：这是配额折算尺子，不是向你真实扣费的账单。`,
  rulesFormulaPill: (kStr, deductUsd) => `API $1 → 扣池 ${deductUsd} (${kStr}×)`,
  rulesEffectiveApiCap: (usableApiUsd, poolFullUsd, isShrink) =>
    `单用它刷满 5h 池 ≈ 可跑 ${usableApiUsd} 官网 API 量${isShrink ? `（由 ${poolFullUsd} 缩水）` : '（1:1 满额）'}`,
  rulesSourceTag: (isFitted) => (isFitted ? '实测' : '1× 基准'),
  rulesTokBurnStrip: (inPct, caPct, outPct, fullOutTok) =>
    `每百万 tok 扣 5h 池: 新输入 -${inPct}% · 缓存 -${caPct}% · 输出 -${outPct}%（约 ${fullOutTok} 输出刷满）`,
  rulesPerTokCapBadge: (fullOutTok) => `约 ${fullOutTok} 输出刷满 5h 池`,
  rulesTokInLabel: '新输入',
  rulesTokCacheLabel: '缓存命中',
  rulesTokOutLabel: '思考+输出',
  rulesTokCapSub: (tok) => `满池 ~${tok}`,
  rulesModelTip: (family, kStr, deductUsd, usableApiUsd, obsCalls, isFitted) =>
    `${family}\n扣池规则：每产生 $1 官网公开 API 价格，从额度池中扣掉 ${deductUsd}（即 ${kStr}× 倍率）。\n满池体感：如果 5h 内只用该模型，100% 额度大约等于跑了 ${usableApiUsd} 的官网 API 调用量。\n数据来源：${isFitted ? `本机 ${obsCalls} 次调用微窗实测对账` : '按公开 API 价格 1:1 基准对齐'}`,
  heatmapTitle: '活跃趋势',
  heatmapSummary: (activeDays, streakDays, peakUsd) =>
    `活跃 ${activeDays} 天${streakDays > 1 ? ` · 连续 ${streakDays} 天` : ''}${peakUsd ? ` · 单日最高 ${peakUsd}` : ''}`,
  heatmapLess: '少',
  heatmapMore: '多',
  heatmapMonths: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  heatmapWeekdays: ['一', '三', '五'],
  heatmapDayTip: (dateStr, costStr, calls, appCalls, cliCalls, outStr) =>
    `${dateStr}\nAPI 等价消耗: ${costStr} · 共 ${calls} 次调用${cliCalls > 0 ? `（App ${appCalls} / CLI ${cliCalls}）` : ''}\n输出生成: ${outStr} tok`,
  heatmapEmptyTip: (dateStr) => `${dateStr}\n当日无本地调用记录`,
  poolTip: (label, winsText, held, fitNotes, driftWarn) =>
    `${label}\n${winsText}${held ? '\n周限 (7d) 已耗尽，需等待周重置后解锁 5h 额度' : ''}${fitNotes ? `\n${fitNotes}` : ''}${driftWarn ? `\n平台计费口径可能变化（偏离先验 >3σ 或区间外误差超标，已自动降为初估）` : ''}\n纯本地只读统计：满额 F = 100 / beta_ref 按公开 API 参考价折算（并非向银行卡真实扣费）。`,
  poolFitTipLine: (modelsStr, gammaStr, shortCount, errLabel) =>
    `模型拟合: ${modelsStr}${gammaStr ? ` · 7d/5h=${gammaStr}` : ''}（${shortCount} 短窗 · ${errLabel}）`,
  remoteWinBanner: (remoteUsd) => `他机/云端差额（未计入本机统计）: +约 ${remoteUsd}`,
  remoteWinBannerTip:
    '根据当前活跃窗口的账户配额残差推算的其他设备/云端用量（未计入上方「本月/本机全部」本地账单）。上方金额仅统计本机 App + CLI 落盘数据库。',
  accountSpendScopeLabel: '全账号消耗（所有端）',
  accountSpendProvTag: '金额初估',
  accountSpendWeek: '近7日',
  accountSpendTracked: '已追踪',
  accountSpendDaysSub: (days, resets) => (resets > 0 ? `${days}天 · ${resets}次重置` : `已追踪 ${days}天`),
  accountSpendScopeTip:
    '基于服务端账号级配额快照累计的所有设备总消耗（即使中途发生 Gemini 重置也会保留重置前用量）。百分比为云端实测、多端同口径；美元按各池最新满额折算。',
  accountResetBanner: (count, poolLabel, spanKey, reclaimedStr, clockStr) =>
    `近30天记录 ${count} 次服务端重置（最近: ${poolLabel} ${spanKey} 返还 +${reclaimedStr} · ${clockStr}）`,
  accountResetKindInWindow: '同窗重置',
  accountResetKindEarlyShift: '提前换窗',
  accountResetTipTitle: '检测到的服务端中途重置（重置前消耗已保留计入全账号总计）',
  spendSession: '当前会话',
  spendToday: '今日',
  spendMonth: '本月',
  spendAll: '本机全部',
  spendAllSourceTip: (appCost, appCalls, appDbs, cliCost, cliCalls, cliDbs) =>
    `本机数据库来源明细:\nApp: ${appCost}（${appCalls} 次 · ${appDbs} 会话）\nCLI (agy): ${cliCost}（${cliCalls} 次 · ${cliDbs} 会话）`,
  spendSavedSub: (s) => `缓存省 ${s}`,
  spendCallsSub: (n, dbs) => `${n} 次${dbs ? ` · ${dbs}会话` : ''}`,
  spendIndexingSub: (idx, tot) => `后台索引 ${idx}/${tot} 库…`,
  unpricedNote: (n) => `本机 App+CLI 按公开 API 单价折算 · 不含 ${n} 次未定价调用 (GPT-OSS) 与缓存写入溢价`,
  pricedAllNote: '本机 App+CLI 按公开 API 单价折算（不含缓存写入溢价；仅反映订阅等效消耗）',
  histCostTip: (costStr, savedStr) => `\n估算成本: ${costStr}${savedStr ? `（缓存节省 ${savedStr}）` : ''}`,
  histUnpricedTip: '\n估算成本: 暂无公开定价 (GPT-OSS)',
  histQuotaPillTip: (pct5h, err5h, pct7d, kStr, isFitted) =>
    `推算 5h 配额扣减: -${pct5h}${err5h ? ` ± ${err5h}` : ''}${pct7d ? ` · 7d: -${pct7d}` : ''} · ${kStr}× 权重（${isFitted ? '实测拟合' : '先验初估'}）`,
  histQuotaLine: (pct5h, err5h, pct7d, kStr, isFitted) =>
    `\n配额扣减: -${pct5h}${err5h ? ` ± ${err5h}` : ''} (5h)${pct7d ? ` · -${pct7d} (7d)` : ''} · ${kStr}× 权重${isFitted ? '' : '（初估）'}`,
  noDbEmpty: '暂未检测到活跃会话数据库。',

  // OpenRouter-style Call Detail Inspector
  inspTabOverview: '概览',
  inspTabThinking: '思考',
  inspTabTools: '工具',
  inspTabReply: '回复',
  inspTabRaw: '原始',
  inspCopyMd: 'MD',
  inspCopyJson: 'JSON',
  inspCopy: '复制',
  inspCopyArgs: '复制参数',
  inspCopyMdReport: '复制 Markdown 报告',
  inspCopyFullJson: '复制完整 JSON',
  inspGenE2e: '生成 / E2E',
  inspTtftTotal: '首字 / 总耗时',
  inspCacheHit: '缓存命中',
  inspCostQuota: '成本 / 5h配额',
  inspTtftFast: '快速',
  inspTtftMid: '中等',
  inspTtftSlow: '偏慢',
  inspSaved: (s) => `省 ${s}`,
  inspCachedTok: (tok) => `缓存 ${tok}`,
  inspUnpriced: '未定价',
  inspFitFitted: '实测',
  inspFitProv: '初估',
  inspWaterfallTitle: '耗时瀑布',
  inspPhaseTtft: '首字等待',
  inspPhaseThink: '思考',
  inspPhaseTool: '工具生成',
  inspPhaseToolStall: '工具阻塞',
  inspPhaseStream: '流式输出',
  inspPhaseGen: '生成',
  inspTokenCompTitle: 'Token 构成',
  inspPromptLbl: (total, pct) => `输入 ${total}（${pct} 命中缓存）`,
  inspOutputLbl: (total, thkPct) => `输出 ${total}${thkPct > 0 ? `（${thkPct}% 思考）` : ''}`,
  inspCachedSeg: '缓存',
  inspNewInSeg: '新输入',
  inspThinkSeg: '思考',
  inspVisibleSeg: '可见',
  inspMetaRouted: '路由模型',
  inspMetaCtx: '上下文',
  inspMetaPricing: '计费键',
  inspTruncated: '已截断',
  inspChars: (n) => `${n} 字`,
  inspNoArgs: '（无参数）',
  inspBufTag: '单包',
  inspStallTag: '工具慢',

  // Call Explorer Toolbar & Export
  searchPlaceholder: '搜索 #序号、模型、工具、提示词… (/)',
  sortTimeline: '时间序（最新）',
  sortSlowest: '总耗时最长',
  sortTtft: '首字最慢',
  sortLowTps: '生成最慢',
  sortCost: '成本 / 配额最高',
  chipSlowTtft: (n) => `慢首字 >3s (${n})`,
  chipLowCache: (n) => `低缓存 <60% (${n})`,
  chipStallBuf: (n) => `阻塞/单包 (${n})`,
  chipModelFilter: (m) => `模型: ${m}`,
  filterBanner: (shown, total) => `已筛选 ${shown} / ${total} 次调用`,
  filterClear: '清除',
  filterNoMatches: '当前筛选条件下无匹配调用。',
  btnExport: '导出',
  btnCopyReportMd: '复制会话报告 (MD)',
  btnExportJson: '导出遥测数据 (JSON)',
  exportedJsonCopied: '已复制 JSON',
  exportedJsonSaved: '已导出 JSON',

  // Self-Update UI (TopBar & AccountTab)
  updatePillTip: (cur, next) => `发现新版本：v${cur} → v${next}（点击查看）`,
  menuCheckUpdates: '检查更新',
  menuCheckingUpdates: '检查中…',
  menuDevTag: '开发',
  updateCardTitle: '插件与版本更新',
  updateModeInstalled: '标准安装',
  updateModeDev: '开发软链',
  updateBtnCheck: '检查',
  updateBtnChecking: '检查中…',
  updateBtnNow: '立即更新',
  updateBtnUpdating: '更新中…',
  updateBtnReload: '立即重载',
  updateReleaseNotes: '更新日志',
  updateStatusUpToDate: '已是最新版本',
  updateStatusAhead: '高于最新发行版',
  updateStatusAvailable: (cur, next) => `发现新版本：v${cur} → v${next}`,
  updateStatusOffline: '无法连接 GitHub Releases（离线或网络异常）',
  updateStatusRateLimited: 'GitHub API 触发限流，请稍后重试',
  updateStatusError: (msg) => `检查失败：${msg}`,
  updateDevHint: '当前为开发软链模式 — 请通过 git pull 或运行 node plugin/install.mjs --update 更新。',
  updateAppliedMsg: (ver) => `已更新至 v${ver}，请重载 HUD 面板生效。`,
  updateApplyFailed: (msg) => `更新失败：${msg}`,
  updateCliFallback: '手动命令：',
  updateLastChecked: (tm) => `上次检查 ${tm}`,

  // HeroSpeedCards & LiveTab Model Mix
  heroDeltaTip: (deltaPct, avgTps) => `较会话均值 (${avgTps} tok/s) ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`,
  heroSparkTip: (n) => `近 ${n} 次流式调用生成速度趋势`,
  e2eSplitTtftLabel: '首字占',
  e2eSplitGenLabel: '生成',
  e2eSplitTip: (ttftSec, ttftPct, genSec, genPct, genTps, e2eTps) =>
    `本轮耗时构成：\n首字等待 (TTFT) ${ttftSec}（占 ${ttftPct}%）· 流式生成 ${genSec}（占 ${genPct}%）\n首字等待将端到端速度 (${e2eTps} tok/s) 从纯生成速度 (${genTps} tok/s) 拉低。`,
  modelMixTitle: '会话模型分布',
  modelMixCalls: (n) => `${n}次`,
  modelMixColModel: '模型',
  modelMixColCalls: '调用',
  modelMixColGen: '速度',
  modelMixColTtft: '首字',
  modelMixColCache: '缓存',
  modelMixColCost: '成本 / 配额',

  // Cache Survival & Expiration (Live Prediction & Account Stats)
  cacheSurvPill: (probPct, ageStr) => `存活 ~${probPct}% · ${ageStr}`,
  cacheSurvTip: ({
    ageStr,
    lastClock,
    probPct,
    familyName,
    p80Str,
    p50Str,
    remSafeStr,
    remHalfStr,
    pastHalf,
    sourceLabel,
    ctxTokStr,
    missUsdStr,
    missQuotaStr,
  }) => {
    const lines = [
      `距上次调用 ${ageStr}（${lastClock}）· 预计缓存存活概率 ~${probPct}%`,
      `${familyName} · 安全窗(P80) ~${p80Str} · 半衰期(P50) ~${p50Str}（${sourceLabel}）`,
    ];
    if (pastHalf) {
      lines.push('已超过半衰期，下次发送极可能触发全量重算');
    } else if (remSafeStr) {
      lines.push(`距 P80 安全线约余 ${remSafeStr} · 距半衰期约余 ${remHalfStr}`);
    } else if (remHalfStr) {
      lines.push(`已过 P80 安全线 · 距半衰期约余 ${remHalfStr}`);
    }
    if (missUsdStr) {
      lines.push(
        `若失效重算（${ctxTokStr} 上下文）：多花约 ${missUsdStr}${missQuotaStr ? `（约多扣 ${missQuotaStr} 5h 配额）` : ''}`,
      );
    }
    return lines.join('\n');
  },
  cacheTtlCardTitle: '缓存存活曲线',
  cacheTtlHeaderSummary: (pairs, missUsdStr) =>
    `${pairs.toLocaleString()} 对样本${missUsdStr ? ` · +${missUsdStr}` : ''}`,
  cacheTtlEmpty: '正在积累同模型连续调用间隔样本…',
  cacheTtlKindLru: 'LRU 衰减',
  cacheTtlKindHard: '硬 TTL',
  cacheTtlKindMixed: '实测拟合',
  cacheTtlConfFitted: (longN) => `实测 (${longN} 长间隔)`,
  cacheTtlConfProv: (longN) => `校准中 (${longN} 长间隔)`,
  cacheTtlConfPrior: '先验初估',
  cacheTtlP80Label: 'P80 安全窗',
  cacheTtlP50Label: 'P50 半衰期',
  cacheTtlBgMissLabel: '短间隔底噪',
  cacheTtlExpiredMissSub: (count, costStr) =>
    `过期重算 ${count} 次${costStr ? ` (+${costStr})` : ''}`,
  cacheTtlBucketTip: ({ label, hits, count, empPct, predPct }) =>
    count > 0
      ? `空闲间隔 ${label}\n实测命中: ${hits}/${count} 次 (${empPct})\n模型拟合: ${predPct}`
      : `空闲间隔 ${label}\n暂无该区间实测样本\n模型拟合: ${predPct}`,
  cacheTtlFootnote:
    '基于本机去重后的同模型连续调用间隔拟合生存曲线（已排除 /compact 与上下文回退）。',
  cacheTtlHeaderSummaryTip: (pairs, missUsdStr) =>
    `累计统计本机 ${pairs.toLocaleString()} 对同模型连续调用间隔${
      missUsdStr ? `\n因缓存过期触发全量重算的额外 API 等价成本：+${missUsdStr}` : ''
    }`,
  cacheTtlP80Tip: (dur) =>
    `P80 安全窗（~${dur}）：\n空闲时间在此以内时，提示词缓存命中率仍可维持 ≥80%。尽量在此间隔内发下一轮，可避免重新 prefill。`,
  cacheTtlP50Tip: (dur) =>
    `P50 半衰期（~${dur}）：\n空闲时间达到此时，缓存存活概率降至约 50%；超过后极可能已过期或被驱逐。`,
  cacheTtlBgMissTip: (pct) =>
    `短间隔底噪（${pct}）：\n即便空闲 <1 分钟仍发生的基线未命中率，通常由后端节点切换或系统提示词前缀微调引起。`,
  cacheTtlLegendObserved: '实测命中率',
  cacheTtlLegendFitted: '拟合曲线',

  ctxMicroHeadroom: '余量估算',
  ctxMicroCacheHit: '缓存命中',
  ctxMicroCacheTtl: '缓存存活',
  ctxMicroSpendQuota: '消耗 / 5h',
  heroCachePill: (pct) => `缓存 ${pct}`,
  heroCacheTip: (pct, cached, newIn) =>
    `最近一次调用提示词缓存命中率：${pct}\n缓存读取：${cached} tok · 新输入：${newIn} tok\n命中率越高，prefill 计算量越小，首字响应 (TTFT) 越快。`,
  kpiAvgGenTip: (avgGen, avgE2e) =>
    `按输出 Token 加权的平均生成速度：${avgGen} tok/s\n公式为 Σ输出Token / Σ生成耗时（仅统计持续流式调用，排除单包缓冲），避免 20 token 短回复拉偏真实吞吐。\n加权端到端速度（含 TTFT）：${avgE2e} tok/s。`,
  kpiPeakCacheTip: (peak, avgCache) =>
    `本会话单次最高持续生成速度：${peak} tok/s\n本会话平均提示词缓存命中率：${avgCache}`,
  kpiTtftOutTip: (avgTtft, totalOut) =>
    `本会话平均首字延迟 (TTFT)：${avgTtft}\n本会话累计生成输出（含思考 + 可见回复）：${totalOut} tok`,
  kpiTimeTip: (modelSec, toolSec, toolSteps) =>
    `累计模型等待与生成时间：${modelSec}\n累计本地工具执行墙钟时间：${toolSec}${toolSteps > 0 ? `（共 ${toolSteps} 步工具）` : ''}`,
  spendScopeLabel: '本机消耗（APP + CLI）',
  spendSessionTip:
    '当前对话按公开 API 列表价折算的等价消耗（纯本地只读统计，非真实银行卡扣款）。',
  spendLocalScopeTip:
    '仅统计本机落盘的本地数据库（App + CLI + IDE）。其他设备或网页端的消耗不会落盘到本机；当前活跃窗口的跨设备差额已在下方单独估算。',
  activityViewHeatmap: '热力图',
  activityViewIceberg: '冰山图',
  icebergNewLabel: '新 Token',
  icebergCachedLabel: '缓存读取',
  icebergHint: '上方新增 · 下方缓存',
  icebergBarTip: (dateStr, newStr, cachedStr, hitPct, calls, costStr) =>
    `${dateStr}\n新输入+输出：${newStr} tok\n缓存读取：${cachedStr} tok（命中率 ${hitPct}）\n${calls} 次调用 · API 等价 ${costStr}`,

  ttftHeroLabel: '首字等待',
  ttftHeroSub: (avgTtft, e2eTps) => `均 ${avgTtft} · E2E ${e2eTps}`,
  ttftLiveWaitingSub: (avgTtft) => `正在等首字 · 均 ${avgTtft}`,
  ttftLiveSlowSub: (mult, avgTtft) => `超均值 ${mult}× · 仍在等首字 (均 ${avgTtft})`,
  ttftLiveStreamSub: (genSec, avgTtft) => `首字已出 · 生成中 ${genSec}s (均 ${avgTtft})`,
  ttftLiveLockedBadge: '首字已出',
  ttftLiveSlowBadge: '等待偏长',
  ttftLiveStallBadge: '首字偏慢',
  ttftBarsTip: (n, latestTtft, ttftSharePct, avgTtft) =>
    `近 ${n} 次调用首字等待 (TTFT) 趋势\n本轮：${latestTtft}（占本轮耗时 ${ttftSharePct}%）· 会话均值：${avgTtft}\n绿 <2s · 黄 2–6s · 红 >6s（虚线为均值）`,
  liveQuotaTitle: '当前额度',
  liveQuotaAll: '全部',
  ctxCacheSafeRem: (dur) => `安全余 ${dur}`,
  ctxCacheHalfRem: (dur) => `约余 ${dur}`,
  ctxCachePastHalf: '易重算',
  ctxMicroSession: '本会话',
  ctxMicroSaved: (usd) => `省 ${usd}`,
  kpiAvgSpeedLabel: '会话均速',
  kpiOutputLabel: '累计输出',
  kpiTimeLabel: '累计用时',
  kpiAvgSpeedTip: (avgGen, avgE2e, peakGen) =>
    `按输出 Token 加权的持续生成均速：${avgGen} tok/s（峰值 ${peakGen} tok/s）\n加权端到端均速（含 TTFT）：${avgE2e} tok/s\n按 Σ输出Token / Σ生成耗时 计算（排除单包缓冲），避免极短回复拉偏真实速度。`,
  kpiOutputCacheTip: (totalOut, avgCache) =>
    `本会话累计生成输出（含思考 + 可见回复）：${totalOut} tok\n本会话平均提示词缓存命中率：${avgCache}`,

  pulseTitle: 'GEMINI 全局大盘',
  pulseStatusOk: '正常',
  pulseStatusDegraded: '偏慢/波动',
  pulseStatusOutage: '故障',
  pulseStatusOff: '离线',
  pulseStatusUnknown: '检测中',
  pulseLoading: '正在拉取 OpenRouter 30m Gemini 大盘数据…',
  pulseToggleOn: '在线',
  pulseToggleOff: '关闭',
  pulseDisableTip: '切换为纯离线模式（不发起任何外部大盘 GET 请求）',
  pulseEnableTip: '开启只读 OpenRouter 30m + Google Cloud 状态大盘对比',
  pulseDisabledNote: '已切换为纯离线模式，不请求外部大盘，首字归因仅参考你本机 7 天历史基线。',
  pulseRefreshTip: (clock) => `刷新 Gemini 30 分钟全局大盘${clock ? `（上次 ${clock}）` : ''}`,
  pulseErrorNote: (err) => `暂时无法获取外部 Gemini 大盘（${err}），当前已回退至本机 7 天基线。`,
  pulseColModel: '模型',
  pulseColCache: '缓存',
  pulseColUp: '可用',
  pulseFootnote: (clock) => `OpenRouter 30m P50 + Google Cloud Status · 纯只读${clock ? ` · ${clock}` : ''}`,
  pulseRowLocalTip: (p50Ttft, p90Ttft, p50Tps, cachePct, calls) =>
    `你的 7 天本机（${calls} 次）：首字 P50 ${p50Ttft}（P90 ${p90Ttft}）· 速度 ${p50Tps} · 缓存 ${cachePct}`,
  pulseRowNoLocal: '你的 7 天本机：暂无该模型记录',
  pulseRowTip: (i) =>
    `${i.label} · 全球 30 分钟大盘（${i.provider}，${i.req30m} 次请求）\n` +
    `大盘首字：P50 ${i.p50Ttft} · P90 ${i.p90Ttft}\n` +
    `大盘速度：${i.p50Tps} tok/s · 全局缓存：${i.cachePct} · 30m 可用率：${i.uptimePct}` +
    `${i.degraded ? `\n异常节点：${i.degraded}` : ''}\n${i.localLine}`,
  ttftVerdictUpstream: (globalP50) => `大盘偏慢${globalP50 ? ` · ${globalP50}` : ''}`,
  ttftVerdictCacheMiss: (newTok) => `冷预填充 ${newTok}`,
  ttftVerdictLargeCtx: (ctxTok) => `大上下文 ${ctxTok}`,
  ttftVerdictConcurrency: (n) => `${n} 路并发`,
  ttftVerdictLocalSlow: (globalP50) => `仅本地慢${globalP50 ? ` · 大盘 ${globalP50}` : ''}`,
  ttftGlobalInline: (globalP50) => `大盘 ${globalP50}`,
  ttftVerdictHeadline: (v) => {
    if (v === 'upstream_degraded') return '结论：上游 Gemini 大盘当前整体偏慢或存在波动';
    if (v === 'cache_miss') return '结论：本次为大上下文冷预填充（缓存未命中），非账号/大盘问题';
    if (v === 'large_context') return '结论：当前上下文偏大（远超全球均值），属正常长上下文负载，建议 /compact 提速';
    if (v === 'local_concurrency') return '结论：当前本机多会话/Worker 并发排队导致首字变慢';
    if (v === 'account_or_network') return '结论：全局大盘正常，疑似当前账号限速或本地网络/代理偏慢';
    return '结论：首字延迟处于正常区间';
  },
  ttftBucketLabel: (b) => (b === 'hit' ? '高命中' : b === 'miss' ? '冷启动' : b === 'all' ? '全部' : `${b} 上下文`),
  ttftAttributionTip: (i) =>
    `${i.headline}（${i.model}）\n` +
    `本次请求：首字 ${i.curTtft} · 生成 ${i.curTps} · 缓存 ${i.curCache}（${i.curCtx ? `总上下文 ${i.curCtx}，` : ''}新入 ${i.curNewIn}）${i.inFlight >= 2 ? ` · ${i.inFlight} 路并发` : ''}\n` +
    `你的 7d（${i.localBucketLabel}）：P50 ${i.localP50} · P90 ${i.localP90}\n` +
    `全球 30m（${i.globalReq30m} 次${i.globalAvgCtx ? `，均 ${i.globalAvgCtx}` : ''}）：P50 ${i.globalP50} · P90 ${i.globalP90} · 速度 ${i.globalTps} · 缓存 ${i.globalCache} · 可用 ${i.globalUptime}`,
  trendGlobalRef: (val) => `大盘 P50 ${val}`,

  cacheDiagTag: (kind) => {
    if (kind === 'side_cold') return 'Side 冷启';
    if (kind === 'sys_prefix_only') return '仅系统前缀';
    if (kind === 'partial_prefix') return '部分回退';
    if (kind === 'ttl_expired') return '缓存过期';
    if (kind === 'revert_kept') return '撤回续存';
    if (kind === 'revert_miss') return '撤回过期';
    if (kind === 'gemini_2k_floor') return '2K 尾窗';
    return '';
  },
  cacheDiagTip: ({ kind, cachedStr, prevStr, gapStr, costStr, sysPrefixOnly, sessionChanged, revertStep }) => {
    if (kind === 'side_cold') {
      return (
        `Side（/btw）首轮分叉冷启动\n` +
        `Side 分支在系统提示词末尾注入了 <side_question> 并更换了 Conversation ID${sessionChanged ? ' 与 sessionID' : ''}，导致父对话历史前缀失效。\n` +
        (sysPrefixOnly
          ? `仅命中共享的 Tools + 系统提示词前缀（${cachedStr}），父对话聊天历史（${prevStr}）全部重算。`
          : `父对话上下文（${prevStr}）全量重算（仅命中 ${cachedStr}）。`) +
        `${costStr ? `\n冷启动额外重算成本：+${costStr}` : ''}`
      );
    }
    if (kind === 'sys_prefix_only') {
      return `仅命中全局 Tools + 系统提示词前缀（${cachedStr}），对话历史（${prevStr}）未命中。${gapStr ? `\n空闲间隔：${gapStr}` : ''}${costStr ? ` · 额外重算：+${costStr}` : ''}`;
    }
    if (kind === 'partial_prefix') {
      return `前缀树部分回退：从上一轮 ${prevStr} tokens 回退命中至 ${cachedStr} tokens。${gapStr ? `\n空闲间隔：${gapStr}` : ''}${costStr ? ` · 额外重算：+${costStr}` : ''}`;
    }
    if (kind === 'ttl_expired') {
      return `空闲 ${gapStr || '超时'} 后缓存过期/被驱逐（同模型且 sessionID 未变）。\n上一轮 ${prevStr} tokens 全量重算。${costStr ? `额外成本：+${costStr}` : ''}`;
    }
    if (kind === 'revert_kept') {
      return `撤回至 step #${revertStep ?? '?'} 后成功续上缓存！\n撤回保留了原 sessionID 与撤回点之前的完整前缀。${gapStr ? `（间隔 ${gapStr}）` : ''}`;
    }
    if (kind === 'revert_miss') {
      return `撤回至 step #${revertStep ?? '?'} 后未命中缓存（多因空闲超时${gapStr ? ` ${gapStr}` : ''}）。${costStr ? `\n额外重算：+${costStr}` : ''}`;
    }
    if (kind === 'gemini_2k_floor') {
      return `Gemini 隐式缓存 ~2,048-token 尾部最小窗口：\n当本轮新增 <2,048 tokens 时，服务端将缓存边界向前退回约 2,049 tokens 以保持新输入 ≥2,049，属正常机制而非缓存失效。`;
    }
    return '';
  },
  inheritedRowTag: '父历史',
  forkDividerText: (stepIdx, inheritedCalls, coldCostStr) =>
    `自父对话 step #${stepIdx} 分叉 · ${inheritedCalls} 条父历史已去重${coldCostStr ? ` · 首轮冷启 +${coldCostStr}` : ''}`,
  forkDividerToggle: (showing, inheritedCalls) =>
    showing ? `收起 ${inheritedCalls} 条父历史` : `展开 ${inheritedCalls} 条父历史`,
  forkDividerTip: (stepIdx, inheritedCalls, firstHitPct, coldCostStr) =>
    `当前 Side（/btw）对话于父对话 step #${stepIdx} 处分叉\n分叉前继承的 ${inheritedCalls} 条父对话调用已从本会话统计与全局总账中剔除，避免重复计费。\nSide 首轮命中率：${firstHitPct}${coldCostStr ? `（冷启动多花 +${coldCostStr}）` : ''}`,
  revertDividerText: (stepIdx, count, kept, hitPct) =>
    `撤回至 step #${stepIdx}${count > 1 ? ` (×${count})` : ''}${kept === true ? ` · 缓存续上 ${hitPct}` : kept === false ? ` · 缓存已过期` : ''}`,
  revertDividerTip: (stepIdx, count, gapStr, hitPct, sessionKept) =>
    `会话内撤回消息并回退至 step #${stepIdx}${count > 1 ? `（共 ${count} 次）` : ''}\n撤回后首轮缓存命中：${hitPct}${gapStr ? ` · 间隔：${gapStr}` : ''}${sessionKept !== null ? `\nsessionID 保持不变：${sessionKept ? '是' : '否'}` : ''}`,
  sideChildColdBadge: (firstHitPct, coldCostStr) =>
    coldCostStr ? `首轮 ${firstHitPct} · +${coldCostStr}` : `首轮 ${firstHitPct}`,
  sideChildTipLine: (ownCachePct, firstHitPct, coldCostStr, inheritedCalls) =>
    `Side 纯新增缓存：${ownCachePct} · 首轮：${firstHitPct}${coldCostStr ? `（冷启 +${coldCostStr}）` : ''}${inheritedCalls > 0 ? ` · 已去重 ${inheritedCalls} 条父历史` : ''}`,
  cacheTtlSideColdSub: (count, costStr) =>
    `Side 冷启 ${count} 次${costStr ? ` (+${costStr})` : ''}`,
  cacheTtlSideColdTip: (count, sysOnly, costStr) =>
    `Side（/btw）首轮分叉冷启动共 ${count} 次${sysOnly > 0 ? `（其中 ${sysOnly} 次仅命中 ~16.9K 全局前缀）` : ''}${costStr ? `\n累计冷启动额外 API 等价成本：+${costStr}` : ''}\n已从上方 TTL 存活曲线中剔除，避免拉偏真实空闲衰减。`,
  cacheTtlRevertSub: (kept, total) => `撤回续存 ${kept}/${total}`,
  cacheTtlRevertTip: (kept, total, expired) =>
    `会话内撤回消息共 ${total} 次，其中 ${kept} 次成功保住缓存（≥80% 命中）${expired > 0 ? `\n另有 ${expired} 次因空闲超时过期` : ''}\n撤回保留原 sessionID 与前缀，因此有效期内几乎无缓存损耗。`,
};
