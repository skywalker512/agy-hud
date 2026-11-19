import type { Translations } from './types';

export const zh: Translations = {
  title: 'AGY HUD',
  connecting: '连接中…',
  waitingModel: '等待模型响应数据…',
  optAuto: '跟随当前对话',
  optLatest: '自动最新活跃',
  tabLive: '实时',
  tabCalls: '调用',
  tabAccount: '账户',
  genLabel: '生成速度 (Gen TPS)',
  livePill: '生成中',
  e2eLabel: '端到端速度 (含 TTFT)',
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
  viewAll: '查看全部 →',
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
  waitFirstCall: (id) => `会话 ${id}… · 等待首次模型调用`,
  sessionMeta: (turns, steps, calls) => `${turns}轮 ${steps}步 · ${calls}次`,
  modelWaiting: (m) => `等首字 · ${m}`,
  modelRunning: (m) => `生成中 · ${m}`,
  modelCompact: (m) => `压缩中 · ${m}`,
  modelTool: (m, tool) => (tool ? `${m} · ${tool}` : `${m} · 工具中`),
  chartMeta: (n) => `${n} 次调用`,
  genSubSust: (sust, ms, tok) => `上次流式 ${sust} · 本次单包 ${ms}ms (${tok} tok)`,
  genSubBuf: (ms, tok) => `单包缓冲 ${ms}ms · 输出 ${tok} tok`,
  genSubOk: (tok, sec) => `输出 ${tok} tok · 生成 ${sec}`,
  e2eSub: (ttft, tot) => `TTFT ${ttft} · 总计 ${tot}`,
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
  histDetail: (tm, cached, newIn, out, thk, ttft, gen, stallNote = '') =>
    `${tm ? tm + ' · ' : ''}TTFT ${ttft} · 生成 ${gen}${stallNote} · 输入 ${cached}+${newIn} · 输出 ${out} (思 ${thk})`,
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
  compactFilterBtn: (n, on) => (on ? `压缩记录 (${n}) ✓` : `含 ${n} 次压缩`),
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
  backParent: (lbl) => `← 返回父会话 · ${lbl}`,
  linkedCount: (n) => `${n} 个关联会话`,
  linkedTitle: '挂载子会话 / Side Question',
  linkedHint: '点击跳转查看',
  jumpAction: '进入 →',
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
  accountTitle: '账户配额与成本',
  creditsRealMini: (c) => `额外积分: ${c}`,
  creditsRealTip: (c) => `当前可用额外积分 (Credits): ${c}`,
  quotaRefreshTip: (tm) => `强制刷新配额（默认 5 分钟缓存，且仅在打开账户页时请求）${tm ? `\n上次同步: ${tm}` : ''}`,
  quotaDeferred: '正在同步账户双窗口配额…',
  quotaOffline: '未注入 LS 环境变量，暂无法拉取实时配额（本地账单统计正常）',
  heldByWeeklyTag: '受周限锁定',
  winMeta: (pct, resetStr) => `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%${resetStr ? ` · ${resetStr}` : ''}`,
  winBudgetEst: (spent, full, lowSample, remote, effSpent) =>
    `列表价满额 ~${full}${lowSample ? ' (初估)' : ''} · 本机 ${spent}${effSpent ? ` (折算 ${effSpent})` : ''}${remote ? ` + 约${remote} 未归因` : ''}`,
  winSpentOnly: (spent, minPct = '0.5%') => `窗内已用 ${spent} (<${minPct} 样本)`,
  winRunwayWarn: (dur, clock) => `⚡ 照此速度约 ${dur} 后刷满 (${clock})`,
  winRunwaySafe: (remAtReset) => `✓ 安全 · 重置前预计余 ~${remAtReset}`,
  winRunwayExhausted: '额度已耗尽 · 等待窗口重置',
  winRunwayTip: (burnPerHr, exhaustDur, exhaustClock, remAtReset, willExhaust, isRecent) =>
    `当前消耗节奏: 约 -${burnPerHr}/小时（${isRecent ? '近期活跃速率 + 窗口均速加权' : '按当前窗口平均速率'}）\n${
      willExhaust
        ? `预计在重置前约 ${exhaustDur} 后（${exhaustClock} 左右）触及上限`
        : `若维持当前节奏，等到窗口重置时预计还剩 ~${remAtReset}`
    }`,
  rulesTitle: '额度池面值与扣费规则',
  rulesAccHigh: (errStr, wins) => `✓ ${wins}窗实测 · 误差 ${errStr}`,
  rulesAccProv: (wins) => `校准积累中 (${wins}窗)`,
  rulesDriftBadge: '⚠ 计费变动重算中',
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
  heatmapTitle: '每日消耗热力图 (近 16 周)',
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
    `${label}\n${winsText}${held ? '\n周限 (7d) 已耗尽，需等待周重置后解锁 5h 额度' : ''}${fitNotes ? `\n${fitNotes}` : ''}${driftWarn ? `\n⚠ 平台计费口径可能变化（偏离先验 >3σ 或区间外误差超标，已自动降为初估）` : ''}\n满额 F = 100 / beta_ref 为按 pricing.json 参考列表价投影的等效满额（非真实扣款账单价，亦不受 GA 展示单价切换影响）`,
  poolFitTipLine: (modelsStr, gammaStr, shortCount, errLabel) =>
    `模型拟合: ${modelsStr}${gammaStr ? ` · 7d/5h=${gammaStr}` : ''}（${shortCount} 短窗 · ${errLabel}）`,
  remoteWinBanner: (remoteUsd) => `活跃窗内未归因配额差值（他端或未记录调用）: +约 ${remoteUsd}`,
  remoteWinBannerTip:
    '按上次同步时的带符号窗口配额残差减去本机 App+CLI 模型折算消耗及噪声带估算（可能来自其他设备、远端会话或未落盘调用）',
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
};
