import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  getTranslations,
  hasUserLangPreference,
  refineLocaleFromServer,
  resolveInitialLang,
  saveUserLangPreference,
  shouldRefineLocaleFromServer,
  type Translations,
} from '../i18n';
import type {
  CallDetailPayload,
  CallDetailResponse,
  ChartMetric,
  ConvMode,
  HudTab,
  Lang,
  StatsSnapshot,
} from '../types/telemetry';

const POLL_ACTIVE_MS = 500;
const POLL_IDLE_MS = 1500;

function readStorage<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function getPaneConv(): string {
  const params = new URLSearchParams(location.search);
  return window.sidecar?.conversationId || params.get('conversationId') || '';
}

function getSidecarFetch(): typeof fetch {
  return window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
}

export interface HudStore {
  lang: Lang;
  t: Translations;
  tab: HudTab;
  metric: ChartMetric;
  mode: ConvMode;
  selectedConv: string;
  snap: StatsSnapshot | null;
  retrying: boolean;
  nowMs: number;
  expandedRows: Set<number>;
  expandedCompacts: Set<number>;
  collapsedTurns: Set<number>;
  compactOnly: boolean;
  showAllHistory: boolean;
  recentOpen: boolean;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  toggleLang: () => void;
  switchTab: (next: HudTab) => void;
  setMetric: (m: ChartMetric) => void;
  selectConversationOption: (val: string) => void;
  jumpToConversation: (convId: string) => void;
  refreshQuota: () => void;
  toggleRecentOpen: () => void;
  toggleCompactOnly: () => void;
  toggleShowAllHistory: () => void;
  toggleTurnCollapsed: (turnIdx: number) => void;
  toggleFoldAllTurns: () => void;
  toggleInvocationExpanded: (idx: number, hasDetail: boolean) => void;
  toggleCompactExpanded: (stepIdx: number, hasDetail: boolean) => void;
  loadCallDetail: (convId: string, kind: 'inv' | 'compact' | 'turn', id: number) => Promise<CallDetailPayload | null>;
}

