import type { CallDetailPayload, Invocation, Lang, StatsSnapshot } from '../types/telemetry';
import { copyText } from './clipboard';
import {
  fmtCachePct,
  fmtClock,
  fmtNum,
  fmtQuotaPct,
  fmtSec,
  fmtTps,
  fmtUsd,
  formatModelTag,
  formatSessionQuotaCompact,
} from './format';

function escMdCell(s: string): string {
  return String(s || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function prettyArgs(raw: string): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function formatCallMarkdown(
  inv: Invocation,
  detail: CallDetailPayload | undefined,
  lang: Lang,
): string {
  const isZh = lang === 'zh';
  const modelTag = formatModelTag(inv.modelId, inv.modelDisplay, inv.model);
  const ts = inv.timestampMs ? new Date(inv.timestampMs).toISOString() : '';
  const clk = fmtClock(inv.timestampMs);
  const cPct = fmtCachePct(inv.cacheHitPct);
  const q5h = fmtQuotaPct(inv.quotaPct5h);
  const q7d = fmtQuotaPct(inv.quotaPct7d);
  const kStr = (inv.quotaMultiplierK || 1).toFixed(2);
  const thinkSec = Math.max(0, inv.thinkSec || 0);
  const toolSec = Math.max(0, inv.toolGenSec || 0);
  const streamSec = Math.max(0, (inv.genSec || 0) - thinkSec - toolSec);
  const totalSec = Math.max(inv.totalSec || 0, (inv.ttftSec || 0) + (inv.genSec || 0));

  const lines: string[] = [];
  lines.push(
    isZh
      ? `# AGY-HUD 调用报告 #${inv.idx + 1} — ${modelTag}`
      : `# AGY-HUD Call Trace #${inv.idx + 1} — ${modelTag}`,
  );
  lines.push('');
  lines.push(
    isZh
      ? `- **时间**: ${clk || '--'}${ts ? ` (${ts})` : ''}`
      : `- **Timestamp**: ${clk || '--'}${ts ? ` (${ts})` : ''}`,
  );
  lines.push(
    isZh
      ? `- **路由模型**: \`${modelTag}\`${inv.modelDisplay && inv.modelDisplay !== modelTag ? ` (UI: ${inv.modelDisplay})` : ''}`
      : `- **Routed Model**: \`${modelTag}\`${inv.modelDisplay && inv.modelDisplay !== modelTag ? ` (UI: ${inv.modelDisplay})` : ''}`,
  );
  lines.push(
    isZh
      ? `- **上下文**: ${inv.totalContext.toLocaleString()} / ${inv.contextLimit.toLocaleString()} (${inv.contextPct.toFixed(1)}%)`
      : `- **Context**: ${inv.totalContext.toLocaleString()} / ${inv.contextLimit.toLocaleString()} (${inv.contextPct.toFixed(1)}%)`,
  );
  if (inv.pricingKey) {
    lines.push(isZh ? `- **计费键**: \`${inv.pricingKey}\`` : `- **Pricing Key**: \`${inv.pricingKey}\``);
  }
  lines.push('');

  lines.push(isZh ? '| 指标 | 数值 |' : '| Metric | Value |');
  lines.push('| :--- | :--- |');
  lines.push(
    `| ${isZh ? '生成速度 / E2E' : 'GEN / E2E TPS'} | ${inv.isBuffered ? `BUF (${(inv.genSec * 1000).toFixed(0)}ms)` : `${fmtTps(inv.genTps)} tok/s`} / ${fmtTps(inv.e2eTps)} tok/s |`,
  );
  lines.push(
    `| ${isZh ? '耗时 (TTFT / 生成 / 总计)' : 'Latency (TTFT / Gen / Total)'} | ${fmtSec(inv.ttftSec)} / ${fmtSec(inv.genSec)} / ${fmtSec(totalSec)} |`,
  );
  if (thinkSec > 0 || toolSec > 0) {
    lines.push(
      `| ${isZh ? '阶段拆分' : 'Phase Split'} | ${isZh ? '首字' : 'TTFT'} ${fmtSec(inv.ttftSec)} · ${isZh ? '思考' : 'Think'} ${fmtSec(thinkSec)} · ${inv.isToolStall ? 'TC-WAIT' : isZh ? '工具' : 'Tool'} ${fmtSec(toolSec)} · ${isZh ? '流式' : 'Stream'} ${fmtSec(streamSec)} |`,
    );
  }
  lines.push(
    `| ${isZh ? '输入与缓存' : 'Prompt & Cache'} | ${inv.cachedInput.toLocaleString()} cached + ${inv.newInput.toLocaleString()} new (${cPct}) |`,
  );
  lines.push(
    `| ${isZh ? '输出构成' : 'Output Tokens'} | ${inv.outputTokens.toLocaleString()} (${isZh ? '思考' : 'Think'} ${inv.thinkingTokens.toLocaleString()} / ${isZh ? '可见' : 'Visible'} ${inv.candidateTokens.toLocaleString()}) |`,
  );
  lines.push(
    `| ${isZh ? '估算成本' : 'Est. Cost'} | ${inv.priced ? `${fmtUsd(inv.costUSD)}${inv.cacheSavedUSD > 0 ? ` (${isZh ? '省' : 'saved'} ${fmtUsd(inv.cacheSavedUSD)})` : ''}` : isZh ? '未定价' : 'Unpriced'} |`,
  );
  if (q5h) {
    lines.push(
      `| ${isZh ? '配额扣减' : 'Est. Quota'} | -${q5h} (5h)${q7d ? ` · -${q7d} (7d)` : ''} · ${kStr}× (${inv.quotaFitSource || 'prior'}) |`,
    );
  }

  const thinking = detail?.thinkingPreview || inv.thinkingPreview || '';
  const reply = detail?.replyPreview || inv.replyPreview || '';
  const toolCalls = detail?.toolCalls || inv.toolCalls || [];

  if (thinking) {
    lines.push('');
    lines.push(isZh ? '## 思考摘要' : '## Thinking');
    lines.push('');
    lines.push('```text');
    lines.push(thinking);
    lines.push('```');
  }

  if (toolCalls.length > 0) {
    lines.push('');
    lines.push(isZh ? `## 工具调用 (${toolCalls.length})` : `## Tool Calls (${toolCalls.length})`);
    for (const tc of toolCalls) {
      lines.push('');
      lines.push(`### \`${tc.name}\``);
      if (tc.args) {
        lines.push('```json');
        lines.push(prettyArgs(tc.args));
        lines.push('```');
      }
    }
  }

  if (reply) {
    lines.push('');
    lines.push(isZh ? '## 模型回复' : '## Reply');
    lines.push('');
    lines.push(reply);
  }

  return lines.join('\n');
}

export function formatCallJson(inv: Invocation, detail: CallDetailPayload | undefined): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      invocation: inv,
      detail: detail || null,
    },
    null,
    2,
  );
}

