import { UUID_RE } from '../../../plugin/sidecars/hud_panel/lib/constants.ts';
import { iterFields } from '../../../plugin/sidecars/hud_panel/lib/protobuf.ts';
import { loadTraceFile } from './replay.mjs';
import { asBuffer, TRACE_SCHEMA_VERSION } from './step-decoder.mjs';

function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function wireField(fieldNum, wireType, val) {
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | BigInt(wireType));
  if (wireType === 0) {
    return Buffer.concat([tag, encodeVarint(val)]);
  }
  if (wireType === 2) {
    const b = Buffer.isBuffer(val) ? val : Buffer.from(val);
    return Buffer.concat([tag, encodeVarint(b.length), b]);
  }
  return Buffer.concat([tag, asBuffer(val)]);
}

function redactTextPaths(text, uuidMapper) {
  if (!text) return '';
  let out = String(text)
    .replace(/\/Users\/[^/\s"']+/g, '/Users/redacted')
    .replace(/\/home\/[^/\s"']+/g, '/home/redacted')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\redacted');
  if (uuidMapper) {
    out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => uuidMapper(m));
  }
  return out;
}

function rewriteProtobufMessage(buf, transformField) {
  const fields = iterFields(asBuffer(buf));
  if (!fields.length) return asBuffer(buf);
  const parts = [];
  for (const [fn, wt, val] of fields) {
    const next = transformField(fn, wt, val);
    if (next === null) continue;
    parts.push(wireField(fn, wt, next));
  }
  return Buffer.concat(parts);
}

export function redactProtobufBlob(kind, rawBuf, uuidMapper = (id) => id) {
  const buf = asBuffer(rawBuf);
  if (!buf.length) return buf;

  if (kind === 'step_metadata') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 9) {
        return rewriteProtobufMessage(val, (uf, uw, uv) => {
          if (uw === 2 && uf === 7) {
            return Buffer.from(uuidMapper(Buffer.from(uv).toString('utf8')), 'utf8');
          }
          return uv;
        });
      }
      return val;
    });
  }

  if (kind === 'gen_metadata') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 1) {
        return rewriteProtobufMessage(val, (gf, gw, gv) => {
          if (gw === 2 && gf === 4) {
            return redactProtobufBlob('usage_submsg', gv, uuidMapper);
          }
          if (gw === 2 && gf === 17) {
            return rewriteProtobufMessage(gv, (lf, lw, lv) => (
              lw === 2 && lf === 2 ? redactProtobufBlob('usage_submsg', lv, uuidMapper) : lv
            ));
          }
          if (gw === 2 && gf === 20) {
            let k = '';
            for (const [kf, kw, kv] of iterFields(gv)) {
              if (kw === 2 && kf === 1) k = Buffer.from(kv).toString('utf8');
            }
            if (k === 'parent_cascade_id') {
              return rewriteProtobufMessage(gv, (kf, kw, kv) => (
                kw === 2 && kf === 2
                  ? Buffer.from(uuidMapper(Buffer.from(kv).toString('utf8')), 'utf8')
                  : kv
              ));
            }
          }
          return gv;
        });
      }
      return val;
    });
  }

  if (kind === 'usage_submsg') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 7) {
        return Buffer.from(uuidMapper(Buffer.from(val).toString('utf8')), 'utf8');
      }
      return val;
    });
  }

  if (kind === 'step_payload') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt !== 2) return val;
      if (fn === 19) {
        return rewriteProtobufMessage(val, (uf, uw, uv) => {
          if (uw !== 2) return uv;
          if (uf === 2) {
            const orig = Buffer.from(uv).toString('utf8');
            const isComp = /^\s*\/compact(?:\s|$)/i.test(orig);
            return Buffer.from(isComp ? '/compact' : `[REDACTED_PROMPT_${orig.length}ch]`, 'utf8');
          }
          if (uf === 3) {
            return rewriteProtobufMessage(uv, (itf, itw, itv) => {
              if (itw === 2 && itf === 1) {
                const orig = Buffer.from(itv).toString('utf8');
                const isComp = /^\s*\/compact(?:\s|$)/i.test(orig);
                return Buffer.from(isComp ? '/compact' : `[REDACTED_ITEM_${orig.length}ch]`, 'utf8');
              }
              return itv;
            });
          }
          return uv;
        });
      }
      if (fn === 20) {
        return rewriteProtobufMessage(val, (pf, pw, pv) => {
          if (pw !== 2) return pv;
          if (pf === 1 || pf === 8) {
            const orig = Buffer.from(pv).toString('utf8');
            return Buffer.from(`[REDACTED_REPLY_${orig.length}ch]`, 'utf8');
          }
          if (pf === 3) {
            const orig = Buffer.from(pv).toString('utf8');
            return Buffer.from(`[REDACTED_THINKING_${orig.length}ch]`, 'utf8');
          }
          if (pf === 7) {
            return rewriteProtobufMessage(pv, (tf, tw, tv) => {
              if (tw === 2 && tf === 3) {
                const orig = Buffer.from(tv).toString('utf8');
                return Buffer.from(JSON.stringify({ redacted: true, len: orig.length }), 'utf8');
              }
              return tv;
            });
          }
          return pv;
        });
      }
      if (fn === 30) {
        return rewriteProtobufMessage(val, (cf, cw, cv) => {
          if (cw === 2 && cf === 5) {
            const orig = Buffer.from(cv).toString('utf8');
            return Buffer.from(`[REDACTED_COMPACT_${orig.length}ch]`, 'utf8');
          }
          return cv;
        });
      }
      if (fn === 24) {
        return rewriteProtobufMessage(val, (ef, ew, ev) => {
          if (ew === 2 && ef === 3) {
            return rewriteProtobufMessage(ev, (df, dw, dv) => {
              if (dw === 2 && (df === 1 || df === 2 || df === 3 || df === 6)) {
                return Buffer.from(redactTextPaths(Buffer.from(dv).toString('utf8'), uuidMapper), 'utf8');
              }
              return dv;
            });
          }
          return ev;
        });
      }
      if (fn === 31) {
        return rewriteProtobufMessage(val, (ef, ew, ev) => {
          if (ew === 2 && (ef === 1 || ef === 2 || ef === 3)) {
            return Buffer.from(redactTextPaths(Buffer.from(ev).toString('utf8'), uuidMapper), 'utf8');
          }
          return ev;
        });
      }
      return val;
    });
  }

  return buf;
}

