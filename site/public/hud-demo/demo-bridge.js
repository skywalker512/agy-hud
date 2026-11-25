/* AGY-HUD Website Live Demo Bridge
 *
 * Mounts the 100% real compiled `web/` HUD inside the launch website without
 * duplicating any UI code. Intercepts the 5 read-only `/api/*` sidecar endpoints
 * via `window.sidecar.fetch` and relays Antigravity host CSS variables directly
 * into `:root` so `useThemeSync.ts` adapts live to every Antigravity theme.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var initialLang = params.get('lang') === 'zh' ? 'zh' : 'en';
  var bootNowMs = Date.now();
  var currentLang = initialLang;
  var appliedHostVarKeys = [];
  var etagCounter = 1;
  var liveTtftSim = null; // { startMs, firstTokenAtMs, endAtMs }
  var liveTtftTimers = [];

  function clearLiveTtftTimers() {
    for (var i = 0; i < liveTtftTimers.length; i++) {
      clearTimeout(liveTtftTimers[i]);
    }
    liveTtftTimers = [];
  }

  function nudgeHudPoll() {
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } catch (_) {
      /* ignore */
    }
  }

  function startLiveTtftSim() {
    clearLiveTtftTimers();
    var now = Date.now();
    // 5.6s waiting for first token (climbs calm -> amber -> red), then 4.6s live streaming
    liveTtftSim = {
      startMs: now,
      firstTokenAtMs: now + 5600,
      endAtMs: now + 10200,
    };
    etagCounter += 1;
    nudgeHudPoll();
    liveTtftTimers.push(
      setTimeout(function () {
        etagCounter += 1;
        nudgeHudPoll();
      }, 5620),
    );
    liveTtftTimers.push(
      setTimeout(function () {
        liveTtftSim = null;
        etagCounter += 1;
        nudgeHudPoll();
      }, 10250),
    );
  }

  function getSimulatedActiveStep(isZh) {
    if (!liveTtftSim) return null;
    var now = Date.now();
    if (now >= liveTtftSim.endAtMs) {
      liveTtftSim = null;
      return null;
    }
    var isStreaming = now >= liveTtftSim.firstTokenAtMs;
    return {
      stepIdx: 134,
      stepType: 15,
      status: 8,
      statusName: isStreaming ? 'GENERATING' : 'WAITING',
      model: 'gemini-pro-orchestrator-neon',
      modelId: 'gemini-pro-orchestrator-neon',
      modelDisplay: 'Orchestrator (Neon)',
      createdAtMs: liveTtftSim.startMs,
      streamStartMs: isStreaming ? liveTtftSim.firstTokenAtMs : 0,
      thinkingPreview: isStreaming
        ? (isZh
            ? '首字在 5.6s 到达，已锁定 TTFT 并切入高速流式输出。'
            : 'First token locked at 5.6s; now streaming smoothly.')
        : '',
      replyPreview: isStreaming
        ? (isZh
            ? '已定位配额校准回归边界，正在流式输出修复补丁与回归测试用例…'
            : 'Located quota solver edge case; streaming patch and regression test assertions…')
        : '',
      toolCalls: [],
    };
  }

  // Always start the website demo cleanly on the requested language & Live tab
  try {
    localStorage.setItem('agy_hud_lang', initialLang);
    localStorage.setItem('agy_hud_lang_explicit', '1');
    if (!sessionStorage.getItem('agy_hud_demo_booted')) {
      localStorage.setItem('agy_hud_tab', 'live');
      sessionStorage.setItem('agy_hud_demo_booted', '1');
    }
  } catch (_) {
    /* ignore */
  }

  // Lazy-build language fixtures on demand so first paint only computes the active locale
  var fixtures = {};

  function getFx(lang) {
    var key = lang || currentLang;
    if (!fixtures[key]) {
      fixtures[key] = window.__AGY_HUD_BUILD_FIXTURE__(key, bootNowMs);
    }
    return fixtures[key];
  }

  var WORKER_MODEL_META = {
    'gemini-pro-orchestrator-neon': { model: 'gemini-pro-orchestrator-neon', modelId: 'gemini-pro-orchestrator-neon', modelDisplay: 'Orchestrator (Neon)', pricingKey: 'gemini-4-neon', pool: 'gemini', baseTps: 112, baseTtft: 1.44 },
    'gemini-flash-worker-agy': { model: 'gemini-flash-worker-agy', modelId: 'gemini-flash-worker-agy', modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)', pricingKey: 'gemini-4-hydrogen', pool: 'gemini', baseTps: 154, baseTtft: 0.92 },
    'gemini-4-neon': { model: 'gemini-4-neon', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon (High)', pricingKey: 'gemini-4-neon', pool: 'gemini', baseTps: 112, baseTtft: 1.48 },
    'gemini-4-hydrogen': { model: 'gemini-4-hydrogen', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen (High)', pricingKey: 'gemini-4-hydrogen', pool: 'gemini', baseTps: 146, baseTtft: 1.12 },
    'gemini-4-carbon': { model: 'gemini-4-carbon', modelId: 'gemini-4-carbon', modelDisplay: 'Gemini 4 Carbon (High)', pricingKey: 'gemini-4-pro-preview', pool: 'gemini', baseTps: 94, baseTtft: 1.85 },
    'claude-opus-5-5-high': { model: 'claude-opus-5-5-high', modelId: 'claude-opus-5-5-high', modelDisplay: 'Claude Opus 5.5 (High)', pricingKey: 'claude-opus-5-5', pool: 'claude_gpt', baseTps: 116, baseTtft: 2.15 },
  };

  function buildWorkerSnapshot(baseSnap, workerId) {
    var children = (baseSnap.sessionInfo && baseSnap.sessionInfo.childSessions) || [];
    var child = children.find(function (c) {
      return c.id === workerId;
    });
    if (!child || !child.swarm) return baseSnap;

    var swarm = baseSnap.sessionInfo.swarm;
    var sliceCount = Math.max(8, Math.min(34, child.calls || 16));
    var rawInvs = (baseSnap.invocations || []).slice(-sliceCount);
    var mKey = child.swarm.model || 'gemini-4-neon';
    var meta = WORKER_MODEL_META[mKey] || WORKER_MODEL_META['gemini-4-neon'];
    var scaleCost = rawInvs.length > 0 && child.costUSD > 0
      ? child.costUSD / rawInvs.reduce(function (s, r) { return s + (r.costUSD || 0.04); }, 0)
      : 1;
    var scaleOut = rawInvs.length > 0 && child.outputTokens > 0
      ? child.outputTokens / rawInvs.reduce(function (s, r) { return s + (r.outputTokens || 400); }, 0)
      : 1;

    var invs = rawInvs.map(function (r, idx) {
      var outTok = Math.max(60, Math.round((r.outputTokens || 400) * scaleOut));
      var tps = Math.max(52, Math.round((meta.baseTps + ((idx * 17) % 29) - 14) * 10) / 10);
      var ttft = Math.max(0.75, Math.round((meta.baseTtft + (((idx * 13) % 15) - 7) * 0.08) * 100) / 100);
      var genSec = Math.round((outTok / tps) * 100) / 100;
      var cost = Math.round((r.costUSD || 0.04) * scaleCost * 10000) / 10000;
      var q5 = meta.pool === 'claude_gpt' ? Math.round(cost * 4.83 * 1000) / 1000 : Math.round((cost / 6.0) * 1000) / 1000;
      return Object.assign({}, r, {
        idx: idx,
        stepIdx: idx * 2 + 2,
        turnIndex: Math.floor(idx / 4) + 1,
        model: meta.model,
        modelId: meta.modelId,
        modelDisplay: meta.modelDisplay,
        pricingKey: meta.pricingKey,
        quotaPool: meta.pool,
        outputTokens: outTok,
        thinkingTokens: meta.pool === 'claude_gpt' ? 0 : Math.round(outTok * 0.35),
        candidateTokens: meta.pool === 'claude_gpt' ? outTok : Math.round(outTok * 0.65),
        ttftSec: ttft,
        genSec: genSec,
        totalSec: Math.round((ttft + genSec) * 100) / 100,
        genTps: tps,
        e2eTps: Math.round((outTok / Math.max(0.5, ttft + genSec)) * 10) / 10,
        costUSD: cost,
        quotaPct5h: q5,
        quotaPct7d: Math.round((q5 / (meta.pool === 'claude_gpt' ? 2 : 4)) * 1000) / 1000,
      });
    });
    var latest = invs[invs.length - 1] || baseSnap.latest;
    var avgGenTps = invs.length ? invs.reduce(function (s, r) { return s + r.genTps; }, 0) / invs.length : meta.baseTps;
    var avgTtftSec = invs.length ? invs.reduce(function (s, r) { return s + r.ttftSec; }, 0) / invs.length : meta.baseTtft;
    var peakGenTps = invs.reduce(function (m, r) { return Math.max(m, r.genTps); }, meta.baseTps);

    return Object.assign({}, baseSnap, {
      conversationId: child.id,
      etag: 'demo-worker-' + child.swarm.rosterName + '-' + currentLang + '-' + etagCounter,
      serverTimeMs: Date.now(),
      currentModel: {
        model: meta.model,
        modelId: meta.modelId,
        modelDisplay: meta.modelDisplay,
        isActive: child.swarm.swarmState === 'working',
        stepType: 15,
        toolName: '',
      },
      latest: latest,
      latestSustained: latest,
      invocations: invs,
      turns: [
        {
          turnIndex: 1,
          stepIdx: 1,
          timestampMs: invs[0] ? invs[0].timestampMs - 2000 : Date.now() - 120_000,
          promptPreview: child.swarm.taskTitle || child.title,
          promptFull: child.swarm.taskTitle || child.title,
          isCompact: false,
          compactCount: 0,
          callCount: invs.length,
          outputTokens: child.outputTokens || invs.reduce(function (s, r) { return s + r.outputTokens; }, 0),
          totalSec: Math.round(invs.reduce(function (s, r) { return s + r.totalSec; }, 0) * 10) / 10,
        },
      ],
      summary: Object.assign({}, baseSnap.summary, {
        count: invs.length,
        userTurns: 1,
        totalOutput: child.outputTokens || baseSnap.summary.totalOutput,
        totalCostUSD: child.costUSD || baseSnap.summary.totalCostUSD,
        totalSavedUSD: child.savedUSD || baseSnap.summary.totalSavedUSD,
        avgGenTps: Math.round(avgGenTps * 10) / 10,
        avgTtftSec: Math.round(avgTtftSec * 100) / 100,
        peakGenTps: Math.round(peakGenTps * 10) / 10,
        pricedCount: invs.length,
        unpricedCount: 0,
        sessionQuota: child.quotaUsage || baseSnap.summary.sessionQuota,
      }),
      sessionInfo: {
        id: child.id,
        title: '@' + child.swarm.rosterName + ' · ' + (child.swarm.taskTitle || child.title),
        kind: 'subagent',
        subagentType: 'swarm_worker',
        quotaUsage: child.quotaUsage || baseSnap.summary.sessionQuota,
        parentSession: {
          id: baseSnap.conversationId,
          title: swarm.swarmTitle || baseSnap.sessionInfo.title,
          quotaUsage: baseSnap.summary.sessionQuota,
        },
        childSessions: [],
        swarm: Object.assign({}, swarm, {
          isCoordinatorView: false,
          selfMember: child.swarm,
        }),
      },
    });
  }

  function jsonResponse(data, status) {
    var code = status || 200;
    return {
      ok: code >= 200 && code < 300,
      status: code,
      headers: {
        get: function (name) {
          return String(name || '').toLowerCase() === 'content-type'
            ? 'application/json; charset=utf-8'
            : null;
        },
      },
      json: function () {
        return Promise.resolve(data);
      },
      text: function () {
        return Promise.resolve(JSON.stringify(data));
      },
    };
  }

  function demoFetch(input) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '/';
    var url = new URL(rawUrl, location.origin);
    var fx = getFx();

    if (url.pathname.endsWith('/api/stats')) {
      var reqConv = url.searchParams.get('conversationId') || url.searchParams.get('conv') || '';
      var reqEtag = url.searchParams.get('etag') || '';
      var isSwitchingWorker = Boolean(reqConv && reqConv !== fx.snapshot.conversationId);
      var simActive = isSwitchingWorker ? null : getSimulatedActiveStep(currentLang === 'zh');
      if (!isSwitchingWorker) {
        var coordEtag =
          'demo-coord-' +
          currentLang +
          '-' +
          etagCounter +
          (simActive ? (simActive.streamStartMs > 0 ? '-stream' : '-wait') : '');
        if (reqEtag && reqEtag === coordEtag) {
          return Promise.resolve(
            jsonResponse({ unchanged: true, etag: coordEtag, serverTimeMs: Date.now() }),
          );
        }
        var snap = Object.assign({}, fx.snapshot, {
          serverTimeMs: Date.now(),
          activeStep: simActive,
          currentModel: simActive
            ? Object.assign({}, fx.snapshot.currentModel, {
                model: simActive.model,
                modelId: simActive.modelId,
                modelDisplay: simActive.modelDisplay,
                isActive: true,
                stepType: 15,
                statusName: simActive.statusName,
              })
            : fx.snapshot.currentModel,
          etag: coordEtag,
        });
        return Promise.resolve(jsonResponse(snap));
      }

      var workerSnap = buildWorkerSnapshot(fx.snapshot, reqConv);
      if (reqEtag && reqEtag === workerSnap.etag) {
        return Promise.resolve(
          jsonResponse({ unchanged: true, etag: workerSnap.etag, serverTimeMs: Date.now() }),
        );
      }
      if (window.scrollY > 120) {
        setTimeout(function () {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 60);
      }
      return Promise.resolve(jsonResponse(workerSnap));
    }

    if (url.pathname.endsWith('/api/call-detail')) {
      var kind = url.searchParams.get('kind') || 'inv';
      var id = Number(url.searchParams.get('id') || 0);
      var key = kind + ':' + id;
      var detail =
        (fx.callDetails && (fx.callDetails[key] || fx.callDetails['inv:63'])) || {
          thinking: '',
          reply: '',
          tools: [],
          raw: '{}',
        };
      return Promise.resolve(jsonResponse({ ok: true, found: true, detail: detail }));
    }

    if (url.pathname.endsWith('/api/locale')) {
      return Promise.resolve(
        jsonResponse({ ok: true, lang: currentLang, source: 'demo', confidence: 1 }),
      );
    }

    if (url.pathname.endsWith('/api/update-status')) {
      return Promise.resolve(jsonResponse(fx.updateStatus));
    }

    if (url.pathname.endsWith('/api/refresh-quota')) {
      return Promise.resolve(jsonResponse({ ok: true, refreshed: true }));
    }

    if (url.pathname.endsWith('/api/gemini-pulse')) {
      return Promise.resolve(jsonResponse(fx.snapshot.geminiPulse || { enabled: true, available: false, models: [] }));
    }

    return Promise.resolve(jsonResponse({ ok: false, error: 'demo_unknown_route' }, 404));
  }

  window.sidecar = {
    conversationId: getFx().snapshot.conversationId,
    fetch: demoFetch,
  };

  function applyHostCssVariables(cssVars) {
    var rootStyle = document.documentElement.style;
    for (var i = 0; i < appliedHostVarKeys.length; i++) {
      rootStyle.removeProperty(appliedHostVarKeys[i]);
    }
    appliedHostVarKeys = [];
    if (!cssVars || typeof cssVars !== 'object') return;
    var keys = Object.keys(cssVars);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      var v = cssVars[k];
      if (typeof v === 'string' && v) {
        rootStyle.setProperty(k, v);
        appliedHostVarKeys.push(k);
      }
    }
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'theme-change' && data.payload) {
      applyHostCssVariables(data.payload.cssVariables);
      if (data.payload.contrast) {
        document.documentElement.style.setProperty('--contrast', String(data.payload.contrast));
      } else {
        document.documentElement.style.removeProperty('--contrast');
      }
    } else if (data.type === 'agy-demo-locale') {
      if (data.lang === 'en' || data.lang === 'zh') {
        currentLang = data.lang;
        etagCounter += 1;
        try {
          localStorage.setItem('agy_hud_lang', currentLang);
        } catch (_) {
          /* ignore */
        }
      }
    } else if (data.type === 'agy-demo-navigate') {
      // Allow website tour chips to drive the real embedded HUD tabs & interactive views
      var tabOrder = { live: 0, calls: 1, account: 2 };
      var targetIdx = tabOrder[data.tab];
      if (typeof targetIdx === 'number') {
        var tabBtns = document.querySelectorAll('.tab-bar [role="tab"], nav [role="tab"]');
        if (tabBtns[targetIdx]) tabBtns[targetIdx].click();
      }
      var action = data.action || '';
      if (action) {
        var runAction = function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
          if (action === 'global-trend') {
            var gBtn = btns.find(function (b) {
              var txt = (b.textContent || '').trim();
              return txt.indexOf('大盘折线') >= 0 || txt.indexOf('Global') >= 0;
            });
            if (gBtn) {
              gBtn.click();
              gBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else if (action === 'arena') {
            var aBtn = btns.find(function (b) {
              var txt = (b.textContent || '').trim();
              return txt.indexOf('斗蛐蛐') >= 0 || txt.indexOf('Arena PK') >= 0;
            });
            if (aBtn) {
              aBtn.click();
              aBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else if (action === 'wrapped') {
            var sBtn = btns.find(function (b) {
              var txt = (b.textContent || '').trim();
              return txt === '战报' || txt === 'Share';
            });
            if (sBtn) {
              sBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              sBtn.click();
            }
          } else if (action === 'live-top' || action === 'calls-top' || action === 'quota') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (action === 'simulate-ttft') {
            var backToCoord = btns.find(function (b) {
              var txt = (b.textContent || '').trim();
              return txt.indexOf('@coordinator') >= 0;
            });
            if (backToCoord) backToCoord.click();
            startLiveTtftSim();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (action === 'swarm') {
            // If currently inside a worker session, click the @coordinator back button first
            var backCoord = btns.find(function (b) {
              var txt = (b.textContent || '').trim();
              return txt.indexOf('@coordinator') >= 0;
            });
            if (backCoord) {
              backCoord.click();
              setTimeout(function () {
                var swCard = document.getElementById('child-sessions-card');
                if (swCard) swCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 220);
              return;
            }
            var swCard = document.getElementById('child-sessions-card');
            if (swCard) {
              swCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } else if (action === 'cache-ttl') {
            var sections = Array.prototype.slice.call(document.querySelectorAll('section'));
            var ttlSec = sections.find(function (sec) {
              var txt = (sec.textContent || '').trim();
              return (
                txt.indexOf('缓存存活曲线') >= 0 ||
                txt.indexOf('CACHE SURVIVAL') >= 0 ||
                txt.indexOf('Cache TTL') >= 0 ||
                txt.indexOf('缓存 TTL') >= 0
              );
            });
            if (ttlSec) {
              var expBtn = ttlSec.querySelector('button[aria-expanded="false"]');
              if (expBtn) expBtn.click();
              ttlSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        };
        setTimeout(runAction, 140);
      }
    }
  });

  // Notify parent website as soon as bridge is installed
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'agy-demo-ready' }, '*');
  }
})();