export function useHudStore(): HudStore {
  const [lang, setLang] = useState<Lang>(() => resolveInitialLang());
  const [tab, setTabState] = useState<HudTab>(() => readStorage('agy_hud_tab', ['live', 'calls', 'account'] as const, 'live'));
  const [metric, setMetricState] = useState<ChartMetric>(() =>
    readStorage('agy_hud_metric', ['tps', 'ttft', 'out', 'cache', 'ctx', 'quota'] as const, 'tps'),
  );
  const [mode, setMode] = useState<ConvMode>('auto');
  const [selectedConv, setSelectedConv] = useState<string>('');
  const [snap, setSnap] = useState<StatsSnapshot | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [clockSkewMs, setClockSkewMs] = useState<number>(0);
  const [tickNow, setTickNow] = useState<number>(() => Date.now());

  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [expandedCompacts, setExpandedCompacts] = useState<Set<number>>(() => new Set());
  const [collapsedTurns, setCollapsedTurns] = useState<Set<number>>(() => new Set());
  const [compactOnly, setCompactOnly] = useState<boolean>(false);
  const [showAllHistory, setShowAllHistory] = useState<boolean>(false);
  const [recentOpen, setRecentOpen] = useState<boolean>(false);

  const [detailCache, setDetailCache] = useState<Map<string, CallDetailPayload>>(() => new Map());
  const [detailLoading, setDetailLoading] = useState<Set<string>>(() => new Set());

  const etagRef = useRef<string>('');
  const bootIdRef = useRef<string>('');
  const assetKeyRef = useRef<string>('');
  const activeConvIdRef = useRef<string>('');
  const refreshQuotaOnceRef = useRef<boolean>(false);
  const pollSeqRef = useRef<number>(0);
  const pollAbortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailInFlightRef = useRef<Set<string>>(new Set());
  const detailCacheRef = useRef<Map<string, CallDetailPayload>>(detailCache);
  detailCacheRef.current = detailCache;

  const modeRef = useRef<ConvMode>(mode);
  modeRef.current = mode;
  const selectedConvRef = useRef<string>(selectedConv);
  selectedConvRef.current = selectedConv;
  const tabRef = useRef<HudTab>(tab);
  tabRef.current = tab;
  const snapRef = useRef<StatsSnapshot | null>(snap);
  snapRef.current = snap;

  const t = useMemo(() => getTranslations(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  useEffect(() => {
    if (!shouldRefineLocaleFromServer()) return;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    void refineLocaleFromServer(getSidecarFetch(), ac?.signal).then((refined) => {
      if (refined && !hasUserLangPreference()) {
        setLang((prev) => (prev === refined ? prev : refined));
      }
    });
    return () => {
      ac?.abort();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('calls-log-open', tab === 'calls');
  }, [tab]);

  const loadCallDetail = useCallback(
    async (convId: string, kind: 'inv' | 'compact' | 'turn', id: number): Promise<CallDetailPayload | null> => {
      if (!convId || !Number.isFinite(id)) return null;
      const cacheKey = `${convId}:${kind}:${id}`;
      const existing = detailCacheRef.current.get(cacheKey);
      if (existing) return existing;
      if (detailInFlightRef.current.has(cacheKey)) return null;

      detailInFlightRef.current.add(cacheKey);
      setDetailLoading((prev) => {
        const next = new Set(prev);
        next.add(cacheKey);
        return next;
      });

      try {
        const qs = new URLSearchParams({
          conversationId: convId,
          kind,
          id: String(id),
        });
        const fetcher = getSidecarFetch();
        const res = await fetcher(`/api/call-detail?${qs.toString()}`, { method: 'GET' });
        if (!res.ok) return null;
        const json = (await res.json()) as CallDetailResponse;
        const detail = json?.found ? json.detail || null : null;
        if (detail) {
          setDetailCache((prev) => {
            const next = new Map(prev);
            if (next.size >= 200) {
              const oldest = next.keys().next().value;
              if (oldest) next.delete(oldest);
            }
            next.set(cacheKey, detail);
            return next;
          });
        }
        return detail;
      } catch {
        return null;
      } finally {
        detailInFlightRef.current.delete(cacheKey);
        setDetailLoading((prev) => {
          const next = new Set(prev);
          next.delete(cacheKey);
          return next;
        });
      }
    },
    [],
  );

  const poll = useCallback(async () => {
    if (document?.hidden) return;
    const seq = ++pollSeqRef.current;
    if (pollAbortRef.current) {
      try {
        pollAbortRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    pollAbortRef.current = ac;
    const usedRefreshQuota = refreshQuotaOnceRef.current;

    try {
      const curMode = modeRef.current;
      const conv = curMode === 'custom'
        ? selectedConvRef.current
        : curMode === 'auto'
          ? getPaneConv()
          : '';
      const apiMode = curMode === 'latest' ? 'latest' : 'auto';
      const includeQuota = Boolean(usedRefreshQuota || tabRef.current === 'account');
      const qs = new URLSearchParams({
        mode: apiMode,
        includeQuota: includeQuota ? '1' : '0',
      });
      if (conv) qs.set('conversationId', conv);
      if (etagRef.current) qs.set('etag', etagRef.current);
      if (usedRefreshQuota) qs.set('refreshQuota', '1');

      const fetcher = getSidecarFetch();
      const res = await fetcher(`/api/stats?${qs.toString()}`, ac ? { method: 'GET', signal: ac.signal } : { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextSnap = (await res.json()) as StatsSnapshot;
      if (seq !== pollSeqRef.current) return;
      if (usedRefreshQuota) refreshQuotaOnceRef.current = false;

      if (nextSnap.bootId) {
        const bootChanged = Boolean(bootIdRef.current && bootIdRef.current !== nextSnap.bootId);
        bootIdRef.current = nextSnap.bootId;
        if (bootChanged) {
          etagRef.current = '';
          setDetailCache(new Map());
          if (nextSnap.unchanged) {
            void poll();
            return;
          }
        }
      }

      if (nextSnap.assetKey) {
        if (assetKeyRef.current && assetKeyRef.current !== nextSnap.assetKey) {
          let allowReload = true;
          try {
            const lastReload = Number(sessionStorage.getItem('agy_hud_last_reload') || 0);
            if (Date.now() - lastReload < 10_000) allowReload = false;
            else sessionStorage.setItem('agy_hud_last_reload', String(Date.now()));
          } catch {
            /* ignore */
          }
          assetKeyRef.current = nextSnap.assetKey;
          if (allowReload) {
            location.reload();
            return;
          }
        }
        assetKeyRef.current = nextSnap.assetKey;
      }

      if (nextSnap.etag) etagRef.current = nextSnap.etag;
      if (nextSnap.serverTimeMs) {
        setClockSkewMs(Date.now() - nextSnap.serverTimeMs);
      }
      setRetrying(false);
      setTickNow(Date.now());

      if (!nextSnap.unchanged) {
        if (nextSnap.conversationId && nextSnap.conversationId !== activeConvIdRef.current) {
          activeConvIdRef.current = nextSnap.conversationId;
          setExpandedRows(new Set());
          setExpandedCompacts(new Set());
          setCollapsedTurns(new Set());
          setCompactOnly(false);
          setShowAllHistory(false);
        }
        snapRef.current = nextSnap;
        setSnap(nextSnap);
      }
    } catch (err: unknown) {
      if (seq !== pollSeqRef.current || (err instanceof Error && err.name === 'AbortError')) return;
      setRetrying(true);
    } finally {
      if (seq === pollSeqRef.current) {
        if (pollAbortRef.current === ac) pollAbortRef.current = null;
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!document?.hidden) {
          const delay = snapRef.current?.activeStep ? POLL_ACTIVE_MS : POLL_IDLE_MS;
          timerRef.current = setTimeout(() => {
            void poll();
          }, delay);
        }
      }
    }
  }, []);

  const triggerImmediatePoll = useCallback((clearEtag = false) => {
    if (clearEtag) etagRef.current = '';
    if (timerRef.current) clearTimeout(timerRef.current);
    void poll();
  }, [poll]);

  useEffect(() => {
    const stopAll = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pollAbortRef.current) {
        try {
          pollAbortRef.current.abort();
        } catch {
          /* ignore */
        }
        pollAbortRef.current = null;
      }
    };

    const onVis = () => {
      if (document.hidden) {
        stopAll();
      } else {
        triggerImmediatePoll(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) {
      void poll();
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stopAll();
    };
  }, [poll, triggerImmediatePoll]);

  const isActiveStep = Boolean(snap?.activeStep);
  useEffect(() => {
    const intervalMs = isActiveStep ? 250 : 1000;
    const id = setInterval(() => {
      if (!document.hidden) setTickNow(Date.now());
    }, intervalMs);
    return () => clearInterval(id);
  }, [isActiveStep]);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next = prev === 'en' ? 'zh' : 'en';
      saveUserLangPreference(next);
      return next;
    });
  }, []);

  const switchTab = useCallback(
    (nextTab: HudTab) => {
      tabRef.current = nextTab;
      setTabState(nextTab);
      try {
        localStorage.setItem('agy_hud_tab', nextTab);
      } catch {
        /* ignore */
      }
      if (nextTab === 'account') {
        const q = snapRef.current?.accountQuota;
        if (!q || q.deferred || !q.available) {
          triggerImmediatePoll(true);
        }
      }
    },
    [triggerImmediatePoll],
  );

  const setMetric = useCallback((m: ChartMetric) => {
    setMetricState(m);
    try {
      localStorage.setItem('agy_hud_metric', m);
    } catch {
      /* ignore */
    }
  }, []);

  const selectConversationOption = useCallback(
    (val: string) => {
      if (val === 'auto') {
        modeRef.current = 'auto';
        selectedConvRef.current = '';
        setMode('auto');
        setSelectedConv('');
      } else if (val === 'latest') {
        modeRef.current = 'latest';
        selectedConvRef.current = '';
        setMode('latest');
        setSelectedConv('');
      } else if (val.startsWith('conv:')) {
        const id = val.slice(5);
        modeRef.current = 'custom';
        selectedConvRef.current = id;
        setMode('custom');
        setSelectedConv(id);
      }
      triggerImmediatePoll(true);
    },
    [triggerImmediatePoll],
  );

  const jumpToConversation = useCallback(
    (convId: string) => {
      if (!convId) return;
      modeRef.current = 'custom';
      selectedConvRef.current = convId;
      setMode('custom');
      setSelectedConv(convId);
      triggerImmediatePoll(true);
    },
    [triggerImmediatePoll],
  );

  const refreshQuota = useCallback(() => {
    refreshQuotaOnceRef.current = true;
    triggerImmediatePoll(true);
  }, [triggerImmediatePoll]);

  const toggleRecentOpen = useCallback(() => {
    setRecentOpen((p) => !p);
  }, []);

  const toggleCompactOnly = useCallback(() => {
    setCompactOnly((p) => !p);
  }, []);

  const toggleShowAllHistory = useCallback(() => {
    setShowAllHistory((p) => !p);
  }, []);

  const toggleTurnCollapsed = useCallback((turnIdx: number) => {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnIdx)) next.delete(turnIdx);
      else next.add(turnIdx);
      return next;
    });
  }, []);

  const toggleFoldAllTurns = useCallback(() => {
    const turns = snapRef.current?.turns || [];
    if (!turns.length) return;
    setCollapsedTurns((prev) => {
      const allFolded = turns.every((u) => prev.has(u.turnIndex));
      if (allFolded) return new Set();
      return new Set(turns.map((u) => u.turnIndex));
    });
  }, []);

  const toggleInvocationExpanded = useCallback(
    (idx: number, hasDetail: boolean) => {
      const convId = snapRef.current?.conversationId || '';
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) {
          next.delete(idx);
        } else {
          next.add(idx);
          if (convId && hasDetail && !detailCacheRef.current.has(`${convId}:inv:${idx}`)) {
            void loadCallDetail(convId, 'inv', idx);
          }
        }
        return next;
      });
    },
    [loadCallDetail],
  );

  const toggleCompactExpanded = useCallback(
    (stepIdx: number, hasDetail: boolean) => {
      const convId = snapRef.current?.conversationId || '';
      setExpandedCompacts((prev) => {
        const next = new Set(prev);
        if (next.has(stepIdx)) {
          next.delete(stepIdx);
        } else {
          next.add(stepIdx);
          if (convId && hasDetail && !detailCacheRef.current.has(`${convId}:compact:${stepIdx}`)) {
            void loadCallDetail(convId, 'compact', stepIdx);
          }
        }
        return next;
      });
    },
    [loadCallDetail],
  );

  return {
    lang,
    t,
    tab,
    metric,
    mode,
    selectedConv,
    snap,
    retrying,
    nowMs: tickNow - clockSkewMs,
    expandedRows,
    expandedCompacts,
    collapsedTurns,
    compactOnly,
    showAllHistory,
    recentOpen,
    detailCache,
    detailLoading,
    toggleLang,
    switchTab,
    setMetric,
    selectConversationOption,
    jumpToConversation,
    refreshQuota,
    toggleRecentOpen,
    toggleCompactOnly,
    toggleShowAllHistory,
    toggleTurnCollapsed,
    toggleFoldAllTurns,
    toggleInvocationExpanded,
    toggleCompactExpanded,
    loadCallDetail,
  };
}
