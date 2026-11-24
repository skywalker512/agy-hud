# Changelog

All notable changes to **AGY-HUD** are documented in this file.

## v1.2.0 — Gemini Global Pulse, Visual Craft Overhaul, Prompt Cache TTL & Iceberg Insights

### Added

- **Gemini Global Pulse, 5-Minute Cloudflare Collector & Standalone `/pulse/` Site (`lib/pulse-core.ts`, `lib/gemini-pulse.ts`, `workers/gemini-pulse/`, `site/pulse/`, `GeminiPulseCard.tsx`, `GlobalTrendView.tsx`)**:
  - Unified pure `lib/pulse-core.ts` shared across the Node sidecar, Cloudflare Worker (`https://agy-hud.512.pub`), and launch site `/pulse/` dashboard: extracts OpenRouter 30m P50/P75/P90/P95/P99 TTFT, TPS, weighted cache hit rate, avg prompt/output context, 7d comparison series, evenly downsampled 24h availability (preserving outage dips), and active Google Cloud Service Health incidents.
  - Added a $0 Free-tier Cloudflare Worker collecting 5-minute snapshots into a 24h ring buffer (288 points) with Workers Static Assets hosting `/` and `/pulse/`, canonical edge caching with ETag/304, cold-start KV locking, empty-response protection, and constant-time HMAC refresh auth.
  - Added live TTFT attribution (`normal` / `upstream_degraded` / `cache_miss` / `large_context` / `local_concurrency` / `account_or_network`), context-bucketed local vs global comparison, Cyber Arena PK matchup mode, and a Global Trend multi-line view with local 7d/5m overlays.
- **Wrapped Share Poster & Recursive Session Tree Rollup (`ActivityShareModal.tsx`, `posterCanvas.ts`, `lib/graph.ts`)**:
  - Added one-click bilingual Wrapped activity poster export (Cyber / Gold / Light PNG + text summary) and recursive multi-level subagent/swarm rollup across session trees.
- **CI Workflow & Monorepo Verification Scripts (`.github/workflows/ci.yml`, `package.json`, `.gitattributes`)**:
  - Added GitHub Actions CI verifying `web`, `site`, and `workers/gemini-pulse` typechecks, sidecar & tools test suites, and compiled UI bundle parity (`plugin/sidecars/hud_panel/ui/`).
- **Prompt Cache TTL Survival Modeling (`lib/cache-ttl.ts`, `CacheTtlCard.tsx`, `ContextWindowCard.tsx`)**:
  - Fits a regularized per-model-family Log-Logistic survival curve $S(t) = (1 - p_0) / (1 + (t / t_{50})^k)$ using weak provider MAP priors (modeling Claude's sharp hard-TTL cliff separately from Gemini's gradual LRU decay) with `prior` / `provisional` / `fitted` confidence levels.
  - Exposes `P80` / `P50` / `P20` survival horizons, empirical 7-bucket idle-gap hit-rate bars (`<1m` through `2h+`), cumulative expired-cache miss cost in USD, and a live session survival indicator with estimated miss penalty in both USD and `5h` quota `%`.
