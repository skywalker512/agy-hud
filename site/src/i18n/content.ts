export type Locale = 'en' | 'zh';

const LOCALE_STORAGE_KEY = 'agy-hud-site-locale';

const ZH_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Hong_Kong',
  'Asia/Macau',
  'Asia/Taipei',
]);

export function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore */
  }

  try {
    const langs =
      Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language || ''];
    for (const raw of langs) {
      const lower = String(raw || '').toLowerCase();
      if (lower.startsWith('zh')) return 'zh';
      if (lower.startsWith('en')) return 'en';
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && ZH_TIMEZONES.has(tz)) return 'zh';
  } catch {
    /* ignore */
  }
  return 'en';
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export interface SiteCopy {
  nav: {
    tour: string;
    craft: string;
    install: string;
    docs: string;
    github: string;
    themeLight: string;
    themeDark: string;
  };
  hero: {
    badge: string;
    headline: string;
    subhead: string;
    primaryCta: string;
    secondaryCta: string;
    interactiveHint: string;
    trustItems: string[];
    copied: string;
    copy: string;
    autoDetected: string;
    doctorTip: string;
    licenseTip: string;
    tabs: {
      unix: string;
      windows: string;
      agent: string;
      manual: string;
    };
    agentHint: string;
  };
  sim: {
    paneTitle: string;
    sessionName: string;
    statusGen: string;
    tabLive: string;
    tabCalls: string;
    tabAccount: string;
    shortcutHint: string;
    live: {
      genLabel: string;
      e2eLabel: string;
      sustained: string;
      inclTtft: string;
      ctxTitle: string;
      ctxHeadroom: string;
      cacheSafeLabel: string;
      cachePenaltyTip: string;
      swarmTitle: string;
      swarmWorking: string;
      swarmWaiting: string;
      swarmRollup: string;
      swarmBoard: string;
      lastPost: string;
    };
    calls: {
      trendTitle: string;
      followLive: string;
      latest: string;
      avg: string;
      p95: string;
      peak: string;
      brushHint: string;
      tabOverview: string;
      tabTools: string;
      tabRaw: string;
      waterfallTitle: string;
      tokenCompTitle: string;
      cached: string;
      newInput: string;
      thinking: string;
      visible: string;
      copyMd: string;
      copiedMd: string;
      ttft: string;
      think: string;
      toolGen: string;
      stream: string;
      saved: string;
    };
    account: {
      quotaTitle: string;
      win5h: string;
      win7d: string;
      left: string;
      projectedBurn: string;
      resetsIn: string;
      runwayEta: string;
      ttlTitle: string;
      ttlSafe: string;
      ttlHalf: string;
      ttlBg: string;
      rulesTitle: string;
      oosErr: string;
      remoteGap: string;
      activityTitle: string;
      modeHeatmap: string;
      modeIceberg: string;
      heatmapSub: string;
      icebergLegendNew: string;
      icebergLegendCached: string;
      updateTitle: string;
      updateInstalled: string;
      updateAvail: string;
      updateBtn: string;
      updating: string;
      updatedOk: string;
    };
  };
  craft: {
    kicker: string;
    title: string;
    subtitle: string;
    items: Array<{
      id: string;
      tag: string;
      title: string;
      desc: string;
      detail: string;
    }>;
  };
  tour: {
    kicker: string;
    title: string;
    subtitle: string;
    cards: {
      contextCache: {
        eyebrow: string;
        title: string;
        desc: string;
        headroom: string;
        cacheSafe: string;
        missPenalty: string;
      };
      swarm: {
        eyebrow: string;
        title: string;
        desc: string;
        bullets: string[];
      };
      waterfall: {
        eyebrow: string;
        title: string;
        desc: string;
        bullets: string[];
      };
      runway: {
        eyebrow: string;
        title: string;
        desc: string;
        oosBadge: string;
        projectedLabel: string;
      };
      routedModel: {
        eyebrow: string;
        title: string;
        desc: string;
        uiAlias: string;
        actualRouted: string;
      };
      ledger: {
        eyebrow: string;
        title: string;
        desc: string;
        cacheSaved: string;
        newLabel: string;
        cachedLabel: string;
      };
    };
  };
  installGuide: {
    kicker: string;
    title: string;
    subtitle: string;
    reassurance: Array<{
      title: string;
      desc: string;
    }>;
    steps: Array<{
      num: string;
      title: string;
      desc: string;
      cmd: string;
    }>;
    doctorTitle: string;
    doctorSubtitle: string;
  };
  compare: {
    kicker: string;
    title: string;
    subtitle: string;
    cols: [string, string, string, string, string];
    rows: Array<{
      feature: string;
      agyHud: string;
      proxy: string;
      cliAgg: string;
      statusline: string;
    }>;
  };
  docs: {
    kicker: string;
    title: string;
    subtitle: string;
    tabs: Array<{
      id: string;
      label: string;
      title: string;
      intro: string;
      blocks: Array<{
        heading: string;
        body?: string;
        code?: string;
        table?: {
          headers: string[];
          rows: string[][];
        };
        bullets?: string[];
      }>;
    }>;
  };
  footer: {
    tagline: string;
    license: string;
    nodeReq: string;
    linksTitle: string;
    resourcesTitle: string;
    repoLink: string;
    releasesLink: string;
    issuesLink: string;
    changelogLink: string;
  };
}

