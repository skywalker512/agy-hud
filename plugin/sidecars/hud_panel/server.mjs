/**
 * AGY-HUD sidecar telemetry server.
 * Serves the Preact + Tailwind compiled bundle from ./ui/ and exposes read-only
 * SQLite + Language Server telemetry over HTTP via sidecar_sdk.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QUOTA_TTL_MS,
  UUID_RE,
  clipLiveStreamText,
  clipText,
  mergeIntervalDurationSec,
  resolveAllAppDataDirs,
  resolveAppDataDir,
  resolveTranscriptPaths,
  statSafe,
} from './lib/constants.mjs';
import {
  computeCallCost,
  getPricingVectorSig,
  resolveModelPricing,
} from './lib/pricing.mjs';
import {
  isCompactPromptText,
  iterFields,
  parseAnnotationPbtxt,
  parseContextBreakdown,
  parseGenRow,
  parsePlannerPayload,
  parseStepMetadata,
  parseUserPromptPayload,
  readDurationSec,
  readVarint,
  unescapePbtxtString,
} from './lib/protobuf.mjs';
import {
  ensureLsModelCatalogWarm,
  extractLiveStepFromTrajectory,
  fetchLiveActiveStep,
  getCascadeSummariesCached,
  getLsModelCatalogVersion,
  getUserStatusCached,
  isCascadeStatusActive,
  isCompactUserInputLs,
  isLoopbackHost,
  normalizeLsBaseUrl,
  quotaCache,
  resolveLsGeneratorModel,
  schedulePostCallQuotaSample,
} from './lib/ls-client.mjs';
import {
  getTelemetryCached,
  listConversations,
  readTelemetry,
  toLightTelemetryPayload,
} from './lib/telemetry.mjs';
import {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  buildAccountHistory,
  buildSessionInfo,
  computeSummaryQuotaUsage,
  conversationEffectiveMs,
  getBgSummaryWarmSeq,
  getConversationGraph,
  pickTargetConversation,
  summarizeConversationDb,
} from './lib/graph.mjs';
import {
  computeBaseReferenceUSD,
  ingestQuotaObservation,
  predictCallQuota,
  reconcilePoolSamplesPricing,
  solvePoolFitModel,
} from './lib/quota-fitter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UI_DIR = join(__dirname, 'ui');
const BOOT_ID = `${process.pid}-${Date.now()}`;

const STATIC_ASSETS = {
  '/styles.css': [join(UI_DIR, 'styles.css'), 'text/css; charset=utf-8'],
  '/app.js': [join(UI_DIR, 'app.js'), 'application/javascript; charset=utf-8'],
};
const WATCHED_ASSETS = ['index.html', 'styles.css', 'app.js'];
const assetMemCache = new Map();
let lastCompleteAssetKey = '';

function readUiAsset(filePath, fallback = '') {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (content && content.length > 0) {
      assetMemCache.set(filePath, content);
      return content;
    }
  } catch {
    /* transient read error during rebuild; fall back to cached copy */
  }
  return assetMemCache.get(filePath) ?? fallback;
}

function getAssetKey() {
  const stats = WATCHED_ASSETS.map((name) => statSafe(join(UI_DIR, name)));
  if (stats.every((s) => s.size > 0)) {
    lastCompleteAssetKey = stats.map((s) => `${s.mtimeMs}:${s.size}`).join('|');
  }
  return lastCompleteAssetKey;
}

