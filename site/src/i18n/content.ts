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
    /* ignore storage errors */
  }

  try {
    const langs = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || ''];
    for (const raw of langs) {
      const lower = String(raw || '').toLowerCase();
      if (lower.startsWith('zh')) return 'zh';
      if (lower.startsWith('en')) {
        // If user explicitly puts English first, still check timezone only when no explicit lang preference
        return 'en';
      }
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
    features: string;
    swarm: string;
    inspector: string;
    compare: string;
    install: string;
    docs: string;
    github: string;
    themeLight: string;
    themeDark: string;
  };
  hero: {
    eyebrow: string;
    headline: string;
    subhead: string;
    primaryCta: string;
    secondaryCta: string;
    interactiveHint: string;
    doctorTip: string;
    licenseTip: string;
    copied: string;
    copy: string;
    autoDetected: string;
    tabs: {
      unix: string;
      windows: string;
      source: string;
      devlink: string;
    };
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
      vsAvg: string;
      sustained: string;
      inclTtft: string;
      ctxTitle: string;
      ctxHeadroom: string;
      ctxCacheAge: string;
      hoverSegment: string;
      swarmTitle: string;
      swarmWorking: string;
      swarmWaiting: string;
      swarmRollup: string;
      swarmBoard: string;
      clickWorkerHint: string;
      lastPost: string;
    };
    calls: {
      trendTitle: string;
      callsUnit: string;
      viewingRange: string;
      followLive: string;
      latest: string;
      avg: string;
      p95: string;
      peak: string;
      brushHint: string;
      inspectorTitle: string;
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
      resetsIn: string;
      runwayEta: string;
      rulesTitle: string;
      oosErr: string;
      remoteGap: string;
      heatmapTitle: string;
      heatmapSub: string;
      hoverDayHint: string;
      updateTitle: string;
      updateInstalled: string;
      updateAvail: string;
      checkBtn: string;
      updateBtn: string;
      updating: string;
      updatedOk: string;
      reloadNote: string;
    };
  };
  proof: Array<{
    value: string;
    label: string;
    sub: string;
  }>;
  bento: {
    kicker: string;
    title: string;
    subtitle: string;
    flagshipBadge: string;
    cards: {
      swarm: {
        title: string;
        desc: string;
        bullets: string[];
      };
      modelSpeed: {
        title: string;
        desc: string;
        uiAlias: string;
        actualRouted: string;
      };
      contextXray: {
        title: string;
        desc: string;
        headroom: string;
        cacheFresh: string;
      };
      waterfall: {
        title: string;
        desc: string;
        bullets: string[];
      };
      quotaFitter: {
        title: string;
        desc: string;
        oosBadge: string;
      };
      multiStore: {
        title: string;
        desc: string;
        cacheSaved: string;
      };
    };
  };
  arch: {
    kicker: string;
    title: string;
    subtitle: string;
    sourcesTitle: string;
    src1Title: string;
    src1Sub: string;
    src2Title: string;
    src2Sub: string;
    src3Title: string;
    src3Sub: string;
    coreTitle: string;
    coreSub: string;
    coreBadge: string;
    uiTitle: string;
    uiSub: string;
    uiBadge: string;
    readOnlyLabel: string;
    etagLabel: string;
    pillars: Array<{
      title: string;
      desc: string;
    }>;
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
  installGuide: {
    kicker: string;
    title: string;
    subtitle: string;
    steps: Array<{
      num: string;
      title: string;
      desc: string;
      cmd: string;
    }>;
    doctorTitle: string;
    doctorSubtitle: string;
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
  };
}