export const COPY: Record<Locale, SiteCopy> = {
  en: {
    nav: {
      tour: 'Tour',
      craft: 'Craft',
      install: 'Install',
      docs: 'Docs',
      github: 'GitHub',
      themeLight: 'Switch to light mode',
      themeDark: 'Switch to dark mode',
    },
    hero: {
      badge: 'v1.2 · Official Antigravity Side-Pane Plugin',
      headline: 'Real-time telemetry, built right into Antigravity.',
      subhead:
        'See true generation speed, prompt cache survival, context pressure, 5h/7d quota runway, and multi-agent Swarms without ever leaving your workspace — 100% local and read-only.',
      primaryCta: 'Install in 10s',
      secondaryCta: 'Explore the craft',
      interactiveHint: 'Live interactive preview — switch tabs, scrub history, inspect calls & workers',
      trustItems: [
        'Pure Official Sidecar',
        'Zero CDP or Patching',
        '100% Local Read-Only',
        'Syncs Native Antigravity Theme',
      ],
      copied: 'Copied',
      copy: 'Copy',
      autoDetected: 'Recommended',
      doctorTip: 'Verify anytime with node plugin/install.mjs --doctor',
      licenseTip: 'MIT · Node 22.18+ · Zero runtime deps',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI Agent',
        manual: 'Manual',
      },
      agentHint: 'Paste into Antigravity or any coding agent — reads AGENTS.md and verifies with --doctor.',
    },
    sim: {
      paneTitle: 'AGY-HUD',
      sessionName: 'Swarm: Visual Craft',
      statusGen: 'GEN · 1.2s',
      tabLive: 'Live',
      tabCalls: 'Calls',
      tabAccount: 'Account',
      shortcutHint: 'Keys 1 · 2 · 3',
      live: {
        genLabel: 'GEN Speed',
        e2eLabel: 'E2E Speed',
        sustained: 'Post-TTFT sustained',
        inclTtft: 'Incl. TTFT 1.24s',
        ctxTitle: 'Context Window',
        ctxHeadroom: '~14 turns left',
        cacheSafeLabel: 'Cache 94% · ~18m safe (P80)',
        cachePenaltyTip: 'P50 ~26m · miss penalty $0.14 / 0.31% 5h',
        swarmTitle: 'Swarm Cockpit',
        swarmWorking: '2 working',
        swarmWaiting: '1 waiting',
        swarmRollup: '38 calls · 44.1k out · $1.24 · 5h -0.85%',
        swarmBoard: 'Board #24',
        lastPost: 'Latest post',
      },
      calls: {
        trendTitle: 'Session Trend',
        followLive: 'Follow Live',
        latest: 'Latest',
        avg: 'Avg',
        p95: 'P95',
        peak: 'Peak',
        brushHint: 'Drag minimap to scrub · Click chart to inspect turn',
        tabOverview: 'Overview',
        tabTools: 'Tools',
        tabRaw: 'Raw',
        waterfallTitle: 'Timing Waterfall',
        tokenCompTitle: 'Token & Cost Composition',
        cached: 'Cached',
        newInput: 'New',
        thinking: 'Think',
        visible: 'Reply',
        copyMd: 'Copy MD',
        copiedMd: 'Copied',
        ttft: 'TTFT',
        think: 'Think',
        toolGen: 'Tool Gen',
        stream: 'Stream',
        saved: 'Saved',
      },
      account: {
        quotaTitle: 'Quota Runway',
        win5h: '5h Rolling Pool',
        win7d: '7d Weekly Pool',
        left: 'left',
        projectedBurn: 'projected burn',
        resetsIn: 'Resets in',
        runwayEta: 'Runway',
        ttlTitle: 'Prompt Cache Survival (TTL)',
        ttlSafe: 'P80 Safe',
        ttlHalf: 'P50 Half-life',
        ttlBg: 'Bg Miss',
        rulesTitle: 'IRLS k-Multipliers',
        oosErr: 'OOS ±1.8%',
        remoteGap: 'Remote gap 1.2% · Unified App + CLI tank',
        activityTitle: 'Activity (App + CLI)',
        modeHeatmap: '16w Heatmap',
        modeIceberg: 'Token Iceberg',
        heatmapSub: '112d · $42.80 API equiv · $18.40 cache saved',
        icebergLegendNew: 'New tokens',
        icebergLegendCached: 'Cached read',
        updateTitle: 'Plugin Updates',
        updateInstalled: 'v1.2.0 installed',
        updateAvail: 'v1.2.1 ready',
        updateBtn: 'Update',
        updating: 'Verifying…',
        updatedOk: 'Upgraded to v1.2.1',
      },
    },
    craft: {
      kicker: 'Craftsmanship',
      title: 'Designed to disappear into Antigravity.',
      subtitle:
        'Good developer instruments do not shout for attention. Every surface, curve, and fallback in AGY-HUD is engineered to feel native to your host IDE and stay mathematically honest.',
      items: [
        {
          id: 'theme-sync',
          tag: 'Native Host Parity',
          title: 'Live Theme, Font & High-Contrast Sync',
          desc: 'Continuously samples Antigravity’s computed CSS variables (--background, --card, --primary, --font-size) via a 1×1 luminance probe and MutationObserver — adapting automatically to Dark, Light, and strong-contrast modes.',
          detail: 'data-theme="dark|light" · data-contrast="strong" · --hud-font-scale',
        },
        {
          id: 'zero-cdp',
          tag: 'Read-Only Safety',
          title: 'Zero CDP, Zero Patching, Zero Proxies',
          desc: 'Runs purely as an official Antigravity sidecar reading local SQLite (-wal) with ?mode=ro and loopback LS RPC. Launch Antigravity normally from your Dock or Start Menu — survives every Electron and app update.',
          detail: 'No app.asar hacks · No debug ports · 0 ms inference overhead',
        },
        {
          id: 'cache-ttl',
          tag: 'Survival Modeling',
          title: 'Empirical Prompt Cache TTL Curves',
          desc: 'Fits a regularized per-family Log-Logistic survival curve S(t) = (1 − p0) / (1 + (t / t50)^k) from your own idle gaps — distinguishing Claude’s sharp 5-minute cliff from Gemini’s gradual LRU decay, with live miss penalty in USD & 5h quota.',
          detail: 'P80 safe window · P50 half-life · Live expiry countdown',
        },
        {
          id: 'quota-irls',
          tag: 'Quota Calibration',
          title: 'IRLS k-Multiplier Fitter & Hatched Runway',
          desc: 'Calibrates per-model credit multipliers and 5h/7d tank sizes with Huber/Tukey IRLS and 6σ MAD outlier rejection, then plots your projected burn before reset directly on a hatched diagonal runway bar.',
          detail: 'OOS error bands · Remote spend gap · Depletion ETA',
        },
        {
          id: 'routed-f19',
          tag: 'Signal Fidelity',
          title: 'True Routed Model (f19) & BUF Filtering',
          desc: 'Decodes Protobuf gen_metadata.f1.f19 to show the actual backend model that answered each turn, and excludes single-packet buffered turns (BUF) so sustained generation speed never exceeds peak.',
          detail: 'Protobuf wire decoder · Separate GEN vs E2E · TC-WAIT isolation',
        },
        {
          id: 'swarm-ledger',
          tag: 'Unified Context',
          title: 'Native Swarm Cockpit & Multi-Store Ledger',
          desc: 'Reads Antigravity’s local Swarm files (swarm.json, members.json, plan.json, board.jsonl) with mtime caching, while auto-merging App, CLI (agy), ACP, and IDE stores into one 52-week ledger and Token Iceberg view.',
          detail: 'Live @roster states · Coordinator breadcrumbs · App + CLI + IDE',
        },
      ],
    },
    tour: {
      kicker: 'Feature Tour',
      title: 'Built to help you ship faster — without surprise walls.',
      subtitle:
        'Spot context compactions before they wipe your working memory, catch cache cliffs before a coffee break costs you quota, and keep every multi-agent run transparent.',
      cards: {
        contextCache: {
          eyebrow: 'Context & Cache',
          title: 'Avoid surprise compactions and cold-cache bills',
          desc: 'See exactly what is filling your 256k window — from oversized read_file outputs to MCP tool schemas — alongside remaining turns before compaction and how long your prefix cache will survive.',
          headroom: '~14 turns headroom',
          cacheSafe: 'P80 safe: ~18m',
          missPenalty: 'Miss penalty: $0.14 / 0.31% 5h',
        },
        swarm: {
          eyebrow: 'Multi-Agent Swarm',
          title: 'Follow every worker without jumping between tabs',
          desc: 'Monitor live working and waiting states for every @rosterName, see assigned plan tasks, shared worktree badges, Board #seq progress, and rolled-up spend across the entire swarm.',
          bullets: [
            'Mtime-cached read-only parser with near-zero CPU overhead',
            'Worker-to-coordinator breadcrumbs with 1-click conversation jump',
            'Rolled-up calls, output tokens, USD equiv, and 5h/7d burn',
          ],
        },
        waterfall: {
          eyebrow: 'Call Explorer',
          title: 'Pinpoint why a turn felt slow in two seconds',
          desc: 'Scrub full-session history with a minimap brush and drag-to-zoom, filter anomalies (Slow TTFT, Low Cache, TC-WAIT), and inspect proportional TTFT, Thinking, Tool Gen, and Reply waterfalls.',
          bullets: [
            'Separates thinking time from tool-argument stalls (TC-WAIT)',
            'Prefix Cache vs New Input & Thinking vs Visible token bars',
            'Keyboard search (/), anomaly chips, and 1-click MD/JSON export',
          ],
        },
        runway: {
          eyebrow: 'Quota Runway',
          title: 'Never hit a 5h limit mid-refactor',
          desc: 'Hatched diagonal bars project how much of your 5h or 7d pool your current pace will consume before reset, backed by empirically fitted per-model k-multipliers.',
          oosBadge: 'OOS ±1.8%',
          projectedLabel: 'Hatched = projected burn before reset',
        },
        routedModel: {
          eyebrow: 'Model Truth',
          title: 'Know which model actually answered',
          desc: 'Surfaces the real backend model ID decoded from Protobuf f1.f19 and splits sustained GEN speed from user-perceived E2E throughput.',
          uiAlias: 'Display Label',
          actualRouted: 'Routed f1.f19',
        },
        ledger: {
          eyebrow: 'Unified Ledger',
          title: 'One timeline across App, CLI & IDE',
          desc: 'Automatically merges sibling Antigravity stores into a 16w/52w activity heatmap and a Monochrome Token Iceberg comparing new compute above the line against cached reads below.',
          cacheSaved: 'Cache saved',
          newLabel: 'New tokens',
          cachedLabel: 'Cached reads',
        },
      },
    },
    installGuide: {
      kicker: 'Get Started',
      title: 'Up and running in ten seconds.',
      subtitle:
        'Install with a single command, or hand one sentence to your coding agent. Requires Node.js 22.18+ (built-in node:sqlite) and zero external runtime packages.',
      reassurance: [
        {
          title: 'Strictly Local & Read-Only',
          desc: 'Opens SQLite stores with ?mode=ro and reads loopback IPC only. Zero telemetry beacons or cloud sign-ins.',
        },
        {
          title: 'Hardened GitHub Installer',
          desc: 'Enforces a strict github.com HTTPS allowlist, zip-slip & symlink defense, and 50MB/64MB archive caps.',
        },
        {
          title: 'Atomic Swap & Rollback',
          desc: 'Stages into a temp directory, validates manifest and UI assets, and restores your previous install on any error.',
        },
      ],
      steps: [
        {
          num: '01',
          title: 'Install into Antigravity',
          desc: 'Stages atomically into ~/.gemini/config/plugins/agy-hud and validates Node 22.18+ with built-in node:sqlite.',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh',
        },
        {
          num: '02',
          title: 'Verify with --doctor',
          desc: 'Checks Node runtime, SQLite availability, manifest integrity, prebuilt UI assets, and local store discovery.',
          cmd: 'node plugin/install.mjs --doctor',
        },
        {
          num: '03',
          title: 'Update in one click',
          desc: 'Upgrade directly from the Account tab or run --update anytime with automatic rollback safety.',
          cmd: 'node plugin/install.mjs --update',
        },
      ],
      doctorTitle: 'node plugin/install.mjs --doctor',
      doctorSubtitle: 'Zero runtime deps · --json supported',
    },
    compare: {
      kicker: 'Approach Comparison',
      title: 'How local sidecar observation compares.',
      subtitle:
        'An objective look at architectural trade-offs between AGY-HUD’s official sidecar approach and common proxy, log-aggregator, or statusline tools.',
      cols: ['Capability', 'AGY-HUD', 'MITM Proxy Tools', 'CLI Log Aggregators', 'Terminal Statuslines'],
      rows: [
        {
          feature: 'Connection Method',
          agyHud: 'Official sidecar · read-only SQLite + loopback LS',
          proxy: 'Intercepts HTTPS via local proxy & CA cert',
          cliAgg: 'Parses local JSONL / SQLite after runs',
          statusline: 'Shell hook / single-line text',
        },
        {
          feature: 'Inference Latency & App Updates',
          agyHud: '0 ms overhead · survives stock app updates',
          proxy: 'Extra network hop · TLS config needed',
          cliAgg: '0 ms overhead · offline only',
          statusline: '0 ms overhead · CLI only',
        },
        {
          feature: 'Prompt Cache TTL Survival Curve',
          agyHud: 'Per-family Log-Logistic P80/P50 + miss cost',
          proxy: 'Raw hit % per request',
          cliAgg: 'Aggregate cache totals',
          statusline: 'Not available',
        },
        {
          feature: 'Routed Backend Model ID (f19)',
          agyHud: 'Exact Protobuf f1.f19 decoded',
          proxy: 'Request alias only',
          cliAgg: 'Logged model string',
          statusline: 'Display label only',
        },
        {
          feature: 'Speed & Latency Breakdown',
          agyHud: 'GEN vs E2E + BUF filter + TTFT/Think/TC-WAIT',
          proxy: 'Stream timing only',
          cliAgg: 'Historical averages',
          statusline: 'Minimal / none',
        },
        {
          feature: 'Quota Runway & Calibration',
          agyHud: 'IRLS k-multipliers + hatched 5h/7d runway',
          proxy: 'API list price estimates',
          cliAgg: 'API list price estimates',
          statusline: 'Raw % remaining',
        },
        {
          feature: 'Native AGY Swarm Observability',
          agyHud: 'Roster, states, tasks, board #seq & rollup',
          proxy: 'Not available',
          cliAgg: 'Not available',
          statusline: 'Count only / none',
        },
        {
          feature: 'Host Theme & High-Contrast Parity',
          agyHud: 'Live CSS variable + font + strong-contrast sync',
          proxy: 'Separate browser dashboard',
          cliAgg: 'Terminal output',
          statusline: 'Terminal ANSI colors',
        },
      ],
    },
    docs: {
      kicker: 'Reference',
      title: 'Technical documentation, right here.',
      subtitle:
        'CLI commands, Cache TTL survival math, Swarm file schema, metric definitions, Protobuf fields, and keyboard shortcuts.',
      tabs: [
        {
          id: 'quickstart',
          label: 'CLI & Install',
          title: 'Installer CLI Commands & Environment Options',
          intro:
            'AGY-HUD installs into ~/.gemini/config/plugins/agy-hud (or a custom path via --target) using Node.js 22.18+ built-in node:sqlite with zero external runtime packages.',
          blocks: [
            {
              heading: 'plugin/install.mjs Commands',
              table: {
                headers: ['Command / Flag', 'Behavior'],
                rows: [
                  ['node plugin/install.mjs --install', 'Default. Staged atomic copy into ~/.gemini/config/plugins/agy-hud.'],
                  ['node plugin/install.mjs --link', 'Creates a symlink/junction to plugin/ for live local development.'],
                  ['node plugin/install.mjs --doctor [--json]', 'Validates Node 22.18+, node:sqlite, manifest, UI bundle, and stores.'],
                  ['node plugin/install.mjs --check-update [--json]', 'Queries GitHub releases for newer SemVer versions.'],
                  ['node plugin/install.mjs --update [--force] [--ref <tag>]', 'Downloads verified GitHub archive and swaps atomically with rollback.'],
                  ['node plugin/install.mjs --uninstall', 'Cleanly removes the installed plugin directory or symlink.'],
                ],
              },
            },
            {
              heading: 'Installer Environment Variables',
              bullets: [
                'AGY_HUD_VERSION: Pin a specific release tag (e.g. 1.2.0 or v1.2.0).',
                'AGY_HUD_REF: Install from a specific git branch or commit ref.',
                'AGY_HUD_TARGET: Override the default plugin installation directory.',
                'Reload or restart Antigravity once after first install so the side-pane icon mounts immediately.',
              ],
            },
          ],
        },
        {
          id: 'cache-ttl',
          label: 'Prompt Cache TTL',
          title: 'Empirical Prompt Cache Survival Modeling',
          intro:
            'AGY-HUD tracks consecutive turns per model family (minimum 2,000 previous prompt tokens) and fits a regularized Log-Logistic survival curve to predict how long your prompt prefix remains hot.',
          blocks: [
            {
              heading: 'Survival Formula & Parameters (cache-ttl.ts)',
              code: 'S(t) = (1 - p0) / (1 + (t / t50)^k)\n  p0  = short-gap (<60s) empirical Bayes background miss rate\n  t50 = median survival half-life (seconds)\n  k   = steepness (gentle LRU decay for Gemini; sharp ~5m cliff for Claude)',
              bullets: [
                'Weak MAP priors ensure calibrated estimates on cold start while converging smoothly as long-gap (>=180s) observations accumulate.',
                'Reports P80 (safe reply window), P50 (half-life), and live miss penalty in both USD equivalent and calibrated 5h quota %.',
                'Confidence tiers progress cleanly from prior -> provisional -> fitted (>=10 long gaps with observed hits and misses).',
              ],
            },
          ],
        },
        {
          id: 'swarm',
          label: 'Native Swarm',
          title: 'Native AGY Swarm Observability',
          intro:
            'AGY-HUD reads Antigravity’s local swarm artifacts under <appDataDir>/brain/<coordinator_conv_id>/.system_generated/swarm/ using mtime-cached read-only parsing and reverse worker-to-coordinator indexing.',
          blocks: [
            {
              heading: 'Parsed Read-Only Artifacts',
              table: {
                headers: ['File', 'Extracted Telemetry'],
                rows: [
                  ['swarm.json', 'Swarm identity (swarm_id, backend, created_at) linking the coordinator conversation.'],
                  ['members.json', 'Swarm title, @rosterName, role, phase, wake_mode, killed flag, model, workspace mode (inherit/share/branch).'],
                  ['plan.json', 'Swarm goal title, per-member task summaries, and thread groupings.'],
                  ['board.jsonl', 'Bounded tail read for highest Board #seq, per-agent latest message snippet, and timestamp.'],
                ],
              },
            },
          ],
        },
        {
          id: 'metrics',
          label: 'Metrics & Waterfall',
          title: 'Speed, Latency & Context Formulas',
          intro:
            'Separates true sustained generation speed from TTFT latency and single-packet buffered turns so every session chart remains faithful.',
          blocks: [
            {
              heading: 'Core Definitions',
              table: {
                headers: ['Metric', 'Definition'],
                rows: [
                  ['GEN TPS', 'Output tokens / post-TTFT streaming duration (f12). Excludes single-packet BUF spikes.'],
                  ['E2E TPS', 'Output tokens / (TTFT f11 + streaming duration f12). User-perceived throughput.'],
                  ['TTFT', 'Time to first token (gen_metadata.f1.f11) with 3s warn / 10s slow thresholds.'],
                  ['TC-WAIT', 'Tool-call argument streaming stall separated from thinking (THK) and tool execution.'],
                  ['Headroom Turns', 'Estimated turns left before compaction based on median per-turn context delta.'],
                ],
              },
            },
          ],
        },
        {
          id: 'quota',
          label: 'Quota & Protobuf',
          title: 'IRLS Quota Fitting & Protobuf Field Map',
          intro:
            'Pairs local multi-store token usage with loopback LS RPC quota snapshots to fit per-model k-multipliers and project remaining 5h/7d runway.',
          blocks: [
            {
              heading: 'Decoded Protobuf Fields (gen_metadata & steps)',
              table: {
                headers: ['Field Path', 'Telemetry', 'Fallback'],
                rows: [
                  ['gen_metadata.f1.f19', 'Actual routed backend model ID (e.g. gemini-4-carbon)', 'UI label (f1.f21)'],
                  ['gen_metadata.f1.f4', 'Cached (f5), new input (f2), output (f3/f1), thinking (f9), visible (f10)', 'Legacy usage (f1.f17.f2)'],
                  ['gen_metadata.f1.f9.f10', 'Active context tokens (f1) and context limit (f4)', 'cached + new_input'],
                  ['gen_metadata.f1.f11 / f12', 'TTFT seconds (f11) and streaming duration seconds (f12)', '0.0s'],
                ],
              },
            },
          ],
        },
        {
          id: 'security',
          label: 'Security & Keys',
          title: 'Security Model & Side-Pane Keyboard Shortcuts',
          intro:
            'Built with strict local privacy invariants, supply-chain guardrails for optional updates, and keyboard-first navigation.',
          blocks: [
            {
              heading: 'Side-Pane Keyboard Shortcuts',
              table: {
                headers: ['Shortcut', 'Action'],
                rows: [
                  ['1 / 2 / 3', 'Switch between Live, Calls, and Account tabs'],
                  ['/', 'Focus Call Explorer search (auto-switches to Calls tab)'],
                  ['Esc', 'Clear search, close popover, or reset active selection'],
                  ['Drag / Ctrl+Wheel', 'Drag-to-zoom chart range or zoom smoothly around cursor'],
                ],
              },
            },
            {
              heading: 'Update & Filesystem Guardrails',
              bullets: [
                'Strict HTTPS allowlist restricted to github.com / codeload.github.com / api.github.com for skywalker512/agy-hud.',
                'Rejects absolute paths, traversal segments (..), symlinks, >2,000 files, or >50MB archive / >64MB extracted payloads.',
                'Protects --link development checkouts unless --force is explicitly passed.',
              ],
            },
          ],
        },
      ],
    },
    footer: {
      tagline: 'Local, read-only real-time telemetry built into Google Antigravity.',
      license: 'MIT License',
      nodeReq: 'Node.js 22.18+ (node:sqlite)',
      linksTitle: 'Product',
      resourcesTitle: 'Resources',
      repoLink: 'GitHub Repository',
      releasesLink: 'Releases',
      issuesLink: 'Issue Tracker',
      changelogLink: 'Changelog',
    },
  },
  zh: {
    nav: {
      tour: '功能导览',
      craft: '工程细节',
      install: '安装',
      docs: '文档',
      github: 'GitHub',
      themeLight: '切换至浅色模式',
      themeDark: '切换至深色模式',
    },
    hero: {
      badge: 'v1.2 · Antigravity 官方架构侧边栏插件',
      headline: '原生融入 Antigravity 的实时遥测驾驶舱。',
      subhead:
        '在侧边栏实时看清真实生成速度、提示词缓存存活倒计时、上下文窗口压力、5h/7d 配额续航与多智能体 Swarm 状态——100% 本地只读，零侵入。',
      primaryCta: '10 秒快速安装',
      secondaryCta: '了解工程细节',
      interactiveHint: '可交互实时预览 — 点击切换标签、拖拽刷选历史区间、查看单次调用与 Worker',
      trustItems: [
        '纯官方 Sidecar 插件',
        '零 CDP · 零改包',
        '100% 本地只读',
        '同步 Antigravity 原生主题',
      ],
      copied: '已复制',
      copy: '复制',
      autoDetected: '推荐',
      doctorTip: '随时运行 node plugin/install.mjs --doctor 自检环境',
      licenseTip: 'MIT 开源 · Node 22.18+ · 零运行时依赖',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI 代理一键装',
        manual: '手动安装',
      },
      agentHint: '直接发给 Antigravity 或任意编程代理——自动按 AGENTS.md 安装并用 --doctor 验收。',
    },
    sim: {
      paneTitle: 'AGY-HUD',
      sessionName: 'Swarm: 视觉质感重构',
      statusGen: 'GEN · 1.2s',
      tabLive: '实时',
      tabCalls: '调用',
      tabAccount: '账户',
      shortcutHint: '快捷键 1 · 2 · 3',
      live: {
        genLabel: 'GEN 速度',
        e2eLabel: 'E2E 速度',
        sustained: '首字后持续吞吐',
        inclTtft: '含 TTFT 1.24s',
        ctxTitle: '上下文窗口',
        ctxHeadroom: '约剩 14 轮空间',
        cacheSafeLabel: '缓存 94% · ~18m 安全 (P80)',
        cachePenaltyTip: 'P50 ~26m · 失效惩罚 $0.14 / 0.31% 5h',
        swarmTitle: 'Swarm 驾驶舱',
        swarmWorking: '2 运行中',
        swarmWaiting: '1 等待中',
        swarmRollup: '38 次调用 · 44.1k 输出 · $1.24 · 5h -0.85%',
        swarmBoard: '公告板 #24',
        lastPost: '最新动态',
      },
      calls: {
        trendTitle: '会话趋势',
        followLive: '跟随最新',
        latest: '最新',
        avg: '均值',
        p95: 'P95',
        peak: '峰值',
        brushHint: '拖拽缩略图刷选区间 · 点击曲线查看单次剖析',
        tabOverview: '总览',
        tabTools: '工具',
        tabRaw: '原始',
        waterfallTitle: '耗时瀑布图',
        tokenCompTitle: 'Token 与成本构成',
        cached: '缓存',
        newInput: '新增',
        thinking: '思考',
        visible: '回复',
        copyMd: '复制 MD',
        copiedMd: '已复制',
        ttft: 'TTFT',
        think: '思考',
        toolGen: '工具生成',
        stream: '流式输出',
        saved: '已省',
      },
      account: {
        quotaTitle: '配额续航',
        win5h: '5 小时滚动池',
        win7d: '7 天每周池',
        left: '剩余',
        projectedBurn: '预计消耗',
        resetsIn: '重置倒计时',
        runwayEta: '预计续航',
        ttlTitle: '提示词缓存存活曲线 (TTL)',
        ttlSafe: 'P80 安全窗',
        ttlHalf: 'P50 半衰期',
        ttlBg: '本底失效率',
        rulesTitle: 'IRLS k-倍率校准',
        oosErr: 'OOS ±1.8%',
        remoteGap: '跨端差额 1.2% · App + CLI 统一水箱',
        activityTitle: '活跃度（App + CLI）',
        modeHeatmap: '16 周热力图',
        modeIceberg: 'Token 冰山图',
        heatmapSub: '112 天 · $42.80 等效 API · 缓存省 $18.40',
        icebergLegendNew: '新增 Token',
        icebergLegendCached: '缓存命中',
        updateTitle: '插件自更新',
        updateInstalled: '当前 v1.2.0',
        updateAvail: '可升级 v1.2.1',
        updateBtn: '立即更新',
        updating: '校验中…',
        updatedOk: '已原子升级至 v1.2.1',
      },
    },
    craft: {
      kicker: '工程打磨',
      title: '克制到仿佛原生就长在 Antigravity 里。',
      subtitle:
        '好的开发者仪表盘不喧宾夺主。AGY-HUD 的每一层表面、每一条拟合曲线、每一次回退策略，都追求与宿主 IDE 浑然一体且数据诚实可信。',
      items: [
        {
          id: 'theme-sync',
          tag: '宿主视觉同步',
          title: '实时主题、字号与高对比度同步',
          desc: '通过 1×1 亮度探针与 MutationObserver 持续采样 Antigravity 的计算 CSS 变量（--background、--card、--primary、--font-size），自动适配深色、浅色与高对比度模式，永不割裂。',
          detail: 'data-theme="dark|light" · data-contrast="strong" · --hud-font-scale',
        },
        {
          id: 'zero-cdp',
          tag: '零侵入只读安全',
          title: '零 CDP、零改包、零代理拦截',
          desc: '严格遵循官方 Sidecar 插件规范，以 ?mode=ro 只读打开本地 SQLite 与回环 LS RPC。直接从桌面正常启动 Antigravity 即可工作，彻底无惧 Electron 与客户端版本升级。',
          detail: '不改 app.asar · 不开调试端口 · 0 ms 推理链路延迟',
        },
        {
          id: 'cache-ttl',
          tag: '生存分析建模',
          title: '提示词缓存 TTL 生存曲线预测',
          desc: '按模型族基于你真实的历史停顿间隔拟合正则化对数逻辑斯蒂生存曲线 S(t) = (1 − p0) / (1 + (t / t50)^k)，准确区分 Claude 5 分钟硬悬崖与 Gemini 渐进 LRU 衰减，并实时折算失效的美元与 5h 配额代价。',
          detail: 'P80 安全窗口 · P50 半衰期 · 实时过期倒计时',
        },
        {
          id: 'quota-irls',
          tag: '配额实证校准',
          title: 'IRLS k-倍率拟合与斜线续航条',
          desc: '结合 Huber/Tukey IRLS 与 6σ MAD 离群值剔除，基于真实 5h/7d 配额扣减拟合各模型倍率与有效池容量，在斜线纹理续航条上直观标出重置前的预计消耗。',
          detail: '样本外 OOS 误差带 · 跨端消耗差额 · 耗尽时间预测',
        },
        {
          id: 'routed-f19',
          tag: '遥测保真度',
          title: '真实后端模型 (f19) 与 BUF 尖峰过滤',
          desc: '解析 Protobuf gen_metadata.f1.f19 还原实际响应的后端模型 ID，并自动过滤单包缓冲突发（BUF）响应，保证持续生成速度均值永不虚高、永不超峰值。',
          detail: 'Protobuf 线格式解码 · GEN/E2E 分离 · TC-WAIT 隔离',
        },
        {
          id: 'swarm-ledger',
          tag: '全局统一账本',
          title: '原生 Swarm 驾驶舱与跨端多库账本',
          desc: '基于 mtime 缓存只读解析本地 Swarm 元数据（swarm.json、members.json、plan.json、board.jsonl），同时自动合并 App、CLI（agy）、ACP 与 IDE 会话库，汇总为统一花费、热力图与 Token 冰山图。',
          detail: '@rosterName 实时状态 · 协调者面包屑 · App + CLI + IDE',
        },
      ],
    },
    tour: {
      kicker: '功能导览',
      title: '帮你在写代码时提前看见风险，而不是事后复盘。',
      subtitle:
        '在意外上下文压缩抹掉工作记忆前预警，在喝杯咖啡导致缓存冷失效前提醒，让多智能体并行开发始终一目了然。',
      cards: {
        contextCache: {
          eyebrow: '上下文与缓存',
          title: '告别意外压缩与隐形缓存冷启动账单',
          desc: '精确透视 256k 窗口里的每一块占比——从超大的 read_file 输出到 MCP 工具定义——同步给出距离自动压缩的剩余轮次与当前前缀缓存的安全存活时间。',
          headroom: '约剩 14 轮缓冲',
          cacheSafe: 'P80 安全窗：~18m',
          missPenalty: '失效代价：$0.14 / 0.31% 5h',
        },
        swarm: {
          eyebrow: '多智能体 Swarm',
          title: '不用来回切会话，全局掌握每个 Worker 进度',
          desc: '同屏监控每个 @rosterName 的运行/等待状态、分配任务、独立工作区标识、公告板最新 #seq，以及整个 Swarm 汇总后的真实成本与配额消耗。',
          bullets: [
            '基于 mtime 缓存的只读解析，几乎零轮询 CPU 开销',
            'Worker 视角自动显示协调者面包屑，一键跳回主控会话',
            '自动汇总全员调用次数、输出 Token、美元与 5h/7d 消耗',
          ],
        },
        waterfall: {
          eyebrow: '调用剖析器',
          title: '两秒定位某一轮为什么突然变慢',
          desc: '通过历史缩略图刷选与框选缩放回溯整场会话，一键筛选异常调用（高 TTFT、低缓存、TC-WAIT），用比例瀑布图拆解 TTFT、思考、工具生成与流式输出耗时。',
          bullets: [
            '把思考耗时与工具参数生成停顿（TC-WAIT）清晰拆开',
            '同屏对比前缀缓存与新增输入、思考与可见回复占比',
            '支持 / 快捷搜索、异常标签筛选与一键导出 Markdown/JSON',
          ],
        },
        runway: {
          eyebrow: '配额续航',
          title: '不再在重构到一半时撞上 5 小时限额墙',
          desc: '斜线纹理续航条直观展示按当前节奏在窗口重置前预计会烧掉多少配额，由实证拟合的各模型 k-倍率驱动，不再靠猜。',
          oosBadge: 'OOS ±1.8%',
          projectedLabel: '斜线区域 = 重置前预计消耗',
        },
        routedModel: {
          eyebrow: '真实模型',
          title: '清楚知道每一轮到底是谁在回答',
          desc: '从 Protobuf f1.f19 解码真实路由的后端模型 ID，并把持续生成吞吐（GEN）与用户体感端到端吞吐（E2E）彻底分开。',
          uiAlias: '界面展示别名',
          actualRouted: '真实路由 f1.f19',
        },
        ledger: {
          eyebrow: '跨端账本',
          title: 'App、CLI 与 IDE 统一进同一份时间线',
          desc: '自动发现并合并同机所有 Antigravity 存储库，支持 16 周/52 周热力图与黑白极简 Token 冰山图（基线上方为新增消耗，下方为缓存复用）。',
          cacheSaved: '缓存已省',
          newLabel: '新增 Token',
          cachedLabel: '缓存读取',
        },
      },
    },
    installGuide: {
      kicker: '快速开始',
      title: '一条命令，十秒完成安装。',
      subtitle:
        '选择对应系统的单行脚本，或把一句话直接交给你的 AI 编程代理。仅需 Node.js 22.18+（内置 node:sqlite），零第三方运行时依赖。',
      reassurance: [
        {
          title: '严格本地只读',
          desc: '以 ?mode=ro 只读打开 SQLite，仅与本地回环 IPC 通信。零遥测上报、零云端登录。',
        },
        {
          title: '受控 GitHub 安全校验',
          desc: '强制 GitHub 官方 HTTPS 白名单、防路径穿越/软链校验以及 50MB/64MB 解压上限。',
        },
        {
          title: '原子切换与失败回滚',
          desc: '先在临时目录完整校验清单与前端产物，再原子替换；异常时自动恢复原版本。',
        },
      ],
      steps: [
        {
          num: '01',
          title: '安装到 Antigravity 插件目录',
          desc: '自动校验 Node 22.18+ 与 node:sqlite，原子部署至 ~/.gemini/config/plugins/agy-hud。',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh',
        },
        {
          num: '02',
          title: '运行 --doctor 环境自检',
          desc: '一次性验证运行环境、SQLite 驱动、插件清单、UI 产物与本地会话库发现状态。',
          cmd: 'node plugin/install.mjs --doctor',
        },
        {
          num: '03',
          title: '一键应用内或命令行更新',
          desc: '在账户页点击更新或随时运行 --update，全程具备白名单与自动回滚保护。',
          cmd: 'node plugin/install.mjs --update',
        },
      ],
      doctorTitle: 'node plugin/install.mjs --doctor',
      doctorSubtitle: '零运行时依赖 · 支持 --json 输出',
    },
    compare: {
      kicker: '架构对比',
      title: '官方只读 Sidecar 与常见监控方式的取舍。',
      subtitle:
        '客观对比本地只读 Sidecar、API 代理抓包、离线日志统计与终端状态栏在延迟、安全与深度遥测上的差异。',
      cols: ['能力维度', 'AGY-HUD', 'MITM 代理工具', 'CLI 日志统计', '终端状态栏'],
      rows: [
        {
          feature: '数据采集方式',
          agyHud: '官方 Sidecar · 只读 SQLite + 回环 LS RPC',
          proxy: '本地代理 + 根证书拦截 HTTPS 流量',
          cliAgg: '运行结束后解析本地 JSONL / SQLite',
          statusline: 'Shell 钩子 / 单行文本摘要',
        },
        {
          feature: '推理延迟与客户端升级',
          agyHud: '0 ms 额外延迟 · 兼容官方原版升级',
          proxy: '增加代理跳转 · 需维护证书与环境变量',
          cliAgg: '0 ms 延迟 · 仅事后离线查看',
          statusline: '0 ms 延迟 · 仅限终端环境',
        },
        {
          feature: '提示词缓存 TTL 生存曲线',
          agyHud: '按模型族拟合 P80/P50 曲线与失效成本',
          proxy: '仅单次请求命中率',
          cliAgg: '仅累计缓存汇总',
          statusline: '无',
        },
        {
          feature: '真实路由后端模型 ID (f19)',
          agyHud: '精确解码 Protobuf f1.f19',
          proxy: '仅请求侧别名',
          cliAgg: '仅日志记录名',
          statusline: '仅界面展示名',
        },
        {
          feature: '速度与耗时分解',
          agyHud: 'GEN/E2E 分离 + BUF 过滤 + 四阶段瀑布图',
          proxy: '仅粗略流式速度',
          cliAgg: '历史均值',
          statusline: '无 / 极简',
        },
        {
          feature: '配额续航与倍率校准',
          agyHud: 'IRLS k-倍率 + 5h/7d 斜线预计消耗条',
          proxy: '仅 API 挂牌价估算',
          cliAgg: '仅 API 挂牌价估算',
          statusline: '仅原始剩余百分比',
        },
        {
          feature: '原生 AGY Swarm 协同观测',
          agyHud: '全员名册、状态、任务、公告板与汇总',
          proxy: '无',
          cliAgg: '无',
          statusline: '仅数量 / 无',
        },
        {
          feature: '宿主主题与高对比度一致性',
          agyHud: '实时采样宿主 CSS 变量、字号与高对比度',
          proxy: '独立浏览器网页',
          cliAgg: '终端表格',
          statusline: '终端 ANSI 配色',
        },
      ],
    },
    docs: {
      kicker: '技术参考',
      title: '常用命令与核心算法，一页查阅。',
      subtitle:
        '涵盖安装命令、缓存 TTL 生存公式、Swarm 文件协议、指标定义、Protobuf 字段与键盘快捷键。',
      tabs: [
        {
          id: 'quickstart',
          label: '安装与 CLI',
          title: '安装器命令与环境变量说明',
          intro:
            'AGY-HUD 默认安装至 ~/.gemini/config/plugins/agy-hud（可通过 --target 自定义），基于 Node.js 22.18+ 内置 node:sqlite，零外部运行时依赖。',
          blocks: [
            {
              heading: 'plugin/install.mjs 常用命令',
              table: {
                headers: ['命令 / 参数', '作用'],
                rows: [
                  ['node plugin/install.mjs --install', '默认模式，原子拷贝安装到 ~/.gemini/config/plugins/agy-hud。'],
                  ['node plugin/install.mjs --link', '创建软链接 / Windows 目录联接，适合本地开发调试。'],
                  ['node plugin/install.mjs --doctor [--json]', '检查 Node 22.18+、node:sqlite、清单、前端产物与本地数据目录。'],
                  ['node plugin/install.mjs --check-update [--json]', '检查 GitHub Releases 是否有新版本。'],
                  ['node plugin/install.mjs --update [--force] [--ref <tag>]', '拉取受控 GitHub 发布包并原子替换，失败自动回滚。'],
                  ['node plugin/install.mjs --uninstall', '干净移除已安装目录或开发软链接。'],
                ],
              },
            },
            {
              heading: '可选环境变量',
              bullets: [
                'AGY_HUD_VERSION：指定安装某个版本标签（如 1.2.0 或 v1.2.0）。',
                'AGY_HUD_REF：从指定分支或提交哈希安装。',
                'AGY_HUD_TARGET：自定义目标插件目录。',
                '首次安装完成后重载或重启一次 Antigravity，即可在侧边栏看到 AGY-HUD 图标。',
              ],
            },
          ],
        },
        {
          id: 'cache-ttl',
          label: '缓存 TTL 模型',
          title: '提示词缓存经验生存分析（cache-ttl.ts）',
          intro:
            'AGY-HUD 按模型族收集相邻调用（前序提示词 >= 2,000 tokens）的停顿间隔与命中情况，拟合正则化对数逻辑斯蒂生存曲线，预测当前缓存还能保持温热多久。',
          blocks: [
            {
              heading: '生存曲线公式与参数',
              code: 'S(t) = (1 - p0) / (1 + (t / t50)^k)\n  p0  = 短间隔 (<60s) 经验贝叶斯本底失效率\n  t50 = 缓存中位半衰期（秒）\n  k   = 衰减陡度（Gemini 为平缓 LRU 衰减；Claude 为 5 分钟陡峭悬崖）',
              bullets: [
                '冷启动阶段使用弱先验 MAP 正则保证合理预测，随着长间隔（>=180s）样本累积自动收敛到你的真实环境。',
                '输出 P80 安全回复窗口、P50 半衰期，以及若缓存过期将产生的等效美元与 5h 配额惩罚。',
                '置信度随样本数自动演进：prior（先验）-> provisional（初步）-> fitted（已充分拟合）。',
              ],
            },
          ],
        },
        {
          id: 'swarm',
          label: '原生 Swarm',
          title: '原生 AGY Swarm 协同观测协议',
          intro:
            'AGY-HUD 直接只读扫描 <appDataDir>/brain/<coordinator_conv_id>/.system_generated/swarm/ 下的原生协同文件，基于 mtime 缓存实现近零开销，并支持从任意 Worker 反向定位协调者。',
          blocks: [
            {
              heading: '只读解析的本地文件',
              table: {
                headers: ['文件名', '提取的遥测信息'],
                rows: [
                  ['swarm.json', 'Swarm 身份（swarm_id、backend、created_at），绑定协调者会话。'],
                  ['members.json', '标题、@rosterName、角色、运行阶段、wake_mode、killed 状态、模型与工作区模式。'],
                  ['plan.json', 'Swarm 目标、每个成员分配的任务摘要与线程分组。'],
                  ['board.jsonl', '有界尾部读取最新公告板 #seq、各成员最近发言摘要与时间戳。'],
                ],
              },
            },
          ],
        },
        {
          id: 'metrics',
          label: '指标与瀑布图',
          title: '吞吐、延迟与上下文定义',
          intro:
            '将真实模型流式生成速度与首字等待、单包缓冲尖峰彻底解耦，确保每一次会话复盘都真实可靠。',
          blocks: [
            {
              heading: '核心指标定义',
              table: {
                headers: ['指标', '定义与口径'],
                rows: [
                  ['GEN TPS', '输出 Token / 首字后流式耗时（f12），剔除单包 BUF 异常尖峰。'],
                  ['E2E TPS', '输出 Token / (TTFT f11 + 流式耗时 f12)，反映用户实际体感速度。'],
                  ['TTFT', '首字延迟（gen_metadata.f1.f11），3s 预警、10s 慢响应高亮。'],
                  ['TC-WAIT', '工具调用参数生成停顿耗时，独立于思考耗时（THK）与工具执行耗时。'],
                  ['剩余缓冲轮次', '基于近期单轮上下文增长中位数推算距离触发压缩的剩余轮数。'],
                ],
              },
            },
          ],
        },
        {
          id: 'quota',
          label: '配额与 Protobuf',
          title: 'IRLS 配额校准与 Protobuf 字段映射',
          intro:
            '把多库合并后的本地 Token 消耗与回环 LS RPC 的实时配额快照对齐，反推出真实模型倍率与剩余续航。',
          blocks: [
            {
              heading: 'Protobuf 关键字段（gen_metadata & steps）',
              table: {
                headers: ['字段路径', '解析内容', '回退字段'],
                rows: [
                  ['gen_metadata.f1.f19', '真实后端路由模型 ID（如 gemini-4-carbon）', 'UI 展示标签 (f1.f21)'],
                  ['gen_metadata.f1.f4', '缓存 (f5)、新增输入 (f2)、输出 (f3/f1)、思考 (f9)、可见 (f10)', '旧版用量 (f1.f17.f2)'],
                  ['gen_metadata.f1.f9.f10', '当前上下文 Token (f1) 与窗口上限 (f4)', 'cached + new_input'],
                  ['gen_metadata.f1.f11 / f12', 'TTFT 首字秒数 (f11) 与流式生成秒数 (f12)', '0.0s'],
                ],
              },
            },
          ],
        },
        {
          id: 'security',
          label: '安全与快捷键',
          title: '自更新安全模型与侧边栏快捷键',
          intro:
            '所有安装与自更新链路均遵循严格的供应链与文件系统安全约束，并提供全键盘高效导航。',
          blocks: [
            {
              heading: '侧边栏快捷键',
              table: {
                headers: ['快捷键', '操作'],
                rows: [
                  ['1 / 2 / 3', '快速切换实时、调用与账户三个主标签'],
                  ['/', '聚焦调用搜索框（自动切至调用标签）'],
                  ['Esc', '清空搜索条件、关闭悬浮气泡或取消选中'],
                  ['拖拽 / Ctrl+滚轮', '在趋势图上框选缩放或以光标为中心平滑缩放'],
                ],
              },
            },
            {
              heading: '更新与文件系统防线',
              bullets: [
                '仅允许从 github.com / codeload.github.com / api.github.com 拉取 skywalker512/agy-hud 发布包。',
                '拒绝绝对路径、.. 路径穿越、符号链接、超 2,000 文件或超 50MB 压缩包 / 64MB 解压体积。',
                '自动保护 --link 开发链接，未显式传 --force 时拒绝覆盖。',
              ],
            },
          ],
        },
      ],
    },
    footer: {
      tagline: '原生融入 Google Antigravity 的本地只读实时遥测驾驶舱。',
      license: 'MIT 开源协议',
      nodeReq: '需要 Node.js 22.18+ (node:sqlite)',
      linksTitle: '产品导航',
      resourcesTitle: '开源资源',
      repoLink: 'GitHub 仓库',
      releasesLink: '版本发布',
      issuesLink: '问题反馈',
      changelogLink: '更新日志',
    },
  },
};