export function formatSessionMarkdown(snap: StatsSnapshot, lang: Lang): string {
  const isZh = lang === 'zh';
  const invs = snap.invocations || [];
  const compacts = snap.compactions || [];
  const s = snap.summary;
  const title = snap.sessionInfo?.title || snap.conversationId || 'Session';
  const ttfts = invs.map((r) => r.ttftSec).filter((v) => Number.isFinite(v) && v >= 0);
  const p50Ttft = percentile(ttfts, 50);
  const p95Ttft = percentile(ttfts, 95);
  const ctxList = invs.map((r) => r.totalContext).filter((v) => v > 0);
  const minCtx = ctxList.length ? Math.min(...ctxList) : 0;
  const maxCtx = ctxList.length ? Math.max(...ctxList) : 0;
  const latestCtx = snap.latest?.totalContext || (ctxList.length ? ctxList[ctxList.length - 1] : 0);
  const ctxLimit = snap.latest?.contextLimit || (invs.length ? invs[invs.length - 1].contextLimit : 0);
  const tree = snap.sessionInfo?.treeTotals;
  const rootTree = snap.sessionInfo?.rootTreeTotals || null;
  const childCount = tree?.descendantCount || 0;
  const childCost = tree?.childCostUSD || 0;
  const childSaved = tree?.childSavedUSD || 0;
  const childCalls = tree?.childCalls || 0;
  const childOut = tree?.childOutputTokens || 0;
  const hasChildRollup = childCount > 0 && (childCost > 0 || childCalls > 0);
  const effCost = (s?.totalCostUSD || 0) + childCost;
  const effSaved = (s?.totalSavedUSD || 0) + childSaved;
  const effOutput = (s?.totalOutput || 0) + childOut;
  const hasRootTree = Boolean(rootTree && rootTree.costUSD > effCost);
  const quotaStr = formatSessionQuotaCompact(
    hasChildRollup && tree?.quotaUsage ? tree.quotaUsage : s?.sessionQuota || snap.sessionInfo?.quotaUsage,
  );

  const lines: string[] = [];
  lines.push(isZh ? `# AGY-HUD 会话诊断报告` : `# AGY-HUD Session Telemetry Report`);
  lines.push('');
  lines.push(`- **${isZh ? '会话标题' : 'Session'}**: ${escMdCell(title)}`);
  lines.push(`- **${isZh ? '会话 ID' : 'Conversation ID'}**: \`${snap.conversationId || '--'}\``);
  if (hasRootTree && rootTree) {
    lines.push(
      `- **${isZh ? (rootTree.isSwarm ? '所属蜂群总计' : '所属主会话树') : (rootTree.isSwarm ? 'Parent Swarm Total' : 'Parent Tree Total')}**: ${fmtUsd(rootTree.costUSD)} (${rootTree.calls} ${isZh ? '次调用' : 'calls'} · ${rootTree.descendantCount} ${isZh ? '个子会话' : 'subagents'} · \`${rootTree.rootId}\`)`,
    );
  }
  lines.push(`- **${isZh ? '导出时间' : 'Exported'}**: ${new Date().toISOString()}`);
  lines.push(
    `- **${isZh ? '规模' : 'Scale'}**: ${s?.userTurns || 0} ${isZh ? '轮' : 'turns'} · ${s?.totalSteps || 0} ${isZh ? '步' : 'steps'} · ${invs.length} ${isZh ? '次调用' : 'calls'}${hasChildRollup ? ` (+${childCalls} ${isZh ? `次 / ${childCount} 子会话` : `calls / ${childCount} subagents`})` : ''}${compacts.length ? ` · ${compacts.length} ${isZh ? '次压缩' : 'compactions'}` : ''}`,
  );
  lines.push('');

  lines.push(isZh ? '## 核心指标汇总' : '## Executive Summary');
  lines.push('');
  lines.push(isZh ? '| 指标 | 数值 |' : '| Metric | Value |');
  lines.push('| :--- | :--- |');
  lines.push(
    `| ${isZh ? '平均 / 峰值 GEN TPS' : 'Avg / Peak GEN TPS'} | ${fmtTps(s?.avgGenTps)} / ${fmtTps(s?.peakGenTps)} tok/s (E2E ${fmtTps(s?.avgE2eTps)}) |`,
  );
  lines.push(
    `| ${isZh ? 'TTFT (均值 / P50 / P95)' : 'TTFT (Avg / P50 / P95)'} | ${fmtSec(s?.avgTtftSec)} / ${fmtSec(p50Ttft)} / ${fmtSec(p95Ttft)} |`,
  );
  lines.push(
    `| ${isZh ? '平均缓存命中率' : 'Avg Cache Hit'} | ${fmtCachePct(s?.avgCacheHitPct)} (${fmtNum(s?.totalCachedInput)} cached / ${fmtNum(s?.totalNewInput)} new) |`,
  );
  lines.push(
    `| ${isZh ? '总输出 Token' : 'Total Output'} | ${fmtNum(effOutput)} (${isZh ? '主会话' : 'Main'} ${fmtNum(s?.totalOutput)}: ${isZh ? '思考' : 'Think'} ${fmtNum(s?.totalThinking)} / ${isZh ? '可见' : 'Visible'} ${fmtNum(s?.totalCandidate)}${hasChildRollup && childOut > 0 ? ` · ${isZh ? '子会话' : 'Subagents'} +${fmtNum(childOut)}` : ''}) |`,
  );
  lines.push(
    `| ${isZh ? '上下文轨迹' : 'Context Trajectory'} | ${fmtNum(minCtx)} → ${isZh ? '峰值' : 'Peak'} ${fmtNum(maxCtx)} → ${isZh ? '最新' : 'Latest'} ${fmtNum(latestCtx)}${ctxLimit ? ` / ${fmtNum(ctxLimit)}` : ''} |`,
  );
  lines.push(
    `| ${isZh ? 'API 等价成本 / 缓存节省' : 'API-Eq Cost / Cache Saved'} | ${fmtUsd(effCost)} / ${fmtUsd(effSaved)}${hasChildRollup ? ` (${isZh ? `主 ${fmtUsd(s?.totalCostUSD)} + ${childCount} 子 ${fmtUsd(childCost)}` : `Main ${fmtUsd(s?.totalCostUSD)} + ${childCount} sub ${fmtUsd(childCost)}`})` : ''} |`,
  );
  if (quotaStr) {
    lines.push(`| ${isZh ? '配额消耗' : 'Quota Burn'} | ${quotaStr} |`);
  }

  // Routed model mix table
  if (invs.length > 0) {
    const byModel = new Map<
      string,
      {
        calls: number;
        sustTok: number;
        sustSec: number;
        ttftSum: number;
        cached: number;
        newIn: number;
        out: number;
        cost: number;
        q5h: number;
      }
    >();
    for (const r of invs) {
      const key = formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
      const cur = byModel.get(key) || {
        calls: 0,
        sustTok: 0,
        sustSec: 0,
        ttftSum: 0,
        cached: 0,
        newIn: 0,
        out: 0,
        cost: 0,
        q5h: 0,
      };
      cur.calls += 1;
      if (!r.isBuffered && r.genSec > 0) {
        cur.sustTok += r.outputTokens;
        cur.sustSec += r.genSec;
      }
      cur.ttftSum += r.ttftSec || 0;
      cur.cached += r.cachedInput || 0;
      cur.newIn += r.newInput || 0;
      cur.out += r.outputTokens || 0;
      if (r.priced) cur.cost += r.costUSD || 0;
      cur.q5h += r.quotaPct5h || 0;
      byModel.set(key, cur);
    }

    lines.push('');
    lines.push(isZh ? '## 路由模型分布' : '## Routed Model Mix');
    lines.push('');
    lines.push(
      isZh
        ? '| 模型 | 调用 | 均速 GEN | 均值 TTFT | 缓存命中 | 输出 | 成本 | 5h 配额 |'
        : '| Model | Calls | Avg GEN | Avg TTFT | Cache | Output | Cost | 5h Quota |',
    );
    lines.push('| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const [m, st] of [...byModel.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
      const gen = st.sustSec > 0 ? `${fmtTps(st.sustTok / st.sustSec)} t/s` : '--';
      const ttft = fmtSec(st.ttftSum / Math.max(1, st.calls));
      const promptTot = st.cached + st.newIn;
      const cache = promptTot > 0 ? `${((st.cached / promptTot) * 100).toFixed(1)}%` : '--';
      const qStr = st.q5h > 0 ? `-${fmtQuotaPct(st.q5h)}` : '--';
      lines.push(
        `| \`${escMdCell(m)}\` | ${st.calls} | ${gen} | ${ttft} | ${cache} | ${fmtNum(st.out)} | ${fmtUsd(st.cost)} | ${qStr} |`,
      );
    }
  }

  // Top 5 slowest calls
  if (invs.length > 0) {
    const slowest = [...invs].sort((a, b) => b.totalSec - a.totalSec).slice(0, 5);
    lines.push('');
    lines.push(isZh ? '## 耗时最慢 Top 5 调用' : '## Top 5 Slowest Calls');
    lines.push('');
    lines.push(
      isZh
        ? '| # | 模型 | 总耗时 | TTFT | 生成 | GEN TPS | 输出 |'
        : '| # | Model | Total | TTFT | Gen | GEN TPS | Output |',
    );
    lines.push('| ---: | :--- | ---: | ---: | ---: | ---: | ---: |');
    for (const r of slowest) {
      const m = formatModelTag(r.modelId, r.modelDisplay, r.model);
      lines.push(
        `| #${r.idx + 1} | \`${escMdCell(m)}\` | ${fmtSec(r.totalSec)} | ${fmtSec(r.ttftSec)} | ${fmtSec(r.genSec)} | ${r.isBuffered ? 'BUF' : fmtTps(r.genTps)} | ${fmtNum(r.outputTokens)} |`,
      );
    }

    const costliest = [...invs]
      .filter((r) => r.costUSD > 0 || (r.quotaPct5h || 0) > 0)
      .sort((a, b) => (b.quotaPct5h || 0) - (a.quotaPct5h || 0) || b.costUSD - a.costUSD)
      .slice(0, 5);
    if (costliest.length > 0) {
      lines.push('');
      lines.push(isZh ? '## 成本 / 配额最高 Top 5 调用' : '## Top 5 Costliest Calls');
      lines.push('');
      lines.push(
        isZh
          ? '| # | 模型 | 成本 | 5h 配额 | 倍率 | 缓存 | 输入 |'
          : '| # | Model | Cost | 5h Quota | Rate | Cache | Prompt |',
      );
      lines.push('| ---: | :--- | ---: | ---: | ---: | ---: | ---: |');
      for (const r of costliest) {
        const m = formatModelTag(r.modelId, r.modelDisplay, r.model);
        const q = fmtQuotaPct(r.quotaPct5h);
        lines.push(
          `| #${r.idx + 1} | \`${escMdCell(m)}\` | ${r.priced ? fmtUsd(r.costUSD) : '--'} | ${q ? `-${q}` : '--'} | ${(r.quotaMultiplierK || 1).toFixed(2)}× | ${fmtCachePct(r.cacheHitPct)} | ${fmtNum(r.totalPromptTokens)} |`,
        );
      }
    }
  }

  // Compactions list
  if (compacts.length > 0) {
    lines.push('');
    lines.push(isZh ? `## 上下文压缩事件 (${compacts.length})` : `## Compaction Events (${compacts.length})`);
    lines.push('');
    for (const c of compacts) {
      const m = formatModelTag(c.modelId, c.modelDisplay, c.model);
      const drop = c.beforeCtx > 0 ? `${fmtNum(c.beforeCtx)} → ${fmtNum(c.afterCtx)}` : '--';
      lines.push(
        `- step #${c.stepIdx} (${fmtClock(c.timestampMs) || '--'}) · \`${m}\` · ${drop} · ${fmtSec(c.durationSec)} · ${fmtNum(c.outputTokens)} tok`,
      );
    }
  }

  return lines.join('\n');
}

export function formatSessionJson(snap: StatsSnapshot): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      conversationId: snap.conversationId || null,
      sessionInfo: snap.sessionInfo || null,
      summary: snap.summary || null,
      contextBreakdown: snap.contextBreakdown || null,
      turns: snap.turns || [],
      compactions: snap.compactions || [],
      invocations: snap.invocations || [],
    },
    null,
    2,
  );
}

export async function downloadOrCopyJson(
  filename: string,
  jsonText: string,
): Promise<'downloaded' | 'copied' | 'failed'> {
  if (!jsonText) return 'failed';
  try {
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const a = document.createElement('a');
      if ('download' in a) {
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
        }, 1500);
        // Also copy silently? No, respect clipboard unless download fails; return 'downloaded'.
        return 'downloaded';
      }
    }
  } catch {
    /* fallback to clipboard below */
  }
  const ok = await copyText(jsonText);
  return ok ? 'copied' : 'failed';
}
