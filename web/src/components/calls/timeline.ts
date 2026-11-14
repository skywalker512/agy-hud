import type { Compaction, Invocation } from '../../types/telemetry';

export type TimelineItem =
  | { kind: 'inv'; inv: Invocation }
  | { kind: 'compact'; compact: Compaction };

function isInvBeforeCompact(inv: Invocation, cmp: Compaction): boolean {
  if (inv.stepIdx !== null && Number.isFinite(inv.stepIdx)) {
    return inv.stepIdx < cmp.stepIdx;
  }
  if (cmp.afterGmIdx !== null && Number.isFinite(cmp.afterGmIdx)) {
    return inv.idx <= cmp.afterGmIdx;
  }
  if (inv.timestampMs > 0 && cmp.timestampMs > 0 && inv.timestampMs !== cmp.timestampMs) {
    return inv.timestampMs < cmp.timestampMs;
  }
  return true;
}

export function buildTimelineDesc(invocations: Invocation[], compactions: Compaction[]): TimelineItem[] {
  const merged: TimelineItem[] = [];
  let i = 0;
  let j = 0;

  while (i < invocations.length && j < compactions.length) {
    if (isInvBeforeCompact(invocations[i], compactions[j])) {
      merged.push({ kind: 'inv', inv: invocations[i++] });
    } else {
      merged.push({ kind: 'compact', compact: compactions[j++] });
    }
  }
  while (i < invocations.length) {
    merged.push({ kind: 'inv', inv: invocations[i++] });
  }
  while (j < compactions.length) {
    merged.push({ kind: 'compact', compact: compactions[j++] });
  }

  merged.reverse();
  return merged;
}