export function createUuidAnonymizer() {
  const map = new Map();
  let counter = 1;
  return (rawId) => {
    const clean = String(rawId || '').trim();
    if (!clean || !UUID_RE.test(clean)) return clean;
    const key = clean.toLowerCase();
    if (!map.has(key)) {
      const hex = String(counter++).padStart(12, '0');
      map.set(key, `00000000-0000-4000-8000-${hex}`);
    }
    return map.get(key);
  };
}

export function exportTraceFixture(
  tracePath,
  {
    fromSeq = 0,
    toSeq = Infinity,
    aroundAnomalySeq = null,
    windowRadius = 5,
    redact = true,
  } = {},
) {
  const trace = loadTraceFile(tracePath);
  const allFrames = trace.frames;
  if (!allFrames.length) {
    throw new Error('trace contains no frames');
  }

  let minSeq = fromSeq;
  let maxSeq = toSeq;
  if (aroundAnomalySeq !== null && aroundAnomalySeq !== undefined) {
    minSeq = Math.max(0, aroundAnomalySeq - windowRadius);
    maxSeq = aroundAnomalySeq + windowRadius;
  }

  const stepMapByConv = new Map();
  const gmMapByConv = new Map();
  const uuidMap = redact ? createUuidAnonymizer() : (x) => x;

  const redactStringVal = (s, tag = 'TEXT') => {
    if (!redact || !s) return s;
    return `[REDACTED_${tag}_${s.length}ch]`;
  };

  const redactLsStep = (st) => {
    if (!redact || !st) return st;
    const out = structuredClone(st);
    if (out.metadata?.executionId) out.metadata.executionId = uuidMap(out.metadata.executionId);
    if (out.metadata?.toolCall?.id) out.metadata.toolCall.id = 'call_redacted';
    if (out.plannerResponse) {
      if (out.plannerResponse.thinking) out.plannerResponse.thinking = redactStringVal(out.plannerResponse.thinking, 'THINKING');
      if (out.plannerResponse.response) out.plannerResponse.response = redactStringVal(out.plannerResponse.response, 'REPLY');
      if (out.plannerResponse.modifiedResponse) out.plannerResponse.modifiedResponse = redactStringVal(out.plannerResponse.modifiedResponse, 'REPLY');
      if (Array.isArray(out.plannerResponse.toolCalls)) {
        out.plannerResponse.toolCalls = out.plannerResponse.toolCalls.map((tc) => ({
          ...tc,
          id: tc.id ? 'call_redacted' : '',
          argumentsJson: tc.argumentsJson ? JSON.stringify({ redacted: true, len: tc.argumentsJson.length }) : '',
        }));
      }
    }
    if (out.userInput) {
      if (out.userInput.userResponse && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.userResponse)) {
        out.userInput.userResponse = redactStringVal(out.userInput.userResponse, 'PROMPT');
      }
      if (out.userInput.text && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.text)) {
        out.userInput.text = redactStringVal(out.userInput.text, 'PROMPT');
      }
      if (out.userInput.query && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.query)) {
        out.userInput.query = redactStringVal(out.userInput.query, 'PROMPT');
      }
      if (Array.isArray(out.userInput.items)) {
        out.userInput.items = out.userInput.items.map((it) => (
          it?.text && !/^\s*\/compact(?:\s|$)/i.test(it.text)
            ? { ...it, text: redactStringVal(it.text, 'ITEM') }
            : it
        ));
      }
    }
    if (out.errorMessage) {
      for (const k of ['userMessage', 'shortError', 'fullError']) {
        if (typeof out.errorMessage[k] === 'string') {
          out.errorMessage[k] = redactTextPaths(out.errorMessage[k], uuidMap);
        }
      }
    }
    return out;
  };

  const sanitizeStepDelta = (s) => {
    const out = structuredClone(s);
    if (redact) {
      if (out.summary) {
        if (out.summary.botId) out.summary.botId = uuidMap(out.summary.botId);
        if (out.summary.promptPreview) out.summary.promptPreview = '[REDACTED_PROMPT]';
        if (out.summary.compactSummary) out.summary.compactSummary = '[REDACTED_COMPACT]';
        if (out.summary.error) {
          for (const k of ['userMessage', 'shortError', 'fullError']) {
            if (out.summary.error[k]) out.summary.error[k] = redactTextPaths(out.summary.error[k], uuidMap);
          }
        }
      }
      if (out.metadataB64) {
        out.metadataB64 = redactProtobufBlob('step_metadata', Buffer.from(out.metadataB64, 'base64'), uuidMap).toString('base64');
      }
      if (out.stepPayloadB64) {
        out.stepPayloadB64 = redactProtobufBlob('step_payload', Buffer.from(out.stepPayloadB64, 'base64'), uuidMap).toString('base64');
      }
    }
    return out;
  };

  const sanitizeGmDelta = (g) => {
    const out = structuredClone(g);
    if (redact) {
      if (out.parsedSummary?.botId) out.parsedSummary.botId = uuidMap(out.parsedSummary.botId);
      if (out.dataB64) {
        out.dataB64 = redactProtobufBlob('gen_metadata', Buffer.from(out.dataB64, 'base64'), uuidMap).toString('base64');
      }
    }
    return out;
  };

  const slicedFrames = [];
  const initializedConvs = new Set();

  for (const frame of allFrames) {
    const cid = frame.target?.id || '00000000-0000-4000-8000-000000000000';
    if (!stepMapByConv.has(cid)) stepMapByConv.set(cid, new Map());
    if (!gmMapByConv.has(cid)) gmMapByConv.set(cid, new Map());
    const sMap = stepMapByConv.get(cid);
    const gMap = gmMapByConv.get(cid);

    if (frame.seq < minSeq) {
      for (const s of frame.db?.stepsDelta || []) sMap.set(s.idx, s);
      for (const idx of frame.db?.stepsRemoved || []) sMap.delete(idx);
      for (const g of frame.db?.gmDelta || []) gMap.set(g.idx, g);
      for (const idx of frame.db?.gmRemoved || []) gMap.delete(idx);
      continue;
    }
    if (frame.seq > maxSeq) break;

    let frameStepsDelta = frame.db?.stepsDelta || [];
    let frameGmDelta = frame.db?.gmDelta || [];
    const isFirstForConv = !initializedConvs.has(cid);
    if (isFirstForConv) {
      initializedConvs.add(cid);
      for (const s of frameStepsDelta) sMap.set(s.idx, s);
      for (const idx of frame.db?.stepsRemoved || []) sMap.delete(idx);
      for (const g of frameGmDelta) gMap.set(g.idx, g);
      for (const idx of frame.db?.gmRemoved || []) gMap.delete(idx);
      frameStepsDelta = [...sMap.values()].sort((a, b) => a.idx - b.idx);
      frameGmDelta = [...gMap.values()].sort((a, b) => a.idx - b.idx);
    }

    const sanitizeHudBlock = (hud) => {
      if (!redact || !hud) return hud;
      const out = structuredClone(hud);
      if (out.error) out.error = redactTextPaths(out.error, uuidMap);
      if (out.telemetry?.activeStep) {
        const act = out.telemetry.activeStep;
        if (act.thinkingPreview) act.thinkingPreview = redactStringVal(act.thinkingPreview, 'THINKING');
        if (act.replyPreview) act.replyPreview = redactStringVal(act.replyPreview, 'REPLY');
        if (Array.isArray(act.toolCalls)) {
          act.toolCalls = act.toolCalls.map((tc) => ({
            ...tc,
            args: tc.args ? JSON.stringify({ redacted: true, len: tc.args.length }) : '',
          }));
        }
      }
      if (out.telemetry?.latest?.botId) {
        out.telemetry.latest.botId = uuidMap(out.telemetry.latest.botId);
      }
      if (out.telemetry?.latest?.parentCascadeId) {
        out.telemetry.latest.parentCascadeId = uuidMap(out.telemetry.latest.parentCascadeId);
      }
      return out;
    };

    const sanitizeAnomaly = (a) => {
      if (!redact) return a;
      const out = structuredClone(a);
      if (out.message) out.message = redactTextPaths(out.message, uuidMap);
      if (out.details) {
        const cleanDetails = (val) => {
          if (typeof val === 'string') return redactTextPaths(val, uuidMap);
          if (Array.isArray(val)) return val.map(cleanDetails);
          if (val && typeof val === 'object') {
            const o = {};
            for (const [k, v] of Object.entries(val)) o[k] = cleanDetails(v);
            return o;
          }
          return val;
        };
        out.details = cleanDetails(out.details);
      }
      return out;
    };

    slicedFrames.push({
      kind: 'frame',
      seq: frame.seq,
      tsMs: frame.tsMs,
      elapsedMs: frame.elapsedMs,
      target: {
        id: uuidMap(cid),
        key: frame.target?.key || '',
        annoKey: frame.target?.annoKey || '0:0',
      },
      ls: {
        ...frame.ls,
        steps: (frame.ls?.steps || []).map(redactLsStep),
      },
      db: {
        ...frame.db,
        stepsDelta: frameStepsDelta.map(sanitizeStepDelta),
        stepsRemoved: isFirstForConv ? [] : (frame.db?.stepsRemoved || []),
        gmDelta: frameGmDelta.map(sanitizeGmDelta),
        gmRemoved: isFirstForConv ? [] : (frame.db?.gmRemoved || []),
      },
      hud: sanitizeHudBlock(frame.hud),
      anomalies: (frame.anomalies || []).map(sanitizeAnomaly),
    });
  }

  return {
    kind: 'agy_hud_trace_fixture',
    schemaVersion: TRACE_SCHEMA_VERSION,
    exportedAtIso: new Date().toISOString(),
    redacted: Boolean(redact),
    range: { fromSeq: minSeq, toSeq: maxSeq },
    frameCount: slicedFrames.length,
    frames: slicedFrames,
  };
}
