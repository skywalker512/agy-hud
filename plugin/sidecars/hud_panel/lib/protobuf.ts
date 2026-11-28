import { readFileSync } from 'node:fs';
import {
  clipLiveStreamText,
  clipText,
  DETAIL_COMPACT_MAX,
  DETAIL_CONTENT_MAX,
  DETAIL_PROMPT_MAX,
  DETAIL_TOOL_ARGS_MAX,
  LIVE_STREAM_PREVIEW_MAX,
  UUID_RE,
} from './constants.ts';
import { resolveLimitFallback } from './pricing.ts';

export type ProtoField =
  | [fieldNum: number, wireType: 0, val: bigint]
  | [fieldNum: number, wireType: 1 | 2 | 5, val: Uint8Array];

export interface UsageSubmsg {
  modelEnum: number | null;
  newInput: number;
  cachedInput: number;
  outputTokens: number;
  thinkingTokens: number;
  candidateTokens: number;
  botId: string;
  sessionId: string;
}

export interface ParentReference {
  parentTrajectoryId: string;
  stepIndex: number | null;
  isResetToStart: boolean;
  parentCascadeId: string;
}

export function unescapePbtxtString(raw: string): string {
  if (!raw || !raw.includes('\\')) return raw || '';
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\' || i + 1 >= raw.length) {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = raw[i + 1];
    if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 2 < raw.length && raw[i + 2] >= '0' && raw[i + 2] <= '7') {
        oct += raw[i + 2];
        if (i + 3 < raw.length && raw[i + 3] >= '0' && raw[i + 3] <= '7') oct += raw[i + 3];
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i += oct.length;
    } else if (next === 'n') {
      bytes.push(10);
      i++;
    } else if (next === 'r') {
      bytes.push(13);
      i++;
    } else if (next === 't') {
      bytes.push(9);
      i++;
    } else {
      bytes.push(...Buffer.from(next, 'utf8'));
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function extractPbtxtField(text: string, fieldName: string): string[] {
  const re = new RegExp(`(?:^|\\s)${fieldName}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(unescapePbtxtString(m[1]));
  return out;
}

export function parseAnnotationPbtxt(annoPath: string) {
  try {
    const raw = readFileSync(annoPath, 'utf8');
    const title = extractPbtxtField(raw, 'title')[0] || '';
    const sideQuestionIds = extractPbtxtField(raw, 'side_question_cascade_ids').filter((id) => UUID_RE.test(id));
    const sideQuestionTitles: Record<string, string> = {};
    const mapRe = /side_question_titles:\s*\{\s*key:\s*"((?:[^"\\]|\\.)*)"\s*value:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = mapRe.exec(raw)) !== null) {
      const k = unescapePbtxtString(m[1]);
      if (UUID_RE.test(k)) sideQuestionTitles[k] = unescapePbtxtString(m[2]);
    }
    return { title, sideQuestionIds, sideQuestionTitles };
  } catch {
    return { title: '', sideQuestionIds: [] as string[], sideQuestionTitles: {} as Record<string, string> };
  }
}

export function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let val = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const b = buf[pos++];
    val |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [val, pos];
}

export function iterFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const fnum = Number(key >> 3n);
    const wtype = Number(key & 7n);
    if (wtype === 0) {
      const [v, p2] = readVarint(buf, pos);
      pos = p2;
      fields.push([fnum, wtype, v]);
    } else if (wtype === 2) {
      const [lenBig, p2] = readVarint(buf, pos);
      const len = Number(lenBig);
      pos = p2;
      if (len < 0 || pos + len > buf.length) break;
      fields.push([fnum, wtype, buf.subarray(pos, pos + len)]);
      pos += len;
    } else if (wtype === 1) {
      if (pos + 8 > buf.length) break;
      fields.push([fnum, wtype, buf.subarray(pos, pos + 8)]);
      pos += 8;
    } else if (wtype === 5) {
      if (pos + 4 > buf.length) break;
      fields.push([fnum, wtype, buf.subarray(pos, pos + 4)]);
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

export function readDurationSec(buf: Uint8Array): number {
  let sec = 0;
  let nanos = 0;
  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt !== 0) continue;
    if (fn === 1) sec = Number(val);
    else if (fn === 2) nanos = Number(val);
  }
  return sec + nanos / 1e9;
}

export function parseUsageSubmsg(buf: Uint8Array): UsageSubmsg {
  const out: UsageSubmsg = {
    modelEnum: null,
    newInput: 0,
    cachedInput: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    candidateTokens: 0,
    botId: '',
    sessionId: '',
  };
  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt === 2 && fn === 7) {
      out.botId = Buffer.from(val).toString('utf8');
      continue;
    }
    if (wt === 2 && fn === 8) {
      let k = '';
      let v = '';
      for (const [sf, sw, sv] of iterFields(val)) {
        if (sw !== 2) continue;
        if (sf === 1) k = Buffer.from(sv).toString('utf8');
        else if (sf === 2) v = Buffer.from(sv).toString('utf8');
      }
      if (k === 'sessionID' && v) out.sessionId = v;
      continue;
    }
    if (wt !== 0) continue;
    const n = Number(val);
    if (fn === 1) out.modelEnum = n > 0 ? n : null;
    else if (fn === 2) out.newInput = n;
    else if (fn === 3) out.outputTokens = n;
    else if (fn === 5) out.cachedInput = n;
    else if (fn === 9) out.thinkingTokens = n;
    else if (fn === 10) out.candidateTokens = n;
  }
  return out;
}

const PARENT_REF_MAX_VALID_STEP = 1_000_000_000n;

export function parseParentReference(buf: Uint8Array): ParentReference {
  let parentTrajectoryId = '';
  let stepIndex: number | null = null;
  let isResetToStart = false;
  let parentCascadeId = '';

  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt === 2 && fn === 1) {
      const s = Buffer.from(val).toString('utf8');
      if (UUID_RE.test(s)) parentTrajectoryId = s;
    } else if (wt === 0 && fn === 2) {
      if (val <= PARENT_REF_MAX_VALID_STEP) {
        stepIndex = Number(val);
      } else {
        isResetToStart = true;
      }
    } else if (wt === 2 && fn === 6) {
      const s = Buffer.from(val).toString('utf8');
      if (UUID_RE.test(s)) parentCascadeId = s;
    }
  }

  return {
    parentTrajectoryId,
    stepIndex,
    isResetToStart,
    parentCascadeId,
  };
}

export function parseGenRow(idx: number, raw: Uint8Array) {
  const f1 = iterFields(raw).find((f): f is [number, 2, Uint8Array] => f[0] === 1 && f[1] === 2);
  if (!f1) return null;

  let modelEnum: number | null = null;
  let modelId = '';
  let modelDisplay = '';
  let modelEnumName = '';
  let primaryUsage: UsageSubmsg | null = null;
  let legacyUsage: UsageSubmsg | null = null;
  let ttftSec = 0;
  let genSec = 0;
  let contextReported = 0;
  let contextLimit = 0;
  let lastStepIndex: number | null = null;
  let cascadeId = '';
  let trajectoryId = '';
  let parentCascadeId = '';
  let rootCascadeId = '';
  let subagentType = '';

  for (const [fn, wt, val] of iterFields(f1[2])) {
    if (wt === 0 && fn === 3) {
      modelEnum = Number(val);
      continue;
    }
    if (wt !== 2) continue;
    if (fn === 19) modelId = Buffer.from(val).toString('utf8');
    else if (fn === 21) modelDisplay = Buffer.from(val).toString('utf8');
    else if (fn === 4) primaryUsage = parseUsageSubmsg(val);
    else if (fn === 11) ttftSec = readDurationSec(val);
    else if (fn === 12) genSec = readDurationSec(val);
    else if (fn === 9) {
      for (const [bf, bw, bv] of iterFields(val)) {
        if (bf === 10 && bw === 2) {
          for (const [cf, cw, cv] of iterFields(bv)) {
            if (cw !== 0) continue;
            if (cf === 1) contextReported = Number(cv);
            else if (cf === 4) contextLimit = Number(cv);
          }
        }
      }
    } else if (fn === 17) {
      const f2 = iterFields(val).find((f): f is [number, 2, Uint8Array] => f[0] === 2 && f[1] === 2);
      if (f2) legacyUsage = parseUsageSubmsg(f2[2]);
    } else if (fn === 20) {
      let k = '';
      let v = '';
      for (const [kf, kw, kv] of iterFields(val)) {
        if (kw !== 2) continue;
        if (kf === 1) k = Buffer.from(kv).toString('utf8');
        else if (kf === 2) v = Buffer.from(kv).toString('utf8');
      }
      if (k === 'last_step_index' && v !== '') {
        const parsed = Number(v);
        if (Number.isFinite(parsed)) lastStepIndex = parsed;
      } else if (k === 'model_enum' && v) {
        modelEnumName = v;
      } else if (k === 'cascade_id' && UUID_RE.test(v)) {
        cascadeId = v;
      } else if (k === 'trajectory_id' && UUID_RE.test(v)) {
        trajectoryId = v;
      } else if (k === 'parent_cascade_id' && UUID_RE.test(v)) {
        parentCascadeId = v;
      } else if (k === 'root_cascade_id' && UUID_RE.test(v)) {
        rootCascadeId = v;
      } else if (k === 'subagent_type' && v) {
        subagentType = v;
      }
    }
  }

  const u = (primaryUsage && (primaryUsage.cachedInput || primaryUsage.newInput || primaryUsage.outputTokens))
    ? primaryUsage
    : (legacyUsage || { modelEnum: null, newInput: 0, cachedInput: 0, outputTokens: 0, thinkingTokens: 0, candidateTokens: 0 });
  if (modelEnum === null && u.modelEnum) {
    modelEnum = u.modelEnum;
  }
  const outputTokens = u.outputTokens || (u.thinkingTokens + u.candidateTokens);
  const model = modelId || modelDisplay || modelEnumName || 'Unknown Model';
  const totalPromptTokens = u.cachedInput + u.newInput;
  const cacheHitPct = totalPromptTokens > 0 ? (u.cachedInput / totalPromptTokens) * 100 : null;
  const totalContext = contextReported > 0 ? contextReported : totalPromptTokens;
  const limit = contextLimit > 0 ? contextLimit : resolveLimitFallback(`${modelId} ${modelDisplay}`);
  const totalSec = ttftSec + genSec;
  const genTps = genSec > 0 ? outputTokens / genSec : 0;
  const e2eTps = totalSec > 0 ? outputTokens / totalSec : 0;
  // Flag single-packet or short (<1s) buffered burst flushes (>800 tok/s, e.g. Opus 9s TTFT + 0.76s flush)
  const isBuffered = genSec < 0.5 || (genSec < 1.0 && genTps > 800);

  return {
    idx,
    lastStepIndex,
    botId: (primaryUsage && primaryUsage.botId) || (legacyUsage && legacyUsage.botId) || '',
    sessionId: (primaryUsage && primaryUsage.sessionId) || (legacyUsage && legacyUsage.sessionId) || '',
    cascadeId,
    trajectoryId,
    modelEnum,
    model,
    modelId,
    modelDisplay,
    parentCascadeId,
    rootCascadeId,
    subagentType,
    newInput: u.newInput,
    cachedInput: u.cachedInput,
    totalPromptTokens,
    cacheHitPct,
    outputTokens,
    thinkingTokens: u.thinkingTokens,
    candidateTokens: u.candidateTokens,
    ttftSec,
    genSec,
    totalSec,
    isBuffered,
    genTps,
    e2eTps,
    totalContext,
    contextLimit: limit,
    contextPct: limit > 0 ? Math.min(100, (totalContext / limit) * 100) : 0,
  };
}

function addTokenCount(map: Map<string, number>, key: string, tokens: number) {
  if (!key || !(tokens > 0)) return;
  map.set(key, (map.get(key) || 0) + tokens);
}

function mapToSortedList(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

const MCP_TOOL_NAME_RE = /^mcp[_:]/i;
const SKILL_SECTION_RE = /^(?:(?:user|workspace|project|custom|global|agent)_)?skills?$|^skill[_:]/i;
const RULE_SECTION_RE = /^(?:(?:user|workspace|project|custom|global|agent|system)_)?rules?$|^rule[_:]/i;

export function parseContextBreakdown(raw: Uint8Array) {
  const f1 = iterFields(raw).find((f): f is [number, 2, Uint8Array] => f[0] === 1 && f[1] === 2);
  if (!f1) return null;

  let treeBuf: Uint8Array | null = null;
  let contextReported = 0;
  let contextLimit = 0;
  const msgBufs: Uint8Array[] = [];

  for (const [fn, wt, val] of iterFields(f1[2])) {
    if (wt !== 2) continue;
    if (fn === 2) {
      msgBufs.push(val);
    } else if (fn === 9) {
      for (const [bf, bw, bv] of iterFields(val)) {
        if (bf === 10 && bw === 2) {
          for (const [cf, cw, cv] of iterFields(bv)) {
            if (cw === 0 && cf === 1) contextReported = Number(cv);
            else if (cw === 0 && cf === 4) contextLimit = Number(cv);
            else if (cw === 2 && cf === 3) treeBuf = cv;
          }
        }
      }
    }
  }

  if (!treeBuf) return null;

  let treeTotal = 0;
  let systemPrompt = 0;
  let toolsSchema = 0;
  let chatMessages = 0;
  let userInput = 0;
  let assistant = 0;
  let toolResults = 0;
  let checkpoint = 0;
  let sysMsg = 0;
  let otherChat = 0;

  const sysPromptMap = new Map<string, number>();
  const toolSchemaMap = new Map<string, number>();

  for (const [tf, tw, tv] of iterFields(treeBuf)) {
    if (tw === 0 && tf === 2) {
      treeTotal = Number(tv);
      continue;
    }
    if (tw !== 2 || tf !== 1) continue;

    let secName = '';
    let secTok = 0;
    const items: { name: string; tokens: number }[] = [];
    for (const [sf, sw, sv] of iterFields(tv)) {
      if (sw === 2 && sf === 1) secName = Buffer.from(sv).toString('utf8');
      else if (sw === 0 && sf === 4) secTok = Number(sv);
      else if (sw === 2 && sf === 5) {
        let itemName = '';
        let itemTok = 0;
        for (const [itf, itw, itv] of iterFields(sv)) {
          if (itw === 2 && itf === 1) itemName = Buffer.from(itv).toString('utf8');
          else if (itw === 0 && itf === 3) itemTok = Number(itv);
        }
        items.push({ name: itemName, tokens: itemTok });
      }
    }

    if (secName === 'System Prompt') {
      systemPrompt += secTok;
      for (const it of items) addTokenCount(sysPromptMap, it.name, it.tokens);
    } else if (secName === 'Tools') {
      toolsSchema += secTok;
      for (const it of items) addTokenCount(toolSchemaMap, it.name, it.tokens);
    } else {
      chatMessages += secTok;
      for (const it of items) {
        if (it.name.endsWith('USER_INPUT')) userInput += it.tokens;
        else if (it.name.endsWith('PLANNER_RESPONSE')) assistant += it.tokens;
        else if (it.name.endsWith('GENERIC')) toolResults += it.tokens;
        else if (it.name.includes('CHECKPOINT')) checkpoint += it.tokens;
        else if (it.name.includes('SYSTEM_MESSAGE')) sysMsg += it.tokens;
        else otherChat += it.tokens;
      }
    }
  }

  const callToTool = new Map<string, string>();
  const toolMsgs: { callId: string; tok: number }[] = [];
  for (const mb of msgBufs) {
    let role = 0;
    let tok = 0;
    let callId = '';
    for (const [mf, mw, mv] of iterFields(mb)) {
      if (mw === 0 && mf === 2) role = Number(mv);
      else if (mw === 0 && mf === 4) tok = Number(mv);
      else if (mw === 2 && mf === 6) {
        let cid = '';
        let tname = '';
        for (const [cf, cw, cv] of iterFields(mv)) {
          if (cw === 2 && cf === 1) cid = Buffer.from(cv).toString('utf8');
          else if (cw === 2 && cf === 2) tname = Buffer.from(cv).toString('utf8');
        }
        if (cid && tname) callToTool.set(cid, tname);
      } else if (mw === 2 && mf === 7) {
        callId = Buffer.from(mv).toString('utf8');
      }
    }
    if (role === 4 || callId) {
      toolMsgs.push({ callId, tok });
    }
  }

  const toolResultsMap = new Map<string, number>();
  let toolMsgSum = 0;
  for (const tm of toolMsgs) {
    toolMsgSum += tm.tok;
    const name = callToTool.get(tm.callId) || 'other';
    addTokenCount(toolResultsMap, name, tm.tok);
  }
  if (toolResults === 0 && toolMsgSum > 0) toolResults = toolMsgSum;

  const reportedTotal = treeTotal || contextReported || (systemPrompt + toolsSchema + chatMessages);
  if (reportedTotal <= 0) return null;

  let mcpTools = 0;
  for (const [name, tokens] of toolSchemaMap) {
    if (MCP_TOOL_NAME_RE.test(name)) mcpTools += tokens;
  }

  let skills = 0;
  let rules = 0;
  for (const [name, tokens] of sysPromptMap) {
    if (SKILL_SECTION_RE.test(name)) skills += tokens;
    else if (RULE_SECTION_RE.test(name)) rules += tokens;
  }

  return {
    reportedTotal,
    contextLimit,
    systemPrompt,
    toolsSchema,
    chatMessages,
    userInput,
    assistant,
    toolResults,
    checkpoint,
    sysMsg,
    otherChat,
    userAndOther: userInput + checkpoint + sysMsg + otherChat,
    mcpTools,
    skills,
    rules,
    checkpointTokens: checkpoint,
    systemPromptItems: mapToSortedList(sysPromptMap),
    toolSchemaItems: mapToSortedList(toolSchemaMap),
    toolResultsByTool: mapToSortedList(toolResultsMap),
  };
}

export function parseStepMetadata(metaBuf: Uint8Array) {
  let createdAtMs = 0;
  let startedAtMs = 0;
  let streamStartMs = 0;
  let completedAtMs = 0;
  let endAtMs = 0;
  let modelEnum: number | null = null;
  let toolName = '';
  let gmIdx: number | null = null;
  let botId = '';
  let usage: UsageSubmsg | null = null;

  for (const [fn, wt, val] of iterFields(metaBuf)) {
    if (wt === 0 && fn === 11) {
      modelEnum = Number(val);
      continue;
    }
    if (wt !== 2) continue;
    if (fn === 1) createdAtMs = readDurationSec(val) * 1000;
    else if (fn === 6) streamStartMs = readDurationSec(val) * 1000;
    else if (fn === 7) completedAtMs = readDurationSec(val) * 1000;
    else if (fn === 8) endAtMs = readDurationSec(val) * 1000;
    else if (fn === 32) startedAtMs = readDurationSec(val) * 1000;
    else if (fn === 4) {
      for (const [sf, sw, sv] of iterFields(val)) {
        if (sf === 2 && sw === 2 && sv.length > 0 && sv.length <= 80) {
          const text = Buffer.from(sv).toString('utf8');
          if (/^[\x20-\x7e]+$/.test(text)) toolName = text;
        }
      }
    } else if (fn === 9) {
      usage = parseUsageSubmsg(val);
      if (usage.botId) botId = usage.botId;
    } else if (fn === 20) {
      for (const [sf, sw, sv] of iterFields(val)) {
        if (sf === 3 && sw === 0) gmIdx = Number(sv);
      }
    }
  }
  if (!createdAtMs && startedAtMs) {
    createdAtMs = startedAtMs;
  }
  if (modelEnum === null && usage?.modelEnum) {
    modelEnum = usage.modelEnum;
  }
  return {
    createdAtMs,
    startedAtMs,
    streamStartMs,
    completedAtMs,
    endAtMs,
    modelEnum,
    toolName,
    gmIdx,
    botId,
    usage,
  };
}

export function isCompactPromptText(text) {
  return /^\s*\/compact(?:\s|$)/i.test(String(text || ''));
}

export function parseUserPromptPayload(payloadBuf: Uint8Array | null | undefined) {
  if (!payloadBuf) return { preview: '', full: '', isCompact: false };
  const f19 = iterFields(payloadBuf).find((f): f is [number, 2, Uint8Array] => f[0] === 19 && f[1] === 2);
  if (!f19) return { preview: '', full: '', isCompact: false };
  let text = '';
  let itemText = '';
  let hasCompactCmdItem = false;

  for (const [fn, wt, val] of iterFields(f19[2])) {
    if (wt !== 2) continue;
    if (fn === 2 && !text) {
      text = Buffer.from(val).toString('utf8');
    } else if (fn === 3) {
      for (const [sf, sw, sv] of iterFields(val)) {
        if (sw !== 2) continue;
        if (sf === 1 && !itemText) {
          itemText = Buffer.from(sv).toString('utf8');
        } else if (sf === 2) {
          const subStr = Buffer.from(sv).toString('utf8');
          if (subStr.includes('collapse_all') || /(?:^|[\x00-\x1f])compact(?:$|[\x00-\x1f])/i.test(subStr)) {
            hasCompactCmdItem = true;
          }
        }
      }
    }
  }

  const finalText = text || itemText;
  const isCompact = hasCompactCmdItem || isCompactPromptText(finalText);
  const singleLine = finalText.replace(/\s+/g, ' ').trim() || (isCompact ? '/compact' : '');
  return {
    preview: clipText(singleLine, 44),
    full: clipText(finalText || singleLine, DETAIL_PROMPT_MAX),
    isCompact,
  };
}

export function parsePlannerPayload(payloadBuf: Uint8Array | null | undefined, liveMode = false) {
  if (!payloadBuf) return null;
  const f20 = iterFields(payloadBuf).find((f): f is [number, 2, Uint8Array] => f[0] === 20 && f[1] === 2);
  if (!f20) return null;

  let thinking = '';
  let reply = '';
  let replyAlt = '';
  const toolCalls: { name: string; args: string }[] = [];

  for (const [fn, wt, val] of iterFields(f20[2])) {
    if (wt !== 2) continue;
    if (fn === 3) thinking = Buffer.from(val).toString('utf8');
    else if (fn === 1) reply = Buffer.from(val).toString('utf8');
    else if (fn === 8) replyAlt = Buffer.from(val).toString('utf8');
    else if (fn === 7) {
      let name = '';
      let args = '';
      for (const [tf, tw, tv] of iterFields(val)) {
        if (tw !== 2) continue;
        if (tf === 2) name = Buffer.from(tv).toString('utf8');
        else if (tf === 3) args = Buffer.from(tv).toString('utf8');
      }
      if (name) toolCalls.push({ name, args: clipText(args, DETAIL_TOOL_ARGS_MAX) });
    }
  }

  const rawReply = reply || replyAlt;
  if (liveMode) {
    const tLive = clipLiveStreamText(thinking, LIVE_STREAM_PREVIEW_MAX);
    const rLive = clipLiveStreamText(rawReply, LIVE_STREAM_PREVIEW_MAX);
    return {
      thinking: tLive.text,
      thinkingChars: tLive.totalChars,
      thinkingTruncated: tLive.truncatedHead,
      reply: rLive.text,
      replyChars: rLive.totalChars,
      replyTruncated: rLive.truncatedHead,
      toolCalls,
    };
  }

  const cleanThinking = thinking.trim();
  const cleanReply = rawReply.trim();
  return {
    thinking: clipText(cleanThinking, DETAIL_CONTENT_MAX),
    thinkingChars: cleanThinking.length,
    reply: clipText(cleanReply, DETAIL_CONTENT_MAX),
    replyChars: cleanReply.length,
    toolCalls,
  };
}

export function parseCompactPayload(payloadBuf: Uint8Array | null | undefined): string {
  if (!payloadBuf) return '';
  const f30 = iterFields(payloadBuf).find((f): f is [number, 2, Uint8Array] => f[0] === 30 && f[1] === 2);
  if (!f30) return '';
  const f5 = iterFields(f30[2]).find((f): f is [number, 2, Uint8Array] => f[0] === 5 && f[1] === 2);
  if (!f5) return '';
  return clipText(Buffer.from(f5[2]).toString('utf8'), DETAIL_COMPACT_MAX);
}