- **UI Visual Craft & Instrument Ergonomics Overhaul (`web/src/**`)**:
  - **Layered Borderless Surfaces & Semantic Restraint**: Replaced nested wireframe boxes with softly elevated L1 cards, recessed borderless L2 metric wells, refined dark/light semantic harmony, and preserved crisp `:root[data-contrast="strong"]` parity alongside live Antigravity host theme/font synchronization (`useThemeSync.ts`).
  - **Unified Crisp SVG Icon Set & Viewport-Clamped Popovers (`Icons.tsx`, `SelectPopover.tsx`)**: Replaced raw Unicode control glyphs across the HUD with lightweight custom SVG icons, replaced native `<select>` dropdowns in the TopBar and Call Log with keyboard-accessible custom popovers, and clamped all popovers (`⋯` menu, `SelectPopover`, Export) to viewport bounds so they never clip even at `240px` sidebar widths.
  - **Slimmed Header & Smart Scroll-Aware `PulseBar`**: Folded `MAIN`/`SWARM` relationship pills cleanly into `ModelBar` (reserving a separate breadcrumb row for worker/child sessions) and made `PulseBar` reveal smoothly on the `Live` tab only after scrolling past `HeroSpeedCards`, eliminating duplicate hero metrics at the top of the pane.
  - **Live First-Token Stopwatch & Per-Call TTFT Promotion (`HeroSpeedCards.tsx`, `LiveCallRow.tsx`, `InvocationRow.tsx`, `CallLogCard.tsx`)**: Added a real-time first-token stopwatch with animated scan/progress indicators and baseline color thresholds (`green → amber → red`) during TTFT wait, promoted per-call TTFT into prominent Line-1 pills and Call Detail summary cell #1, and defaulted the Trend Explorer to TTFT first.
  - **Panoramic Live Tab Redesign (`HeroSpeedCards.tsx`, `ContextWindowCard.tsx`, `LiveQuotaCard.tsx`, `KpiGrid.tsx`)**: Upgraded `HeroSpeedCards` into a balanced pair — `GEN SPEED` (`tok/s` + smooth emerald area-gradient curve) alongside `FIRST TOKEN` (live ticking TTFT seconds + latest **Cache Hit %** badge + `Avg TTFT · E2E` subline + 10-call color-coded TTFT bar chart with average reference line); promoted an active-pool **`QUOTA TANK`** card (`LiveQuotaCard`) with diagonal hatched Runway bars and `All →` jump directly onto the `Live` tab; streamlined `ContextWindowCard` into a spacious 3-column health strip (`Headroom` | `Cache TTL` with `P80` safe countdown | `Session` cost & savings); condensed `KpiGrid` into a clean 3-column hairline-divided session summary strip (`AVG SPEED` | `OUTPUT` | `TIME`); persisted collapsible card states (`QuotaRulesCard`, `CacheTtlCard`, `SessionModelMix`, `RecentCallsCard`, `SubagentsCard`) in `localStorage`.
  - **Bayesian Historical Rhythm Runway & Hatched Bar (`lib/quota-budget.ts`, `lib/graph.ts`, `QuotaPoolsList.tsx`)**: Extended local pool lookback to 30 days and blended 14–30d empirical pace via Bayesian shrinkage (`7d` calendar-day pace with `activeHoursPerDay`, `τ = 24h`; `5h` active-hour pace, `τ = 1.0h`) so early-cycle projections stay steady instead of extrapolating a short burst linearly; visualizes projected burn directly inside the 5h/7d progress bar via a diagonal hatched stripe.
  - **16w / 52w Activity Heatmap, Iceberg View & Account Clarity (`ActivityHeatmapCard.tsx`, `SpendGrid.tsx`, `AccountTab.tsx`, `lib/telemetry.ts`)**: Added optional 52-week history toggle (`16w | 52w`), daily `newTokens` vs `cachedTokens` split powering a Monochrome Token Iceberg chart, explicit local-machine vs other-device/cloud spend scope tooltips and callouts, taller `CacheTtlCard` curves with plain-language tooltips, and platform-aware 1-liner update fallback commands for non-linked installs.
  - **Ultra-Compact Narrow Sidebar Polish**: Improved responsive degradation down to `240px` auxiliary side panes (zero sparkline/text overlap, zero mid-word CJK line breaks, capped narrow tool chips) and fixed narrow/medium Trend Chart Y-axis label overlap.
- **AI Agent Install Guide & Product-First Documentation (`AGENTS.md`, `README*.md`, `docs/*.md`)**:
  - Added `AGENTS.md` with deterministic macOS/Linux/Windows install, `--doctor` verification, update, and uninstall steps for coding agents.
  - Reordered `README.md` and `README.zh-CN.md` to lead with immediate interface screenshots, 10-second Quick Install, a scannable 3-tab tour, and grounded engineering craftsmanship details.
