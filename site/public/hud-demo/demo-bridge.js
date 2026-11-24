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

  var fixtures = {
    en: window.__AGY_HUD_BUILD_FIXTURE__('en', bootNowMs),
    zh: window.__AGY_HUD_BUILD_FIXTURE__('zh', bootNowMs),
  };

  function getFx() {
    return fixtures[currentLang] || fixtures.en;
  }

  function buildWorkerSnapshot(baseSnap, workerId) {
    var children = (baseSnap.sessionInfo && baseSnap.sessionInfo.childSessions) || [];
    var child = children.find(function (c) {
      return c.id === workerId;
    });
    if (!child || !child.swarm) return baseSnap;

    var swarm = baseSnap.sessionInfo.swarm;
    var sliceCount = Math.max(8, Math.min(24, child.calls || 14));
    var invs = (baseSnap.invocations || []).slice(-sliceCount);
    var latest = invs[invs.length - 1] || baseSnap.latest;
    var workerModel = child.swarm.model || 'gemini-4-carbon';
    var isFlash = workerModel.indexOf('flash') >= 0;

    return Object.assign({}, baseSnap, {
      conversationId: child.id,
      etag: 'demo-worker-' + child.swarm.rosterName + '-' + currentLang + '-' + etagCounter,
      serverTimeMs: Date.now(),
      currentModel: {
        model: isFlash ? 'GEMINI_3_8_FLASH' : 'GEMINI_4_CARBON',
        modelId: workerModel,
        modelDisplay: isFlash ? 'Gemini 3.8 Flash' : 'Gemini 4 Carbon',
        isActive: child.swarm.swarmState === 'working',
        stepType: 15,
        toolName: '',
      },
      latest: latest,
      latestSustained: latest,
      invocations: invs,
      summary: Object.assign({}, baseSnap.summary, {
        count: child.calls || invs.length,
        totalOutput: child.outputTokens || baseSnap.summary.totalOutput,
        totalCostUSD: child.costUSD || baseSnap.summary.totalCostUSD,
        sessionQuota: child.quotaUsage || baseSnap.summary.sessionQuota,
      }),
      sessionInfo: {
        id: child.id,
        title: child.title,
        kind: 'subagent',
        parentSession: {
          id: baseSnap.conversationId,
          title: swarm.swarmTitle,
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
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  function demoFetch(input) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '/';
    var url = new URL(rawUrl, location.origin);
    var fx = getFx();

    if (url.pathname.endsWith('/api/stats')) {
      var reqConv = url.searchParams.get('conv') || '';
      var snap =
        reqConv && reqConv !== fx.snapshot.conversationId
          ? buildWorkerSnapshot(fx.snapshot, reqConv)
          : Object.assign({}, fx.snapshot, {
              serverTimeMs: Date.now(),
              etag: 'demo-coord-' + currentLang + '-' + etagCounter,
            });
      return Promise.resolve(jsonResponse(snap));
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
    }
  });

  // Notify parent website as soon as bridge is installed
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'agy-demo-ready' }, '*');
  }
})();
