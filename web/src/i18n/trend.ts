import type { Lang } from '../types/telemetry';
import type { Translations } from './types';

export interface TrendTranslations {
  rangeAll: string;
  rangePresetTip: (label: string, available: boolean) => string;
  axisSeq: string;
  axisTime: string;
  axisSeqShort: string;
  axisTimeShort: string;
  axisSeqTip: string;
  axisTimeTip: string;
  zoomInTip: string;
  zoomOutTip: string;
  viewingRange: (firstCall: number, lastCall: number, total: number, isZoomed: boolean) => string;
  followLiveBtn: string;
  followLiveTip: string;
  statLatest: string;
  statAvg: string;
  statP50: string;
  statP95: string;
  statPeak: string;
  statMax: string;
  statMin: string;
  statSum: string;
  statThinkShare: string;
  statHighCache: string;
  statHeadroom: string;
  statCompacts: string;
  statTurns: (n: number) => string;
  refEma: string;
  refP95: string;
  refAvg: string;
  refTarget80: string;
  refDanger80: string;
  refSla3: string;
  refSla10: string;
  compactTag: string;
  popGenTps: string;
  popE2eTps: string;
  popTtft: string;
  popGenTime: string;
  popTotalTime: string;
  popOutput: string;
  popThinkVis: string;
  popCache: string;
  popPrompt: string;
  popContext: string;
  popQuota5h: string;
  popQuota7d: string;
  popCost: string;
  popRateK: string;
  popBadgeBuf: string;
  popBadgeStall: string;
  popVsAvg: (delta: string) => string;
  popHintInspectDrag: string;
  popHintDragOnly: string;
  minimapAria: string;
  minimapTip: string;
  emptyFiltered: string;
  singleCallNote: string;
  zoomSelecting: (count: number) => string;
}

const TREND_EN: TrendTranslations = {
  rangeAll: 'All',
  rangePresetTip: (label, available) =>
    available ? `Show latest ${label} calls` : `Need more than ${label} calls`,
  axisSeq: '#Seq',
  axisTime: 'Time',
  axisSeqShort: '#',
  axisTimeShort: '⏱',
  axisSeqTip: 'Uniform call-sequence X-axis (#1, #2, …)',
  axisTimeTip: 'Proportional wall-clock timeline (shows idle gaps & bursts)',
  zoomInTip: 'Zoom in 2× (or Ctrl/Meta/Shift + Wheel)',
  zoomOutTip: 'Zoom out 2× (or Ctrl/Meta/Shift + Wheel)',
  viewingRange: (firstCall, lastCall, total, isZoomed) =>
    `Viewing #${firstCall}–#${lastCall} of ${total}${isZoomed ? ' (Zoomed)' : ''}`,
  followLiveBtn: 'Follow Live ⏭',
  followLiveTip: 'Snap viewport to latest live calls',
  statLatest: 'LATEST',
  statAvg: 'AVG',
  statP50: 'P50',
  statP95: 'P95',
  statPeak: 'PEAK',
  statMax: 'MAX',
  statMin: 'MIN',
  statSum: 'SUM',
  statThinkShare: 'THK%',
  statHighCache: '≥80%',
  statHeadroom: 'HEADROOM',
  statCompacts: 'COMPACTS',
  statTurns: (n) => `~${n}t`,
  refEma: 'EMA5',
  refP95: 'P95',
  refAvg: 'AVG',
  refTarget80: '80%',
  refDanger80: '80%',
  refSla3: '3s',
  refSla10: '10s',
  compactTag: 'CMP',
  popGenTps: 'GEN TPS',
  popE2eTps: 'E2E TPS',
  popTtft: 'TTFT',
  popGenTime: 'GEN',
  popTotalTime: 'TOTAL',
  popOutput: 'OUTPUT',
  popThinkVis: 'THK / VIS',
  popCache: 'CACHE',
  popPrompt: 'CACHED / NEW',
  popContext: 'CONTEXT',
  popQuota5h: '5H QUOTA',
  popQuota7d: '7D QUOTA',
  popCost: 'LIST COST',
  popRateK: 'RATE',
  popBadgeBuf: 'BUF',
  popBadgeStall: 'TC-WAIT',
  popVsAvg: (delta) => `${delta} vs avg`,
  popHintInspectDrag: 'Click to inspect · Drag to zoom',
  popHintDragOnly: 'Drag horizontally to zoom',
  minimapAria: 'Session history minimap scrubber',
  minimapTip: 'Drag window to pan · Drag edges to resize · Click track to jump · Double-click to reset',
  emptyFiltered: 'No calls match this model filter',
  singleCallNote: '1 call recorded',
  zoomSelecting: (count) => `${count} calls`,
};