function startSelfWatch() {
  if (!process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) return;
  try {
    const realDir = dirname(realpathSync(__filename));
    const libDir = join(realDir, 'lib');
    const rootFiles = ['server.mjs', 'pricing.json'];

    const snapshotSig = () => {
      const parts = rootFiles.map((n) => {
        const s = statSafe(join(realDir, n));
        return `${n}:${s.mtimeMs}:${s.size}`;
      });
      if (existsSync(libDir)) {
        const libFiles = readdirSync(libDir).filter((n) => n.endsWith('.mjs')).sort();
        for (const lf of libFiles) {
          const s = statSafe(join(libDir, lf));
          parts.push(`lib/${lf}:${s.mtimeMs}:${s.size}`);
        }
      }
      return parts.join('|');
    };

    const bootSig = snapshotSig();
    let timer = null;
    const triggerRestartCheck = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const serverStat = statSafe(join(realDir, 'server.mjs'));
        if (serverStat.size > 100 && snapshotSig() !== bootSig) {
          process.exit(0);
        }
      }, 350);
    };

    const rootWatcher = watch(realDir, (_evt, filename) => {
      if (filename && !rootFiles.includes(String(filename))) return;
      triggerRestartCheck();
    });
    rootWatcher.unref?.();

    if (existsSync(libDir)) {
      const libWatcher = watch(libDir, (_evt, filename) => {
        if (filename && !String(filename).endsWith('.mjs')) return;
        triggerRestartCheck();
      });
      libWatcher.unref?.();
    }
  } catch {
    /* ignore watch failures */
  }
}

let lastAutoTargetId = '';

