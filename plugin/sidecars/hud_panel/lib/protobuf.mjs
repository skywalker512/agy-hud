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
} from './constants.mjs';
import { resolveLimitFallback } from './pricing.mjs';

export function unescapePbtxtString(raw) {
  if (!raw || !raw.includes('\\')) return raw || '';
  const bytes = [];
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

function extractPbtxtField(text, fieldName) {
  const re = new RegExp(`(?:^|\\s)${fieldName}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(unescapePbtxtString(m[1]));
  return out;
}

export function parseAnnotationPbtxt(annoPath) {
  try {
    const raw = readFileSync(annoPath, 'utf8');
    const title = extractPbtxtField(raw, 'title')[0] || '';
    const sideQuestionIds = extractPbtxtField(raw, 'side_question_cascade_ids').filter((id) => UUID_RE.test(id));
    const sideQuestionTitles = {};
    const mapRe = /side_question_titles:\s*\{\s*key:\s*"((?:[^"\\]|\\.)*)"\s*value:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let m;
    while ((m = mapRe.exec(raw)) !== null) {
      const k = unescapePbtxtString(m[1]);
      if (UUID_RE.test(k)) sideQuestionTitles[k] = unescapePbtxtString(m[2]);
    }
    return { title, sideQuestionIds, sideQuestionTitles };
  } catch {
    return { title: '', sideQuestionIds: [], sideQuestionTitles: {} };
  }
}

export function readVarint(buf, pos) {
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

export function iterFields(buf) {
  const fields = [];
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

export function readDurationSec(buf) {
  let sec = 0;
  let nanos = 0;
  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt !== 0) continue;
    if (fn === 1) sec = Number(val);
    else if (fn === 2) nanos = Number(val);
  }
  return sec + nanos / 1e9;
}

export function parseUsageSubmsg(buf) {
  const out = {
    modelEnum: null,
    newInput: 0,
    cachedInput: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    candidateTokens: 0,
    botId: '',
  };
  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt === 2 && fn === 7) {
      out.botId = Buffer.from(val).toString('utf8');
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

export function parseGenRow(idx, raw) {
  const f1 = iterFields(raw).find(([fn, wt]) => fn === 1 && wt === 2);
  if (!f1) return null;

  let modelEnum = null;
  let modelId = '';
  let modelDisplay = '';
  let modelEnumName = '';
  let primaryUsage = null;
  let legacyUsage = null;
  let ttftSec = 0;
  let genSec = 0;
  let contextReported = 0;
  let contextLimit = 0;
  let lastStepIndex = null;
  let parentCascadeId = '';
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
      const f2 = iterFields(val).find(([sf, sw]) => sf === 2 && sw === 2);
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
      } else if (k === 'parent_cascade_id' && UUID_RE.test(v)) {
        parentCascadeId = v;
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
  const isBuffered = genSec < 0.5 || (genSec < 1.0 && genTps > 1200);

  return {
    idx,
    lastStepIndex,
    botId: (primaryUsage && primaryUsage.botId) || (legacyUsage && legacyUsage.botId) || '',
    modelEnum,
    model,
    modelId,
    modelDisplay,
    parentCascadeId,
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

function addTokenCount(map, key, tokens) {
  if (!key || !(tokens > 0)) return;
  map.set(key, (map.get(key) || 0) + tokens);
}

function mapToSortedList(map) {
  return Array.from(map.entries())
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function parseContextBreakdown(raw) {
  const f1 = iterFields(raw).find(([fn, wt]) => fn === 1 && wt === 2);
  if (!f1) return null;

  let treeBuf = null;
  let contextReported = 0;
  let contextLimit = 0;
  const msgBufs = [];

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

  const sysPromptMap = new Map();
  const toolSchemaMap = new Map();

  for (const [tf, tw, tv] of iterFields(treeBuf)) {
    if (tw === 0 && tf === 2) {
      treeTotal = Number(tv);
      continue;
    }
    if (tw !== 2 || tf !== 1) continue;

    let secName = '';
    let secTok = 0;
    const items = [];
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

  const callToTool = new Map();
  const toolMsgs = [];
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

  const toolResultsMap = new Map();
  let toolMsgSum = 0;
  for (const tm of toolMsgs) {
    toolMsgSum += tm.tok;
    const name = callToTool.get(tm.callId) || 'other';
    addTokenCount(toolResultsMap, name, tm.tok);
  }
  if (toolResults === 0 && toolMsgSum > 0) toolResults = toolMsgSum;

  const reportedTotal = treeTotal || contextReported || (systemPrompt + toolsSchema + chatMessages);
  if (reportedTotal <= 0) return null;

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
    systemPromptItems: mapToSortedList(sysPromptMap),
    toolSchemaItems: mapToSortedList(toolSchemaMap),
    toolResultsByTool: mapToSortedList(toolResultsMap),
  };
}

export function parseStepMetadata(metaBuf) {
  let createdAtMs = 0;
  let startedAtMs = 0;
  let streamStartMs = 0;
  let completedAtMs = 0;
  let endAtMs = 0;
  let modelEnum = null;
  let toolName = '';
  let gmIdx = null;
  let botId = '';
  let usage = null;

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

export function parseUserPromptPayload(payloadBuf) {
  if (!payloadBuf) return { preview: '', full: '', isCompact: false };
  const f19 = iterFields(payloadBuf).find(([fn, wt]) => fn === 19 && wt === 2);
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

export function parsePlannerPayload(payloadBuf, liveMode = false) {
  if (!payloadBuf) return null;
  const f20 = iterFields(payloadBuf).find(([fn, wt]) => fn === 20 && wt === 2);
  if (!f20) return null;

  let thinking = '';
  let reply = '';
  let replyAlt = '';
  const toolCalls = [];

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

export function parseCompactPayload(payloadBuf) {
  if (!payloadBuf) return '';
  const f30 = iterFields(payloadBuf).find(([fn, wt]) => fn === 30 && wt === 2);
  if (!f30) return '';
  const f5 = iterFields(f30[2]).find(([fn, wt]) => fn === 5 && wt === 2);
  if (!f5) return '';
  return clipText(Buffer.from(f5[2]).toString('utf8'), DETAIL_COMPACT_MAX);
}