- **First-Class Native AGY Swarm Observability Cockpit (`lib/swarm.ts`, `SubagentsCard.tsx`, `SessionRelBar.tsx`)**:
  - Read-only, mtime-cached discovery and parsing of Antigravity's native swarm metadata (`swarm.json`, `members.json`, `plan.json`, and bounded tail/head reads of `board.jsonl`) with reverse-lookup indexing from any worker back to its coordinator.
  - Full **Swarm Cockpit** UI displaying swarm title & goal, live pulsing `@rosterName` states (`working` / `waiting` / `stopped` / `killed`), assigned task titles, persisted `Flat | By Thread` grouping, `share` / `branch` worktree badges, `Board #seq` progress, stable deterministic plan/roster ordering (regular workers → infra helpers like `@monitor` → killed, eliminating live-poll row jumping), rolled-up swarm calls / tokens / USD / 5h & 7d quota burn, worker-view coordinator breadcrumbs, and `[Swarm @rosterName]` labels in the conversation switcher.
- **Interactive Historical Trend Explorer (`TrendChartCard.tsx`, `trendMath.ts`)**:
  - Removed the 32-call chart lock to expose full-session history across all 6 metrics (`TPS`, `TTFT`, `OUT`, `CACHE`, `CTX`, `QUOTA%`).
  - Added persisted range presets (`20 | 50 | 100 | All`), an interactive **Minimap Brush / Scrubber** (resizable handles, draggable body pan, track click-to-center, double-click reset), **canvas drag-to-zoom** marquee, cursor-centered `Ctrl`/`Cmd`/`Shift` + Wheel zoom, horizontal trackpad pan, `[-]` / `[+]` micro-buttons, and a smart **`Follow Live`** state machine.
  - Consolidated chart controls into a sleek 2-row header with human-rounded Y-axis ticks (`niceMax`), dual `#Seq` / `Time` X-axis toggle, a 4-cell viewport-recomputed summary stat strip (`LATEST + Δ`, `AVG`, `P95`, `PEAK`), `0 ms` SVG crosshair + structured popover, cross-metric compaction markers + SLA lines, and click-to-inspect drill-down into the Call Log.
- **OpenRouter-Style Tabbed Call Detail Inspector, Call Explorer & Export (`InvocationRow.tsx`, `CallLogCard.tsx`, `exportReport.ts`)**:
  - Upgraded expanded invocations into a 5-tab inspector (`Overview` · `Thinking` · `Tools` · `Reply` · `Raw`) featuring a 4-cell summary metric strip, proportional **Timing Waterfall** (`TTFT` / `Thinking` / `Tool Gen & TC-WAIT` / `Reply Stream`), and **Token & Cost Composition Bar**, plus a 2px bottom-edge latency proportion hairline on collapsed rows.
  - Added a **Call Explorer Toolbar** with instant search (`/`), anomaly filter chips (`Slow TTFT >3s`, `Low Cache <60%`, `Stall / Buf`, `Compacts`), shared model filter synced with the Trend Chart, metric sorting (`Timeline`, `Slowest`, `Highest TTFT`, `Lowest GEN TPS`, `Highest Cost / Quota`), and chart click-to-jump 1.2s highlight animation.
  - Added zero-dependency per-call (`[MD]` / `[JSON]`) and full-session (`Copy Session Report (MD)` / `Export Telemetry (JSON)` with clipboard fallback) diagnostic exports.
- **Live Tab Enhancements & Keyboard Ergonomics (`HeroSpeedCards.tsx`, `LiveTab.tsx`, `app.tsx`)**:
  - Added session-average `%` delta badge and an inline GEN TPS area sparkline to the hero speed card, plus a collapsible **Session Model Mix** comparison table when `≥ 2` routed models appear in a session.
  - Added global keyboard shortcuts (`1` / `2` / `3` tabs, `/` search focus, `Esc` clear/close) and `:focus-visible` accessibility rings.