async function startServer() {
  const { Response, SidecarApp } = await import('sidecar_sdk');
  const appDataDir = resolveAppDataDir();
  const app = new SidecarApp();

  ensureLsModelCatalogWarm();

  const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  };

  const indexHtmlPath = join(UI_DIR, 'index.html');
  readUiAsset(indexHtmlPath);
  for (const [filePath] of Object.values(STATIC_ASSETS)) {
    readUiAsset(filePath);
  }

  app.page('/', () => readUiAsset(indexHtmlPath));

  for (const [route, [filePath, contentType]] of Object.entries(STATIC_ASSETS)) {
    app.api(
      route,
      () => new Response(readUiAsset(filePath), { contentType, headers: NO_STORE_HEADERS }),
      'GET',
    );
  }

  app.api('/api/stats', async (data) => {
    const mode = data.mode === 'latest' ? 'latest' : 'auto';
    const rawConvId = typeof data.conversationId === 'string' && UUID_RE.test(data.conversationId)
      ? data.conversationId
      : (mode === 'auto' && UUID_RE.test(app.config?.conversationId || '') ? app.config.conversationId : '');
    const explicitConvId = rawConvId;
    const assetKey = getAssetKey();

    const appDataRoots = resolveAllAppDataDirs(appDataDir);
    const conversations = listConversations(appDataRoots);
    const forceQuota = data.refreshQuota === '1';
    const includeQuota = data.includeQuota !== '0';
    let accountQuota;
    if (forceQuota || includeQuota) {
      accountQuota = await getUserStatusCached(quotaCache.fetchedAtMs === 0 || forceQuota, forceQuota);
    } else {
      ensureLsModelCatalogWarm();
      accountQuota = quotaCache.fetchedAtMs > 0
        ? quotaCache.data
        : { available: false, deferred: true, reason: 'deferred', ttlMs: QUOTA_TTL_MS };
    }

    if (!conversations.length) {
      return { found: false, bootId: BOOT_ID, assetKey, conversations: [], accountQuota, serverTimeMs: Date.now() };
    }

    const graph = getConversationGraph(conversations, explicitConvId);
    const lsSummaries = (!explicitConvId || mode === 'latest')
      ? await getCascadeSummariesCached(600)
      : undefined;

    const target = pickTargetConversation({
      mode,
      explicitConvId,
      conversations,
      graph,
      lsSummaries,
      prevAutoTargetId: lastAutoTargetId,
    });
    if (!explicitConvId && target?.id) {
      lastAutoTargetId = target.id;
    }

    const liveOverlay = await fetchLiveActiveStep(target.id, lsSummaries);
    const sessionInfoFull = buildSessionInfo(target.id, graph);
    const { childKeys, ...sessionInfo } = sessionInfoFull;
    const accountHistory = buildAccountHistory(graph);
    if (!graph.indexing && accountHistory.totalCalls > 0) {
      schedulePostCallQuotaSample(`${accountHistory.totalCalls}:${accountHistory.totalCostUSD.toFixed(5)}`);
    }

    const nowMs = Date.now();
    const sortedRecent = [...conversations].slice(0, 25).sort((a, b) => {
      const effB = conversationEffectiveMs(b, graph, lsSummaries, nowMs);
      const effA = conversationEffectiveMs(a, graph, lsSummaries, nowMs);
      return (effB - effA) || (b.updatedMs - a.updatedMs);
    });
    const recentList = sortedRecent.slice(0, 15).map((c) => {
      const s = graph.byId.get(c.id);
      const link = graph.parentLinks.get(c.id);
      const kind = link ? link.kind : (s?.trajectoryType === 22 ? 'side_question' : 'main');
      const effMs = conversationEffectiveMs(c, graph, lsSummaries, nowMs);
      return {
        id: c.id,
        updatedMs: effMs || c.updatedMs,
        title: graph.sqTitleOverrides.get(c.id) || s?.title || '',
        kind,
        source: s?.source || c.source || 'app',
        parentId: link?.parentId || '',
        childCount: (graph.childrenByParent.get(c.id) || []).length,
        costUSD: s?.costUSD || 0,
      };
    });

    const histSig = `${accountHistory.totalCalls}:${accountHistory.totalCostUSD.toFixed(5)}:${getBgSummaryWarmSeq()}`;
    const liveSig = liveOverlay?.sig || '';
    const quotaSig = accountQuota?.deferred
      ? `${quotaCache.updatedSeq}:d`
      : `${quotaCache.updatedSeq}:${quotaCache.fetchedAtMs}`;
    const etag = `${mode}|${target.id}|${target.key}|${target.annoKey}|${childKeys}|${recentList[0]?.id || ''}|${quotaSig}|${histSig}|${liveSig}|${getLsModelCatalogVersion()}`;
    if (data.etag && data.etag === etag) {
      return { unchanged: true, etag, bootId: BOOT_ID, assetKey, serverTimeMs: Date.now() };
    }

    const paths = resolveTranscriptPaths(target.appDataDir || appDataDir, target.id, appDataRoots);
    try {
      const cachedTelemetry = getTelemetryCached(target, conversations);
      const telemetry = toLightTelemetryPayload(cachedTelemetry.telemetry);
      if (liveOverlay?.liveStep) {
        let lsStep = liveOverlay.liveStep;
        if (lsStep.syntheticFallback && telemetry.pendingCompact) {
          lsStep = {
            ...lsStep,
            stepType: 23,
            statusName: 'COMPACTING',
            createdAtMs: telemetry.pendingCompact.startedAtMs || telemetry.pendingCompact.createdAtMs || lsStep.createdAtMs,
          };
        }
        const latestTurn = telemetry.turns?.length ? telemetry.turns[telemetry.turns.length - 1] : null;
        const fallbackModel = telemetry.currentModel || telemetry.latest || null;
        const resolvedModel = (lsStep.modelDisplay || lsStep.model)
          ? lsStep
          : {
              model: fallbackModel?.model || '',
              modelId: fallbackModel?.modelId || '',
              modelDisplay: fallbackModel?.modelDisplay || '',
            };
        telemetry.activeStep = {
          ...lsStep,
          turnIndex: latestTurn?.turnIndex || null,
          model: resolvedModel.model,
          modelId: resolvedModel.modelId,
          modelDisplay: resolvedModel.modelDisplay,
        };
        if (resolvedModel.modelDisplay || resolvedModel.model) {
          telemetry.currentModel = {
            model: resolvedModel.model,
            modelId: resolvedModel.modelId,
            modelDisplay: resolvedModel.modelDisplay,
            isActive: true,
            stepType: lsStep.stepType,
            toolName: lsStep.toolName,
            statusName: lsStep.statusName,
          };
        }
      } else if (liveOverlay?.available) {
        telemetry.activeStep = null;
        if (telemetry.currentModel?.isActive) {
          telemetry.currentModel = telemetry.latest
            ? {
                model: telemetry.latest.model,
                modelId: telemetry.latest.modelId,
                modelDisplay: telemetry.latest.modelDisplay,
                isActive: false,
                stepType: null,
                toolName: '',
              }
            : null;
        }
      }
      const fittedQuota = attachQuotaBudgetEstimates(accountQuota, graph);
      const decoratedTelemetry = attachTelemetryQuotaPredictions(telemetry, fittedQuota);
      const enrichedGraph = attachGraphQuotaSummaries({
        conversations: recentList,
        sessionInfo,
        graph,
        accountQuota: fittedQuota,
      });
      return {
        found: true,
        etag,
        bootId: BOOT_ID,
        assetKey,
        mode,
        conversationId: target.id,
        dbPath: target.dbPath,
        ...paths,
        serverTimeMs: Date.now(),
        conversations: enrichedGraph.conversations,
        sessionInfo: enrichedGraph.sessionInfo,
        accountHistory,
        accountQuota: fittedQuota,
        ...decoratedTelemetry,
      };
    } catch (err) {
      return {
        found: false,
        bootId: BOOT_ID,
        assetKey,
        error: err.message,
        conversationId: target.id,
        dbPath: target.dbPath,
        ...paths,
        conversations: recentList,
        sessionInfo,
        accountHistory,
        accountQuota,
        serverTimeMs: Date.now(),
      };
    }
  }, 'GET');

  app.api('/api/call-detail', async (data) => {
    const convId = typeof data.conversationId === 'string' && UUID_RE.test(data.conversationId)
      ? data.conversationId
      : '';
    const kind = data.kind === 'compact' || data.kind === 'turn' ? data.kind : 'inv';
    const idNum = Number(data.id);
    if (!convId || !Number.isFinite(idNum)) {
      return { found: false, reason: 'invalid_params' };
    }
    const conversations = listConversations(resolveAllAppDataDirs(appDataDir));
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) {
      return { found: false, reason: 'not_found' };
    }
    try {
      const cached = getTelemetryCached(conv, conversations);
      const map = cached.detailIndex?.[kind];
      const detail = map ? map.get(idNum) || null : null;
      if (!detail) {
        return { found: false, reason: 'missing_item' };
      }
      return { found: true, conversationId: convId, kind, id: idNum, detail };
    } catch (err) {
      return { found: false, reason: err?.message || 'read_error' };
    }
  }, 'GET');

  app.run();
  startSelfWatch();
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return process.argv[1] === __filename;
  }
}

if (isEntrypoint()) {
  startServer();
}

export {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  buildAccountHistory,
  clipLiveStreamText,
  clipText,
  computeBaseReferenceUSD,
  computeCallCost,
  computeSummaryQuotaUsage,
  conversationEffectiveMs,
  extractLiveStepFromTrajectory,
  getConversationGraph,
  getPricingVectorSig,
  ingestQuotaObservation,
  isCascadeStatusActive,
  isCompactPromptText,
  isCompactUserInputLs,
  isLoopbackHost,
  iterFields,
  listConversations,
  mergeIntervalDurationSec,
  normalizeLsBaseUrl,
  parseAnnotationPbtxt,
  parseContextBreakdown,
  parseGenRow,
  parsePlannerPayload,
  parseStepMetadata,
  parseUserPromptPayload,
  pickTargetConversation,
  predictCallQuota,
  readDurationSec,
  readTelemetry,
  readVarint,
  reconcilePoolSamplesPricing,
  resolveAllAppDataDirs,
  resolveLsGeneratorModel,
  resolveModelPricing,
  solvePoolFitModel,
  summarizeConversationDb,
  unescapePbtxtString,
};