export const COPY: Record<Locale, SiteCopy> = {
  en: {
    nav: {
      features: 'Features',
      swarm: 'Swarm',
      inspector: 'Inspector',
      compare: 'Compare',
      install: 'Install',
      docs: 'Docs',
      github: 'GitHub',
      themeLight: 'Switch to light theme',
      themeDark: 'Switch to dark theme',
    },
    hero: {
      eyebrow: 'Zero-Proxy · Native Swarm Telemetry · Node 22.18+ node:sqlite',
      headline: 'Mission control for Google Antigravity.',
      subhead:
        'Live GEN vs E2E speed, TTFT waterfalls, actual routed model IDs (f19), context window X-ray, calibrated 5h/7d quota runway, and first-class native multi-agent Swarm observability — zero proxy, zero runtime deps.',
      primaryCta: 'Install in 10 seconds',
      secondaryCta: 'Explore Docs',
      interactiveHint: 'Interactive Side-Pane Simulator — click tabs, brush ranges, workers & waterfall',
      doctorTip: 'Verify environment with node plugin/install.mjs --doctor',
      licenseTip: 'MIT License · macOS / Linux / Windows',
      copied: 'Copied',
      copy: 'Copy',
      autoDetected: 'Detected',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows (PowerShell)',
        source: 'Source (Node)',
        devlink: 'Dev Link',
      },
    },
    sim: {
      paneTitle: 'AGY-HUD',
      sessionName: 'Swarm: Commercial Upgrade',
      statusGen: 'GEN',
      tabLive: 'Live',
      tabCalls: 'Calls',
      tabAccount: 'Account',
      shortcutHint: 'Keys 1 · 2 · 3',
      live: {
        genLabel: 'GEN SPEED',
        e2eLabel: 'E2E SPEED',
        vsAvg: 'vs avg',
        sustained: 'Post-TTFT stream',
        inclTtft: 'Incl. TTFT 1.38s',
        ctxTitle: 'CONTEXT WINDOW X-RAY',
        ctxHeadroom: '~14t headroom',
        ctxCacheAge: 'Cache 42s fresh',
        hoverSegment: 'Hover any segment to inspect token footprint',
        swarmTitle: 'SWARM COCKPIT',
        swarmWorking: '2 working',
        swarmWaiting: '1 waiting',
        swarmRollup: '38 calls · 46.3k out · $1.29 · 5h -0.86%',
        swarmBoard: 'Board #24',
        clickWorkerHint: 'Click a worker to inspect task & latest board post',
        lastPost: 'Latest post',
      },
      calls: {
        trendTitle: 'CALL TREND',
        callsUnit: 'calls',
        viewingRange: 'Viewing',
        followLive: 'Follow Live',
        latest: 'LATEST',
        avg: 'AVG',
        p95: 'P95',
        peak: 'PEAK',
        brushHint: 'Click minimap to pan · Click plot to inspect call',
        inspectorTitle: 'CALL INSPECTOR',
        tabOverview: 'Overview',
        tabTools: 'Tools',
        tabRaw: 'Raw',
        waterfallTitle: 'TIMING WATERFALL',
        tokenCompTitle: 'TOKEN & COST COMPOSITION',
        cached: 'Cached',
        newInput: 'New Input',
        thinking: 'Think',
        visible: 'Reply',
        copyMd: 'MD',
        copiedMd: 'Copied',
        ttft: 'TTFT',
        think: 'Think',
        toolGen: 'Tool Gen',
        stream: 'Stream',
        saved: 'Saved',
      },
      account: {
        quotaTitle: 'QUOTA RUNWAY',
        win5h: '5h Rolling Pool',
        win7d: '7d Weekly Pool',
        resetsIn: 'Resets in',
        runwayEta: 'ETA',
        rulesTitle: 'CALIBRATED k-MULTIPLIERS',
        oosErr: 'OOS err ±1.8%',
        remoteGap: 'Remote gap 1.2%',
        heatmapTitle: '16-WEEK ACTIVITY (APP + CLI)',
        heatmapSub: '112 days · $42.80 API equiv · $18.40 cache saved',
        hoverDayHint: 'Hover a day cell for token volume',
        updateTitle: 'PLUGIN & SELF-UPDATE',
        updateInstalled: 'Installed v1.2.0',
        updateAvail: 'v1.2.1 available',
        checkBtn: 'Check',
        updateBtn: 'Update Now',
        updating: 'Staging & verifying…',
        updatedOk: 'Atomically upgraded to v1.2.1',
        reloadNote: 'GitHub allowlist + zip-slip verified · Reload ready',
      },
    },
    proof: [
      { value: '0', label: 'Runtime Dependencies', sub: 'Built-in Node 22.18+ node:sqlite + sidecar_sdk' },
      { value: '0 ms', label: 'API Proxy Latency', sub: 'Read-only SQLite + loopback LS RPC, zero MITM' },
      { value: '100%', label: 'Local Privacy', sub: 'Prompts & traces never leave your machine' },
      { value: '1st', label: 'Native AGY Swarm HUD', sub: 'Reads swarm.json, members.json, plan.json & board.jsonl' },
    ],
    bento: {
      kicker: 'Built for Agentic Depth',
      title: 'Every signal Antigravity hides — surfaced in real time.',
      subtitle:
        'From multi-agent swarm rosters to sub-second TTFT waterfalls and empirical quota calibration, AGY-HUD turns opaque runs into verifiable telemetry.',
      flagshipBadge: 'Flagship · First-in-Ecosystem',
      cards: {
        swarm: {
          title: 'Native AGY Swarm Cockpit',
          desc: 'Directly reads Antigravity’s local swarm files to display @rosterName, live working/waiting/killed states, plan.json task titles, thread groups, Board #seq, and rolled-up spend/quota across coordinator and workers.',
          bullets: [
            'Mtime-cached read-only parser (near-zero polling CPU)',
            'Worker-to-coordinator reverse lookup & 1-click session jump',
            'Aggregated swarm calls, output tokens, USD cost & 5h/7d burn',
          ],
        },
        modelSpeed: {
          title: 'Routed Model Truth (f19) & GEN vs E2E',
          desc: 'Prioritizes gen_metadata.f1.f19 to expose the exact backend routed model ID instead of opaque UI aliases, and isolates single-packet BUF turns so average speed never exceeds peak.',
          uiAlias: 'UI Display Alias',
          actualRouted: 'Actual Routed f19',
        },
        contextXray: {
          title: 'Context Window X-Ray',
          desc: 'Breaks active prompt weight into 5 buckets with per-tool token footprint, median-delta headroom turns before compaction, and live prompt cache freshness age.',
          headroom: '~14 turns left',
          cacheFresh: 'Cache fresh 42s',
        },
        waterfall: {
          title: 'Historical Brush/Zoom & OpenRouter-Style Waterfall',
          desc: 'Navigate 100+ calls effortlessly with range presets (20/50/100/All), an interactive minimap brush, canvas drag-to-zoom, Follow Live pinning, and click-to-inspect call waterfalls.',
          bullets: [
            'Proportional TTFT / Think / Tool Gen (TC-WAIT) / Stream bar',
            'Prefix Cache vs New Input & Thinking vs Visible token bar',
            'Instant search (/), anomaly filter chips & 1-click MD/JSON export',
          ],
        },
        quotaFitter: {
          title: 'Empirical k-Fitter & 5h / 7d Runway',
          desc: 'Fits per-model k-multipliers and credit tank capacities against observed quota deltas, surfacing out-of-sample error bands, remote spend gaps, and burn-rate exhaustion ETAs.',
          oosBadge: 'OOS Validated',
        },
        multiStore: {
          title: 'Unified App + CLI Accounting & 16-Week Heatmap',
          desc: 'Auto-discovers sibling Antigravity App, CLI, ACP, and IDE SQLite stores via non-blocking background indexing to unify spend, cache savings, and daily intensity.',
          cacheSaved: 'Cache saved',
        },
      },
    },
    arch: {
      kicker: 'Zero-Proxy Architecture',
      title: 'Read-only by design. Zero network hops on your inference path.',
      subtitle:
        'Unlike MITM proxy monitors that intercept TLS traffic and add latency or break certificates, AGY-HUD observes Antigravity strictly from local disk and loopback IPC.',
      sourcesTitle: 'Local Read-Only Telemetry Sources',
      src1Title: 'SQLite Conversations (-wal)',
      src1Sub: '~/.gemini/antigravity/conversations/*.db (gen_metadata + steps)',
      src2Title: 'Loopback LS RPC',
      src2Sub: '127.0.0.1 live streaming steps & 5h/7d quota pools',
      src3Title: 'Brain Swarm Metadata',
      src3Sub: 'swarm.json · members.json · plan.json · board.jsonl',
      coreTitle: 'AGY-HUD Sidecar',
      coreSub: 'Node 22.18+ node:sqlite · zero npm runtime deps',
      coreBadge: 'Pure Local Process',
      uiTitle: 'Antigravity Side-Pane HUD',
      uiSub: 'Preact + Tailwind v4 · sub-55KB bundle · EN / 中文',
      uiBadge: 'Host Theme Sync',
      readOnlyLabel: 'Read-Only + Loopback',
      etagLabel: 'ETag Adaptive Poll (500ms / 1500ms)',
      pillars: [
        {
          title: 'Zero Prompt Exfiltration',
          desc: 'Zero telemetry servers, zero analytics beacons, zero cloud logins. All parsing runs locally inside Antigravity’s sidecar.',
        },
        {
          title: 'Zero Proxy Overhead',
          desc: 'Never sits between Antigravity and model APIs. No CA certs, no env vars, no broken streaming, 0 ms latency added.',
        },
        {
          title: 'Hardened Self-Updater',
          desc: 'Optional updates enforce strict GitHub-only HTTPS allowlists, redirect CDN checks, zip-slip/symlink rejection, and 50MB/64MB extraction caps.',
        },
        {
          title: 'Atomic Staged Rollback',
          desc: 'Installs and upgrades stage into a temp directory, verify plugin.json + UI assets, swap atomically, and restore the backup automatically on any error.',
        },
      ],
    },
    compare: {
      kicker: 'Competitive Landscape',
      title: 'Built specifically for Antigravity — without proxy trade-offs.',
      subtitle:
        'See how AGY-HUD compares to generic API proxy monitors, offline CLI log aggregators, and single-line terminal statusbars.',
      cols: ['Capability', 'AGY-HUD', 'API Proxy Monitors', 'CLI Log Aggregators', 'Basic Statuslines'],
      rows: [
        {
          feature: 'Zero-Proxy Local Read-Only Telemetry',
          agyHud: 'Native node:sqlite + LS RPC',
          proxy: 'MITM proxy required',
          cliAgg: 'Offline JSONL / SQLite',
          statusline: 'Stdin hook / basic',
        },
        {
          feature: 'Native AGY Multi-Agent Swarm Cockpit',
          agyHud: 'Full roster, state, plan & board',
          proxy: 'None',
          cliAgg: 'None',
          statusline: 'Count only / none',
        },
        {
          feature: 'Actual Routed Backend Model ID (f19)',
          agyHud: 'Exact protobuf f19 decoded',
          proxy: 'Request alias only',
          cliAgg: 'Log alias only',
          statusline: 'Display label only',
        },
        {
          feature: 'GEN vs E2E TPS + BUF Exclusion',
          agyHud: 'Sustained vs E2E + BUF filter',
          proxy: 'Rough stream avg',
          cliAgg: 'No live speed',
          statusline: 'None',
        },
        {
          feature: 'OpenRouter-Style Waterfall + Token Bar',
          agyHud: 'TTFT / Think / Tool Gen / Stream',
          proxy: 'Partial latency only',
          cliAgg: 'Tabular text only',
          statusline: 'None',
        },
        {
          feature: 'Historical Minimap Brush & Drag-to-Zoom',
          agyHud: 'Full session + Follow Live',
          proxy: 'Web dashboard only',
          cliAgg: 'None',
          statusline: 'None',
        },
        {
          feature: '5h / 7d Quota + Empirical k-Fitter',
          agyHud: 'OOS-validated k + runway ETA',
          proxy: 'None',
          cliAgg: 'API list price only',
          statusline: 'Raw % only',
        },
        {
          feature: 'Unified App + CLI 16-Week Heatmap',
          agyHud: 'Auto-discovered multi-store',
          proxy: 'Proxied traffic only',
          cliAgg: 'CLI logs only',
          statusline: 'Current session only',
        },
        {
          feature: 'Cross-Platform 1-Line Install + Self-Update',
          agyHud: 'sh / ps1 + --doctor + in-app',
          proxy: 'Manual proxy config',
          cliAgg: 'npm / npx CLI',
          statusline: 'Manual shell config',
        },
      ],
    },
    installGuide: {
      kicker: 'Install & Verify',
      title: 'Up and running in one command. Self-verifying on every OS.',
      subtitle:
        'Requires Node.js 22.18+ (for built-in node:sqlite). Install atomically into ~/.gemini/config/plugins/agy-hud, run --doctor to verify every prerequisite, and upgrade anytime in-app or via CLI.',
      steps: [
        {
          num: '01',
          title: 'One-Line Cross-Platform Install',
          desc: 'Auto-detects macOS, Linux, or Windows, checks Node 22.18+, downloads the verified release from GitHub, and runs an atomic staged install.',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh',
        },
        {
          num: '02',
          title: 'Run --doctor Diagnostics',
          desc: 'Checks Node version, node:sqlite availability, plugin.json manifest, prebuilt UI bundle integrity, and Antigravity store discovery.',
          cmd: 'node plugin/install.mjs --doctor',
        },
        {
          num: '03',
          title: '1-Click In-App or CLI Self-Update',
          desc: 'Upgrade directly from the Account tab or run --update with GitHub-only allowlist checks, zip-slip protection, and automatic rollback.',
          cmd: 'node plugin/install.mjs --update',
        },
      ],
      doctorTitle: 'Terminal Preview — node plugin/install.mjs --doctor',
      doctorSubtitle: 'Zero external runtime deps · JSON output available via --json',
    },
    docs: {
      kicker: 'Documentation Hub',
      title: 'Everything you need — right on this page.',
      subtitle:
        'Technical reference for installation, native Swarm observability, metric formulas, quota calibration math, protobuf fields, and keyboard shortcuts.',
      tabs: [
        {
          id: 'quickstart',
          label: 'Quick Start & CLI',
          title: 'Quick Start, CLI Commands & Troubleshooting',
          intro:
            'AGY-HUD installs into ~/.gemini/config/plugins/agy-hud (or a custom directory via --target) with zero external runtime dependencies. It requires Node.js 22.18+ for built-in node:sqlite.',
          blocks: [
            {
              heading: 'Installer CLI Commands (plugin/install.mjs)',
              table: {
                headers: ['Command / Flag', 'Behavior'],
                rows: [
                  ['node plugin/install.mjs --install', 'Default. Staged atomic copy into ~/.gemini/config/plugins/agy-hud.'],
                  ['node plugin/install.mjs --link', 'Creates a symlink/junction to plugin/ for live development hot-reload.'],
                  ['node plugin/install.mjs --doctor [--json]', 'Validates Node 22.18+, node:sqlite, manifest, UI bundle & local stores.'],
                  ['node plugin/install.mjs --check-update [--json]', 'Queries GitHub releases/tags for newer SemVer releases.'],
                  ['node plugin/install.mjs --update [--force] [--ref <tag>]', 'Downloads verified GitHub archive and atomically swaps with rollback.'],
                  ['node plugin/install.mjs --uninstall', 'Cleanly removes the installed plugin directory or symlink.'],
                  ['--target <dir> · --no-build', 'Override plugin target directory or skip auto-building missing UI assets.'],
                ],
              },
            },
            {
              heading: 'Optional Environment Variables (install.sh / install.ps1)',
              bullets: [
                'AGY_HUD_VERSION: Pin a specific release tag (e.g. 1.2.0 or v1.2.0).',
                'AGY_HUD_REF: Install from a specific git branch or commit ref (e.g. main).',
                'AGY_HUD_TARGET: Custom plugin installation directory.',
                'Reload or restart Google Antigravity after initial install so the side-pane icon mounts immediately.',
              ],
            },
          ],
        },
        {
          id: 'swarm',
          label: 'Native Swarm',
          title: 'First-Class Native AGY Swarm Observability',
          intro:
            'AGY-HUD directly reads Antigravity’s local swarm artifacts under <appDataDir>/brain/<coordinator_conv_id>/.system_generated/swarm/ with mtime caching, zero polling bloat, and reverse worker-to-coordinator lookup.',
          blocks: [
            {
              heading: 'On-Disk Swarm Artifacts Parsed (Read-Only)',
              table: {
                headers: ['File', 'Extracted Telemetry'],
                rows: [
                  ['swarm.json', 'Swarm identity (swarm_id, backend, created_at) linking the coordinator conversation.'],
                  ['members.json', 'Swarm title, @rosterName, role, phase, desired_state, wake_mode, killed flag, applied_model, workspace_mode (inherit/share/branch).'],
                  ['plan.json', 'Swarm goal title/line, per-member task summaries (tasks[rosterName]), and thread groupings (threads[]).'],
                  ['board.jsonl', 'Bounded tail read for highest Board #seq, per-agent latest message snippet, timestamp, and fallback brief preview.'],
                ],
              },
            },
            {
              heading: 'Live State Machine & Navigation',
              bullets: [
                'working: phase === RUNNING and wake_mode === working (pulsing green indicator, sorted first).',
                'waiting: active member parked on the board awaiting @mention or message (muted indicator).',
                'stopped / killed: terminated or permanently killed workers (clearly badged and dimmed).',
                'Worker Breadcrumb: Opening any worker conversation upgrades SessionRelBar to show ← @coordinator · Swarm Title + your @rosterName and live state.',
              ],
            },
          ],
        },
        {
          id: 'metrics',
          label: 'Metrics & Waterfall',
          title: 'Metrics, Speed Diagnostics & OpenRouter-Style Waterfall',
          intro:
            'AGY-HUD separates true model generation throughput from TTFT latency and single-packet buffered spikes, giving you accurate latency attribution on every turn.',
          blocks: [
            {
              heading: 'Core Speed, Latency & Context Definitions',
              table: {
                headers: ['Metric', 'Formula / Interpretation'],
                rows: [
                  ['GEN TPS', 'Output tokens / post-TTFT streaming duration (f12). Reflects true sustained generation velocity.'],
                  ['E2E TPS', 'Output tokens / (TTFT f11 + streaming duration f12). Reflects user-perceived end-to-end throughput.'],
                  ['BUF Flag', 'Single-packet buffered responses excluded from PEAK TPS and weighted AVG GEN so averages never exceed peak.'],
                  ['TTFT', 'Time to first token (gen_metadata.f1.f11). Colored by SLA thresholds (3s warn, 10s slow).'],
                  ['TC-WAIT', 'Tool-call generation stall duration separated from thinking (THK) and tool execution time.'],
                  ['Headroom Turns', 'Estimated turns remaining before context compaction based on median per-turn token growth.'],
                ],
              },
            },
            {
              heading: 'Timing Waterfall & Token Composition Bar',
              bullets: [
                'Timing Waterfall splits every call proportionally into TTFT Wait (blue), Thinking (violet), Tool Gen / TC-WAIT (amber), and Reply Stream (emerald).',
                'Token Composition Bar contrasts Prompt Prefix (Cached vs New Input) against Output (Thinking vs Visible Reply) alongside exact USD cache savings.',
                'Call Explorer supports instant search (/), anomaly chips (Slow TTFT, Low Cache, Stall/Buf, Compacts), metric sorting, and 1-click Markdown/JSON export.',
              ],
            },
          ],
        },
        {
          id: 'quota',
          label: 'Quota Calibration',
          title: '5h / 7d Quota Windows & Empirical k-Multiplier Fitter',
          intro:
            'Antigravity enforces rolling 5-hour and 7-day quota pools where heavy models consume credits faster than flash models. AGY-HUD fits empirical per-model multipliers from your real local history.',
          blocks: [
            {
              heading: 'How Calibration Works (quota-fitter.ts)',
              bullets: [
                'Observes local token usage paired with loopback LS RPC quota pool snapshots (5h rolling and 7d weekly remaining percentages).',
                'Fits per-model k-multipliers (e.g., Carbon ~3.0×, Hydrogen ~1.0×, Flash-K ~0.4×) and effective credit tank capacity.',
                'Computes out-of-sample (OOS) error bands so you know whether a multiplier is fitted or provisional.',
                'Estimates unattributed remote spend gaps (usage from other machines or IDE windows sharing the same account) and calculates burn-rate exhaustion ETAs.',
              ],
            },
          ],
        },
        {
          id: 'protobuf',
          label: 'Protobuf & Stores',
          title: 'Local SQLite Schema, Protobuf Map & Multi-Store Discovery',
          intro:
            'AGY-HUD reads ~/.gemini/antigravity/conversations/<uuid>.db (and -wal) in strict read-only mode via Node 22.18+ built-in node:sqlite, plus auto-discovers sibling App, CLI, ACP, and IDE stores.',
          blocks: [
            {
              heading: 'Decoded Protobuf Field Map (gen_metadata & steps)',
              table: {
                headers: ['Field Path', 'Decoded Telemetry', 'Fallback'],
                rows: [
                  ['gen_metadata.f1.f19', 'Actual routed backend model ID (e.g. gemini-4-carbon)', 'UI display label (f1.f21)'],
                  ['gen_metadata.f1.f4', 'Cached (f5), new input (f2), output (f3/f1), thinking (f9), visible (f10)', 'Legacy usage (f1.f17.f2)'],
                  ['gen_metadata.f1.f9.f10', 'Active context tokens (f1) and window limit (f4, e.g. 256,000)', 'cached + new_input; model table'],
                  ['gen_metadata.f1.f11 / f12', 'TTFT seconds (f11) and streaming duration seconds (f12)', '0.0s'],
                  ['steps (status != 3)', 'Live generation timer (step_type = 15), TOOL state, timestamps via f1.f20', 'Idle / STANDBY state'],
                ],
              },
            },
          ],
        },
        {
          id: 'security',
          label: 'Security & Shortcuts',
          title: 'Self-Update Security Model & Keyboard Ergonomics',
          intro:
            'Both the cross-platform shell installers and the in-app self-updater follow strict supply-chain and filesystem safety invariants.',
          blocks: [
            {
              heading: 'Security Guardrails',
              bullets: [
                'Strict HTTPS GitHub-Only Allowlist: Downloads only from github.com, codeload.github.com, or api.github.com scoped to skywalker512/agy-hud (plus verified GitHub release CDN redirect hops).',
                'Archive Path & Zip-Slip Defense: Rejects absolute paths, drive letters, null bytes, .. traversal segments, symlinks/special files, >2,000 files, or >50MB archive / >64MB extracted payloads.',
                'Atomic Staging & Rollback: Validates plugin.json, sidecar.json, server.ts, and prebuilt UI files before swapping; restores the previous install automatically if anything fails.',
                'Dev-Symlink Protection: Refuses to overwrite a --link development checkout unless --force is explicitly provided.',
              ],
            },
            {
              heading: 'Side-Pane Keyboard Shortcuts',
              table: {
                headers: ['Shortcut', 'Action'],
                rows: [
                  ['1 / 2 / 3', 'Switch between Live, Calls, and Account tabs'],
                  ['/', 'Focus Call Explorer search input (auto-switches to Calls tab)'],
                  ['Esc', 'Clear search filter, close menu, or dismiss active hover'],
                  ['Drag on Chart / Minimap', 'Drag-to-zoom time-series range or scrub full historical session'],
                  ['Ctrl/Meta + Wheel · Double-Click', 'Zoom smoothly around cursor without hijacking vertical scroll; double-click minimap to reset'],
                ],
              },
            },
          ],
        },
      ],
    },
    footer: {
      tagline: 'Zero-proxy real-time telemetry & native Swarm mission control for Google Antigravity.',
      license: 'MIT License',
      nodeReq: 'Requires Node.js 22.18+ (node:sqlite)',
      linksTitle: 'Navigation',
      resourcesTitle: 'Resources',
      repoLink: 'GitHub Repository',
      releasesLink: 'Releases & Changelog',
      issuesLink: 'Report an Issue',
    },
  },
  zh: {
    nav: {
      features: '核心特性',
      swarm: 'Swarm 驾驶舱',
      inspector: '调用剖析',
      compare: '方案对比',
      install: '快速安装',
      docs: '文档中心',
      github: 'GitHub',
      themeLight: '切换至浅色主题',
      themeDark: '切换至深色主题',
    },
    hero: {
      eyebrow: '零代理 · 原生 Swarm 遥测 · Node 22.18+ node:sqlite',
      headline: 'Google Antigravity 的实时遥测驾驶舱。',
      subhead:
        '实时 GEN / E2E 吞吐、TTFT 阶段瀑布图、真实路由模型 ID（f19）、上下文窗口 X 光透视、5h/7d 配额校准续航，以及业界首个原生多智能体 Swarm 监控面板——零代理、零运行时依赖。',
      primaryCta: '10 秒一键安装',
      secondaryCta: '浏览技术文档',
      interactiveHint: '可交互侧边栏模拟器 — 点击切换标签、刷选历史区间、查看 Worker 与瀑布图',
      doctorTip: '运行 node plugin/install.mjs --doctor 一键自检环境',
      licenseTip: 'MIT 开源协议 · 支持 macOS / Linux / Windows',
      copied: '已复制',
      copy: '复制',
      autoDetected: '已自动识别',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows (PowerShell)',
        source: '源码安装 (Node)',
        devlink: '开发软链',
      },
    },
    sim: {
      paneTitle: 'AGY-HUD',
      sessionName: 'Swarm: 商业化升级任务',
      statusGen: 'GEN',
      tabLive: '实时',
      tabCalls: '调用',
      tabAccount: '账户',
      shortcutHint: '快捷键 1 · 2 · 3',
      live: {
        genLabel: '生成速率 GEN',
        e2eLabel: '端到端 E2E',
        vsAvg: '对比均值',
        sustained: '首字后持续流式速率',
        inclTtft: '含 TTFT 1.38s',
        ctxTitle: '上下文窗口 X 光透视',
        ctxHeadroom: '约剩 14 轮余量',
        ctxCacheAge: '缓存活跃 42s',
        hoverSegment: '悬停任意色段查看 Token 组成明细',
        swarmTitle: 'SWARM 协同驾驶舱',
        swarmWorking: '2 运行中',
        swarmWaiting: '1 等待中',
        swarmRollup: '38 次调用 · 46.3k 输出 · $1.29 · 5h -0.86%',
        swarmBoard: '公告板 #24',
        clickWorkerHint: '点击任意 Worker 查看任务目标与最新公告',
        lastPost: '最新动态',
      },
      calls: {
        trendTitle: '调用趋势图',
        callsUnit: '次调用',
        viewingRange: '当前区间',
        followLive: '跟随实时',
        latest: '最新',
        avg: '均值',
        p95: 'P95',
        peak: '峰值',
        brushHint: '点击缩略图平移区间 · 点击数据点剖析对应调用',
        inspectorTitle: '调用详情剖析器',
        tabOverview: '总览',
        tabTools: '工具',
        tabRaw: '原始 JSON',
        waterfallTitle: '阶段耗时瀑布图',
        tokenCompTitle: 'TOKEN 与成本构成',
        cached: '缓存命中',
        newInput: '新增输入',
        thinking: '思考',
        visible: '回复',
        copyMd: '复制 MD',
        copiedMd: '已复制',
        ttft: 'TTFT',
        think: '思考',
        toolGen: '工具生成',
        stream: '流式输出',
        saved: '缓存省下',
      },
      account: {
        quotaTitle: '配额窗口与续航预测',
        win5h: '5h 滚动配额池',
        win7d: '7d 每周配额池',
        resetsIn: '重置倒计时',
        runwayEta: '预计耗尽',
        rulesTitle: '经验 k 倍率校准',
        oosErr: '样本外误差 ±1.8%',
        remoteGap: '远端偏差 1.2%',
        heatmapTitle: '16 周活跃热力图（App + CLI）',
        heatmapSub: '112 天 · $42.80 API 等效消耗 · 缓存节省 $18.40',
        hoverDayHint: '悬停日期格查看当日 Token 与消耗',
        updateTitle: '插件版本与安全自更新',
        updateInstalled: '已安装 v1.2.0',
        updateAvail: '发现新版本 v1.2.1',
        checkBtn: '检查更新',
        updateBtn: '立即更新',
        updating: '校验白名单并原子暂存中…',
        updatedOk: '已原子升级至 v1.2.1',
        reloadNote: '已通过 GitHub 白名单与防路径穿越校验 · 可直接重载',
      },
    },
    proof: [
      { value: '0', label: '第三方运行时依赖', sub: '纯 Node 22.18+ 内置 node:sqlite + sidecar_sdk' },
      { value: '0 ms', label: 'API 代理延迟', sub: '本地只读 SQLite + 回环 LS RPC，拒绝 MITM 劫持' },
      { value: '100%', label: '本地只读隐私', sub: '提示词、代码与 Trace 永不离开本机' },
      { value: '首个', label: '原生 AGY Swarm 面板', sub: '直读 swarm.json、members.json、plan.json 与 board.jsonl' },
    ],
    bento: {
      kicker: '专为 Agent 工程深度打造',
      title: '把 Antigravity 隐藏的每个关键信号，实时摊开在眼前。',
      subtitle:
        '从多智能体 Swarm 实时状态到毫秒级 TTFT 瀑布图与经验配额校准，AGY-HUD 让每一次黑盒执行都变成可验证的工程遥测。',
      flagshipBadge: '旗舰亮点 · 生态首发',
      cards: {
        swarm: {
          title: '原生 AGY Swarm 协同驾驶舱',
          desc: '直接读取 Antigravity 本地 Swarm 元数据，实时呈现 @rosterName、working/waiting/killed 状态、plan.json 任务标题、线程分组、Board #seq 与主从汇总成本/配额。',
          bullets: [
            '基于文件 mtime 缓存的只读解析器（稳态轮询近零 CPU 开销）',
            'Worker → Coordinator 反向索引，随时一键跳转主控会话',
            '实时汇总整个 Swarm 的调用次数、输出 Token、美元费用与 5h/7d 消耗',
          ],
        },
        modelSpeed: {
          title: '真实路由模型（f19）与 GEN / E2E 测速',
          desc: '优先解码 gen_metadata.f1.f19 暴露底层真实路由模型，告别模糊的界面别名；自动剔除单包缓冲 BUF 尖刺，确保均值永不高于峰值。',
          uiAlias: '界面展示别名',
          actualRouted: '真实路由 f19',
        },
        contextXray: {
          title: '上下文窗口 X 光透视',
          desc: '将当前上下文拆解为 5 大结构桶并统计单工具 Token 占用，结合中位数增量估算距离压缩的剩余轮次与 Prompt Cache 保鲜时长。',
          headroom: '约剩 14 轮',
          cacheFresh: '缓存保鲜 42s',
        },
        waterfall: {
          title: '历史趋势刷选缩放与 OpenRouter 级瀑布剖析',
          desc: '支持 20/50/100/All 区间预设、交互式缩略图刷选、画布拖拽放大与 Follow Live 智能锁尾；点击任意数据点即可展开阶段瀑布图。',
          bullets: [
            '按比例可视化 TTFT / 思考 / 工具生成（TC-WAIT）/ 流式输出耗时',
            '对比前缀缓存命中与新增输入、思考与可见回复的 Token 比例',
            '支持快捷键 / 实时检索、异常过滤芯片与一键导出 Markdown / JSON',
          ],
        },
        quotaFitter: {
          title: '经验 k 倍率校准与 5h / 7d 续航预测',
          desc: '根据实测配额变化自动拟合各模型 k 倍率与等效配额池容量，输出样本外误差区间、跨设备远端消耗偏差与耗尽倒计时。',
          oosBadge: '样本外校验',
        },
        multiStore: {
          title: 'App + CLI 统一账单与 16 周活跃热力图',
          desc: '后台非阻塞自动发现本机 Antigravity App、CLI、ACP 与 IDE 的多个会话库，汇总 API 等效费用、缓存省钱额与每日强度热力图。',
          cacheSaved: '缓存已省',
        },
      },
    },
    arch: {
      kicker: '零代理本地优先架构',
      title: '天生只读，推理链路上零额外网络跳转。',
      subtitle:
        '与需要配置 HTTPS 证书、拦截流式响应的 MITM 代理监控器不同，AGY-HUD 仅通过只读本地文件与本机回环 IPC 获取全部遥测信号。',
      sourcesTitle: '本机只读遥测数据源',
      src1Title: 'SQLite 会话库 (-wal)',
      src1Sub: '~/.gemini/antigravity/conversations/*.db (gen_metadata + steps)',
      src2Title: '本机回环 LS RPC',
      src2Sub: '127.0.0.1 实时流式步骤与 5h / 7d 配额池',
      src3Title: 'Brain Swarm 元数据',
      src3Sub: 'swarm.json · members.json · plan.json · board.jsonl',
      coreTitle: 'AGY-HUD Sidecar 后端',
      coreSub: 'Node 22.18+ node:sqlite · 零 npm 运行时依赖',
      coreBadge: '纯本地进程',
      uiTitle: 'Antigravity 侧边栏 HUD',
      uiSub: 'Preact + Tailwind v4 · <55KB 轻量包 · 中英自动切换',
      uiBadge: '宿主主题同步',
      readOnlyLabel: '本地只读 + 回环通信',
      etagLabel: 'ETag 自适应轮询 (500ms / 1500ms)',
      pillars: [
        {
          title: '提示词零外发',
          desc: '无云端遥测后端、无埋点上报、无需登录账号。全部解码与分析均在本地 Sidecar 进程内完成。',
        },
        {
          title: '零代理延迟开销',
          desc: '绝不介入 Antigravity 与大模型 API 之间。无需信任根证书、无需修改环境变量，0 ms 额外延迟。',
        },
        {
          title: '高安全自更新校验',
          desc: '可选自更新强制限定 GitHub 官方 HTTPS 白名单、校验重定向 CDN、防御 Zip-Slip 与软链穿越，并设 50MB/64MB 解压上限。',
        },
        {
          title: '原子暂存与自动回滚',
          desc: '安装与升级先暂存并校验 plugin.json 及预构建 UI 完整性，原子替换目标目录；任意异常自动回滚至原备份。',
        },
      ],
    },
    compare: {
      kicker: '生态方案横评',
      title: '为 Google Antigravity 原生打造，拒绝代理妥协。',
      subtitle:
        '对比通用 API 代理监控、离线 CLI 日志统计工具与单行终端状态栏，一目了然工程差异。',
      cols: ['核心能力', 'AGY-HUD', 'API 代理监控器', 'CLI 日志统计器', '终端状态栏脚本'],
      rows: [
        {
          feature: '零代理本地只读遥测',
          agyHud: '原生 node:sqlite + LS RPC',
          proxy: '需配置 MITM 代理',
          cliAgg: '离线读取 JSONL / DB',
          statusline: 'Stdin 钩子 / 基础信息',
        },
        {
          feature: '原生 AGY 多智能体 Swarm 驾驶舱',
          agyHud: '完整名册、状态、计划与公告板',
          proxy: '无',
          cliAgg: '无',
          statusline: '仅计数或无',
        },
        {
          feature: '真实路由模型 ID (f19)',
          agyHud: '直解 Protobuf f19 真值',
          proxy: '仅请求别名',
          cliAgg: '仅日志别名',
          statusline: '仅界面名称',
        },
        {
          feature: 'GEN / E2E 分离测速 + BUF 剔除',
          agyHud: '持续速率 / E2E + BUF 过滤',
          proxy: '粗略流式均值',
          cliAgg: '无实时速度',
          statusline: '无',
        },
        {
          feature: 'OpenRouter 级瀑布图 + Token 构成条',
          agyHud: 'TTFT / 思考 / 工具生成 / 流式',
          proxy: '仅基础耗时',
          cliAgg: '纯文本表格',
          statusline: '无',
        },
        {
          feature: '历史缩略图刷选与拖拽缩放',
          agyHud: '全量会话历史 + Follow Live',
          proxy: '需另开网页后台',
          cliAgg: '无',
          statusline: '无',
        },
        {
          feature: '5h / 7d 配额 + 经验 k 倍率校准',
          agyHud: '样本外校验 k 值 + 续航倒计时',
          proxy: '无',
          cliAgg: '仅按官方 API 价估算',
          statusline: '仅原始百分比',
        },
        {
          feature: 'App + CLI 跨端 16 周热力图',
          agyHud: '后台自动发现多端本地库',
          proxy: '仅统计走代理流量',
          cliAgg: '仅统计 CLI 日志',
          statusline: '仅当前会话',
        },
        {
          feature: '全平台一键安装 + 诊断 + 自更新',
          agyHud: 'sh / ps1 + --doctor + 应用内更新',
          proxy: '手动配证书与端口',
          cliAgg: 'npm / npx 命令行',
          statusline: '手动改 Shell 配置',
        },
      ],
    },
    installGuide: {
      kicker: '安装与验证',
      title: '一条命令完成部署，跨平台内置环境自检。',
      subtitle:
        '仅需 Node.js 22.18+（内置 node:sqlite）。自动原子安装至 ~/.gemini/config/plugins/agy-hud，支持 --doctor 完整自检与应用内/命令行安全自更新。',
      steps: [
        {
          num: '01',
          title: '跨平台一键安装',
          desc: '自动识别 macOS、Linux 或 Windows，校验 Node 22.18+，从 GitHub 下载验证过的发布包并原子暂存安装。',
          cmd: 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh',
        },
        {
          num: '02',
          title: '运行 --doctor 环境诊断',
          desc: '逐项检查 Node 版本、node:sqlite 模块、plugin.json 清单、预构建 UI 资产完整性与 Antigravity 本地数据目录。',
          cmd: 'node plugin/install.mjs --doctor',
        },
        {
          num: '03',
          title: '应用内一键更新或 CLI 自更新',
          desc: '可在账户页直接一键升级，或执行 --update，全程受 GitHub 白名单、防 Zip-Slip 与失败自动回滚保护。',
          cmd: 'node plugin/install.mjs --update',
        },
      ],
      doctorTitle: '终端输出预览 — node plugin/install.mjs --doctor',
      doctorSubtitle: '零外部运行时依赖 · 支持 --json 输出机器可读报告',
    },
    docs: {
      kicker: '内嵌文档中心',
      title: '完整工程手册，无需跳转即可查阅。',
      subtitle:
        '涵盖跨平台安装与 CLI 参数、原生 Swarm 遥测架构、指标与瀑布图公式、配额校准数学、Protobuf 字段映射及安全与快捷键规范。',
      tabs: [
        {
          id: 'quickstart',
          label: '快速上手与 CLI',
          title: '快速安装、CLI 命令与常见问题排查',
          intro:
            'AGY-HUD 默认安装到 ~/.gemini/config/plugins/agy-hud（可通过 --target 自定义），无需任何第三方运行时依赖，仅依赖 Node.js 22.18+ 内置 node:sqlite。',
          blocks: [
            {
              heading: '安装器 CLI 命令一览（plugin/install.mjs）',
              table: {
                headers: ['命令 / 参数', '说明'],
                rows: [
                  ['node plugin/install.mjs --install', '默认命令。原子暂存并复制安装至 ~/.gemini/config/plugins/agy-hud。'],
                  ['node plugin/install.mjs --link', '创建软链/目录联接指向 plugin/，适合前端开发热重载。'],
                  ['node plugin/install.mjs --doctor [--json]', '检查 Node 22.18+、node:sqlite、插件清单、UI 构建产物与本地会话库。'],
                  ['node plugin/install.mjs --check-update [--json]', '查询 GitHub releases/tags 检查是否存在更新的 SemVer 版本。'],
                  ['node plugin/install.mjs --update [--force] [--ref <tag>]', '下载校验 GitHub 发布包并原子替换，异常时自动回滚。'],
                  ['node plugin/install.mjs --uninstall', '干净卸载已安装的插件目录或开发软链。'],
                  ['--target <dir> · --no-build', '指定自定义插件目录，或禁止缺少 UI 产物时自动触发构建。'],
                ],
              },
            },
            {
              heading: '一键脚本环境变量（install.sh / install.ps1）',
              bullets: [
                'AGY_HUD_VERSION：指定安装某个发布标签（例如 1.2.0 或 v1.2.0）。',
                'AGY_HUD_REF：指定安装某个 Git 分支或引用（例如 main）。',
                'AGY_HUD_TARGET：覆盖默认插件安装路径。',
                '首次安装后请重载或重启 Google Antigravity，侧边栏图标即会立即出现。',
              ],
            },
          ],
        },
        {
          id: 'swarm',
          label: '原生 Swarm 遥测',
          title: '原生多智能体 AGY Swarm 协同监控架构',
          intro:
            'AGY-HUD 通过基于 mtime 缓存的只读解析器直接读取 <appDataDir>/brain/<coordinator_conv_id>/.system_generated/swarm/ 下的原生元数据，并构建 Worker → Coordinator 反向索引。',
          blocks: [
            {
              heading: '本地只读解析的 Swarm 元数据文件',
              table: {
                headers: ['文件名', '提取的遥测字段'],
                rows: [
                  ['swarm.json', 'Swarm 唯一标识（swarm_id、backend、created_at），绑定主控会话。'],
                  ['members.json', 'Swarm 标题、@rosterName、角色、phase、desired_state、wake_mode、killed 状态、applied_model 与工作区模式（inherit/share/branch）。'],
                  ['plan.json', '全局目标 goal、各成员任务摘要 tasks[rosterName] 及并发线程分组 threads[]。'],
                  ['board.jsonl', '有界尾部读取最新 Board #seq、每个成员的最近发言摘要、时间戳与兜底任务简介。'],
                ],
              },
            },
            {
              heading: '实时状态推导与会话双向跳转',
              bullets: [
                'working：phase === RUNNING 且 wake_mode === working（绿色呼吸灯，列表默认置顶）。',
                'waiting：成员正在公告板上休眠等待 @mention 或消息唤醒（静默灰点，零 Token 消耗）。',
                'stopped / killed：已停止或永久终止的成员（清晰标注状态并视觉降权）。',
                'Worker 面包屑导航：切入任意 Worker 会话时，顶部 SessionRelBar 自动显示 ← @coordinator · Swarm 标题 与当前 @rosterName，一键返回主控。',
              ],
            },
          ],
        },
        {
          id: 'metrics',
          label: '指标与瀑布图',
          title: '速度指标、阶段耗时瀑布图与调用剖析',
          intro:
            'AGY-HUD 严格区分首字延迟（TTFT）、首字后持续流式速率与单包缓冲响应，确保每一轮调用的性能归因真实可信。',
          blocks: [
            {
              heading: '核心速度、延迟与上下文指标公式',
              table: {
                headers: ['指标', '计算方式与工程含义'],
                rows: [
                  ['GEN TPS', '输出 Token ÷ 首字后流式耗时（f12），衡量模型真实持续生成吞吐。'],
                  ['E2E TPS', '输出 Token ÷（TTFT f11 + 流式耗时 f12），衡量用户端到端真实体感速度。'],
                  ['BUF 标记', '单包缓冲返回响应，自动排除出 PEAK TPS 与加权 AVG GEN，防止均值高于峰值。'],
                  ['TTFT', '首字响应延迟（gen_metadata.f1.f11），按 3s 警告 / 10s 慢阈值着色。'],
                  ['TC-WAIT', '工具调用生成停顿时长，与思考阶段（THK）和本地工具执行时间精确剥离。'],
                  ['余量轮次', '基于历史每轮上下文增量的中位数，估算距离触发自动压缩的剩余轮次。'],
                ],
              },
            },
            {
              heading: 'OpenRouter 级瀑布图与 Token 构成条',
              bullets: [
                '阶段瀑布图按耗时比例展示 TTFT 等待（蓝）、深度思考（紫）、工具生成/TC-WAIT（琥珀）与流式回复（绿）。',
                'Token 构成条直观对比前缀缓存命中 vs 新增输入、思考 Token vs 可见回复，并显示本轮缓存节省美元数。',
                '调用浏览器支持 / 快速搜索、异常过滤芯片（慢 TTFT、低缓存、卡顿/缓冲、压缩事件）、多维度排序与一键复制 Markdown / JSON。',
              ],
            },
          ],
        },
        {
          id: 'quota',
          label: '配额校准算法',
          title: '5h / 7d 配额池与经验 k 倍率拟合',
          intro:
            'Antigravity 采用 5 小时滚动与 7 天每周双配额池，不同路由模型的扣减倍率差异显著。AGY-HUD 基于本地实测数据自动拟合各模型经验 k 倍率。',
          blocks: [
            {
              heading: '校准机制说明（quota-fitter.ts）',
              bullets: [
                '结合本地 SQLite Token 明细与回环 LS RPC 返回的 5h / 7d 配额剩余百分比变化量。',
                '拟合各路由模型的经验倍率 k（如 Carbon 约 3.0×、Hydrogen 约 1.0×、Flash-K 约 0.4×）与等效配额池容量。',
                '自动计算样本外（OOS）误差区间，明确区分已充分拟合（fitted）与临时估算（provisional）。',
                '识别未归因的跨设备远端消耗偏差（remote gap），并结合当前燃烧速率预测配额耗尽倒计时。',
              ],
            },
          ],
        },
        {
          id: 'protobuf',
          label: 'Protobuf 与多库发现',
          title: '本地 SQLite 结构、Protobuf 字段映射与多端库发现',
          intro:
            'AGY-HUD 使用 Node 22.18+ 内置 node:sqlite 以只读模式解析 ~/.gemini/antigravity/conversations/<uuid>.db 与 -wal 日志，并后台非阻塞发现 App / CLI / ACP / IDE 兄弟数据库。',
          blocks: [
            {
              heading: '核心 Protobuf 解码映射（gen_metadata 与 steps）',
              table: {
                headers: ['字段路径', '解码数据', '兜底策略'],
                rows: [
                  ['gen_metadata.f1.f19', '底层真实路由模型 ID（如 gemini-4-carbon）', '界面显示名（f1.f21）'],
                  ['gen_metadata.f1.f4', '缓存（f5）、新增输入（f2）、输出（f3/f1）、思考（f9）、可见（f10）', '旧版用量字段（f1.f17.f2）'],
                  ['gen_metadata.f1.f9.f10', '当前活跃上下文大小（f1）与窗口上限（f4，如 256,000）', 'cached + new_input；模型限额表'],
                  ['gen_metadata.f1.f11 / f12', '首字延迟 TTFT 秒数（f11）与流式生成秒数（f12）', '0.0s'],
                  ['steps (status != 3)', '实时生成计时（step_type = 15）、TOOL 状态与时间戳关联（f1.f20）', '空闲 / STANDBY 状态'],
                ],
              },
            },
          ],
        },
        {
          id: 'security',
          label: '安全模型与快捷键',
          title: '自更新安全防线与侧边栏键盘快捷键',
          intro:
            '无论是跨平台一键脚本还是应用内一键自更新，AGY-HUD 都严格执行供应链白名单、防压缩包攻击与原子回滚机制。',
          blocks: [
            {
              heading: '安全防线',
              bullets: [
                '严格 GitHub HTTPS 白名单：仅允许从 skywalker512/agy-hud 对应的 github.com、codeload.github.com、api.github.com（及官方发布 CDN 重定向）下载。',
                '防 Zip-Slip 与软链攻击：拒绝绝对路径、盘符、空字节、.. 路径穿越、符号链接/特殊文件，并限制 ≤2,000 文件及 50MB 归档 / 64MB 解压上限。',
                '原子暂存与自动回滚：替换前校验 plugin.json、sidecar.json、server.ts 与预构建 UI 完整性；任一环节失败立即恢复原备份。',
                '开发软链保护：默认拒绝覆盖通过 --link 挂载的开发目录，除非显式传入 --force。',
              ],
            },
            {
              heading: '侧边栏键盘快捷键',
              table: {
                headers: ['快捷键', '功能'],
                rows: [
                  ['1 / 2 / 3', '快速切换 实时（Live）/ 调用（Calls）/ 账户（Account）标签页'],
                  ['/', '聚焦调用浏览器搜索框（必要时自动切换至调用标签页）'],
                  ['Esc', '清空搜索条件、关闭菜单或取消当前悬停态'],
                  ['图表拖拽 / 缩略图刷选', '画布横向拉框放大历史区间，或拖动底部缩略图刷选全量会话'],
                  ['Ctrl/Meta + 滚轮 · 双击', '以光标为中心平滑缩放（不劫持纵向滚动）；双击缩略图一键重置'],
                ],
              },
            },
          ],
        },
      ],
    },
    footer: {
      tagline: '零代理、零运行时依赖的 Google Antigravity 实时遥测与原生 Swarm 驾驶舱。',
      license: 'MIT 开源协议',
      nodeReq: '依赖 Node.js 22.18+ (node:sqlite)',
      linksTitle: '页面导航',
      resourcesTitle: '开源资源',
      repoLink: 'GitHub 仓库',
      releasesLink: '版本发布与日志',
      issuesLink: '问题反馈与建议',
    },
  },
};