- **Heuristic Chinese Locale Detection & 7-Day Caching (`lib/locale.ts`, `GET /api/locale`)**:
  - Multi-signal weighted scoring across env/OS primary & secondary locales, region tags, Chinese timezones, macOS/Linux Chinese input methods, and user-installed Chinese fonts (explicitly zero-weighting macOS system-bundled `PingFang.ttc` to prevent false positives), backed by memory + atomic disk caching with fingerprint invalidation and manual `localStorage` override priority.
- **Cross-Platform One-Line Installers, `--doctor` & Hardened Self-Upgrade (`scripts/install.sh`, `scripts/install.ps1`, `plugin/install.mjs`, `lib/updater.ts`)**:
  - Added POSIX `scripts/install.sh` (macOS/Linux) and `scripts/install.ps1` (Windows PowerShell 5.1+/7+) one-line installers with Node.js `22.18+` checks, strict GitHub URL validation, and zip-slip protection.
  - Expanded `plugin/install.mjs` with `--doctor` (6 health checks), `--check-update`, `--update`, `--target`, `--ref`, `--force`, `--no-build`, `--json`, and Windows junction support for `--link`.
  - Added in-app self-upgrade (`GET /api/update-status`, `POST /api/update-apply`, TopBar `↑ vX.Y.Z` pill, and **Account → Plugin & Updates** card) with HTTPS GitHub allowlist, manual redirect checks, pure-Node safe `.tar.gz`/`.zip` extraction, atomic swap + automatic rollback, dev-symlink protection, and SHA-256 backend diff restart detection.
- **Launch Website & Bilingual Documentation Suite (`site/`, `docs/`, `README*.md`)**:
  - Added a calm, editorial Vite + Preact + Tailwind CSS v4 launch website (`site/`) embedding the **real compiled AGY-HUD UI** (`LiveHudFrame` + `demo-bridge.js` with a sanitized 2-model Orchestrator demo, animated TTFT showcase, and clickable Swarm worker navigation), a compact 1-row **16-theme swatch scrubber** (12 Dark + 4 Light + `Default | Strong` contrast toggle), an OS-aware inline install switcher, `/pulse/` defaulting to 5m with live insights, and community credits & inspirations.
  - Refreshed `README.md`, `README.zh-CN.md`, and complete bilingual guides (`docs/INSTALLATION*.md`, `docs/GUIDE*.md`).
- **Multi-Store DB Discovery, Quota `k`-Fitter & Trace CLI**:
  - Auto-discovers and merges App, CLI (`agy`), ACP, and IDE sibling/running-process conversation stores (with persisted `discovered-roots.json`) into unified history, spend, and quota-pool accounting.
  - Added empirical Huber/Tukey IRLS `k`-multiplier & Claude 3-parameter token ridge quota solver ([quota-fitter.ts](plugin/sidecars/hud_panel/lib/quota-fitter.ts) & [quota-solver.ts](plugin/sidecars/hud_panel/lib/quota-solver.ts)) with adaptive `6σ` MAD outlier rejection, OOS validation guardrails, runway depletion forecasts, unattributed remote quota gap estimates, per-call/turn/session quota burn indicators, the Quota Rules card, and a 16w/52w daily activity heatmap.
  - Added `tools/hud-trace.mjs` and `tools/test/trace.test.mjs` for recording mid-execution LS + SQLite transitions, viewing timelines, and exporting sanitized regression fixtures.

### Changed

- **Node.js 22.18+ Sidecar Runtime**: Migrated sidecar backend modules to native TypeScript (`*.ts`) running directly on Node.js `22.18+` with built-in `node:sqlite` and zero runtime npm dependencies.
- **Plugin-Only Architecture**: Removed the legacy Python desktop pill, `--cli` / `--watch` modes, `pyproject.toml`, and `plugin/install_plugin.py`; AGY-HUD now ships cleanly as the native Antigravity 2.0 side-pane plugin installed via `scripts/install.{sh,ps1}` or `node plugin/install.mjs`.
- **LS Placeholder & Idle State Accuracy**: Expanded `KNOWN_LS_PLACEHOLDERS`, preserved fallback generator model from tail steps on synthetic fallbacks, and cleared stale `activeStep` / `currentModel.isActive` when LS reports idle.