const TREND_ZH: TrendTranslations = {
  rangeAll: '全部',
  rangePresetTip: (label, available) =>
    available ? `查看最近 ${label} 次调用` : `当前调用不足 ${label} 次`,
  axisSeq: '#序号',
  axisTime: '时间',
  axisSeqShort: '#',
  axisTimeShort: '⏱',
  axisSeqTip: '按调用序号等距排列（#1, #2…）',
  axisTimeTip: '按真实时间轴等比排列（显示空闲间隔与突发）',
  zoomInTip: '放大 2×（或按住 Ctrl/Meta/Shift 滚轮）',
  zoomOutTip: '缩小 2×（或按住 Ctrl/Meta/Shift 滚轮）',
  viewingRange: (firstCall, lastCall, total, isZoomed) =>
    `查看 #${firstCall}–#${lastCall} / 共 ${total} 次${isZoomed ? '（已缩放）' : ''}`,
  followLiveBtn: '跟随实时 ⏭',
  followLiveTip: '恢复跟随最新实时调用',
  statLatest: '最新',
  statAvg: '均值',
  statP50: 'P50',
  statP95: 'P95',
  statPeak: '峰值',
  statMax: '最大',
  statMin: '最低',
  statSum: '累计',
  statThinkShare: '思考占比',
  statHighCache: '≥80%',
  statHeadroom: '余量估算',
  statCompacts: '压缩次数',
  statTurns: (n) => `~${n}轮`,
  refEma: 'EMA5',
  refP95: 'P95',
  refAvg: '均值',
  refTarget80: '80%',
  refDanger80: '80%',
  refSla3: '3s',
  refSla10: '10s',
  compactTag: '压缩',
  popGenTps: '生成速度',
  popE2eTps: '端到端',
  popTtft: '首字耗时',
  popGenTime: '生成耗时',
  popTotalTime: '总耗时',
  popOutput: '输出',
  popThinkVis: '思考 / 可见',
  popCache: '缓存命中',
  popPrompt: '缓存 / 新增',
  popContext: '上下文',
  popQuota5h: '5h 配额',
  popQuota7d: '7d 配额',
  popCost: '官网估算',
  popRateK: '倍率',
  popBadgeBuf: '单包',
  popBadgeStall: '工具等待',
  popVsAvg: (delta) => `较均值 ${delta}`,
  popHintInspectDrag: '点击定位明细 · 拖拽框选缩放',
  popHintDragOnly: '水平拖拽可框选缩放',
  minimapAria: '会话历史缩略图导航',
  minimapTip: '拖拽窗口平移 · 拖拽边缘缩放 · 点击轨道跳转 · 双击重置',
  emptyFiltered: '当前模型筛选下暂无调用记录',
  singleCallNote: '已记录 1 次调用',
  zoomSelecting: (count) => `选区 ${count} 次`,
};

export function resolveTrendLang(lang: Lang | undefined, t: Translations): Lang {
  if (lang === 'en' || lang === 'zh') return lang;
  if (t.tabTps !== 'TPS') return 'zh';
  if (typeof document !== 'undefined' && document.documentElement.lang?.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

export function getTrendTranslations(lang: Lang): TrendTranslations {
  return lang === 'zh' ? TREND_ZH : TREND_EN;
}