### Fixed & Hardened

- **Security & Pulse Hardening**: Prevented `?feed=` query parameters on `/pulse/` from persisting into `localStorage` (session-only override), strictly enforced `https://status.cloud.google.com/` on all incident links across site/sidecar/Worker, added 5MB payload cap + schema/staleness validation (`>20m` falls back to direct OpenRouter), added exponential failure backoff (1–15m), fixed in-flight refresh race and `refresh`-while-disabled privacy bypass, switched sidecar cache writes to atomic compact temp-file rename, and fixed `deploy-cloudflare.yml` step `if:` secret reference.
- **Frontend Performance, Stability & Accessibility**: Isolated live 250ms/1s clock ticks into `NowContext` (`useNow.tsx`) and wrapped heavy cards/rows (`TrendChartCard`, `GlobalTrendView`, `InvocationRow`, `CompactCard`, `GeminiPulseCard`, `SubagentsCard`) in `memo` with per-row detail props; fixed Session ↔ Global `ResizeObserver` and wheel-zoom listener detachment via `useElementWidth` and callback refs; split `TrendChartCard.tsx` into `trend/{modelLabels,TrendPopover,TrendMinimap}`; added keyboard navigation + `aria-live` announcements on Trend Chart & Minimap; switched pending swarm member buttons to `aria-disabled` with `sr-only` state labels; and replaced string-comparison language checks with `Translations.lang`.

---

## v1.1.0 — Live Streaming, Target Stability & Phase Diagnostics

- **Per-Call Phase & Tool-Stall Diagnostics**: Separates post-TTFT thinking time (`THK`) from tool-call argument streaming time (`TOOL GEN` / `TC-WAIT`) on tool-invoking turns, and clamps `TOOL TIME` start timestamps to planner completion so multi-tool streaming no longer inflates tool execution totals.
- **Unfrozen Live Streaming & Auto-Scroll**: Raised `THINKING` / `REPLY` detail caps from `1,200` to `60,000` chars with a `24,000`-char sliding tail window during live streaming, fixed live ETag signatures to track raw unclipped char lengths, warmed Language Server model aliases (`-high` / `-low`) on startup, and added sticky bottom auto-scroll during live generation.
- **Deterministic Conversation Targeting**: Eliminated `Calls` count oscillation (`3 ↔ 6`) during early turns by removing stale startup `app.config.conversationId` fallbacks, preserving zero-byte WAL checkpoint timestamps, ranking idle conversations by true protobuf step / LS activity timestamps (preferring `main` over `subagent` sessions), and serializing frontend `poll()` requests with `AbortController` + sequence guards.
- **Accurate Sustained `AVG GEN` & Hardened Runtime**: Excluded single-packet `BUF` responses from `avgGenTps` / `avg_gen_tps` in both Node and Python telemetry stores so weighted averages never exceed `PEAK TPS`, restricted LS TLS/HTTP fallbacks strictly to loopback hosts, extracted pricing rules into `pricing.json` with background DB indexing, made `desktop.cli --cli` / `--watch` independent of `tkinter` (`--data-dir` + `ANTIGRAVITY_APP_DATA_DIR`), added macOS right-click bindings (`<Button-2>`, `<Control-Button-1>`), and added zero-dependency Node + Python unit test suites.

---

## v1.0.0 — Initial Public Release

- Pure-stdlib Python desktop floating HUD pill (`desktop/`) with CLI and `--watch` modes.
- Native Antigravity 2.0 auxiliary side-pane UI plugin (`plugin/`) powered by `node:sqlite`.
- Read-only SQLite + WAL mtime polling (`?mode=ro`) and wire-type protobuf decoder.
- Separate `GEN TPS` vs `E2E TPS` (including TTFT) tracking with millisecond single-packet `BUF` spike detection.
- Raw model identifier priority (`f1.f19`, e.g. `GEMINI-3.8-FLASH-K`) and real protobuf context budget (`f1.f9.f10.f4`).
- Default crisp English abbreviation HUD with live `EN / 中文` switcher in both UIs.
