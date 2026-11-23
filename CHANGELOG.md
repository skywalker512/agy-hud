# Changelog

All notable changes to **AGY-HUD** are documented in this file.

## [Unreleased] — Visual Craft Overhaul, Prompt Cache TTL & Iceberg Insights

### Added

- **Prompt Cache TTL Survival Modeling (`lib/cache-ttl.ts`, `CacheTtlCard.tsx`, `ContextWindowCard.tsx`)**:
  - Fits a regularized per-model-family Log-Logistic survival curve $S(t) = (1 - p_0) / (1 + (t / t_{50})^k)$ using weak provider MAP priors (modeling Claude's sharp hard-TTL cliff separately from Gemini's gradual LRU decay) with `prior` / `provisional` / `fitted` confidence levels.
  - Exposes `P80` / `P50` / `P20` survival horizons, empirical 7-bucket idle-gap hit-rate bars (`<1m` through `2h+`), cumulative expired-cache miss cost in USD, and a live session survival indicator with estimated miss penalty in both USD and `5h` quota `%`.
- **UI Visual Craft & Instrument Ergonomics Overhaul (`web/src/**`)**:
  - **Layered Borderless Surfaces & Semantic Restraint**: Replaced nested wireframe boxes with softly elevated L1 cards, recessed borderless L2 metric wells, refined dark/light semantic harmony, and preserved crisp `:root[data-contrast="strong"]` parity alongside live Antigravity host theme/font synchronization (`useThemeSync.ts`).
  - **Unified Crisp SVG Icon Set & Custom Popovers (`Icons.tsx`, `SelectPopover.tsx`)**: Replaced raw Unicode control glyphs across the HUD with lightweight custom SVG icons and replaced native `<select>` dropdowns in the TopBar and Call Log with keyboard-accessible custom popovers.
  - **Slimmed Header & Smart Scroll-Aware `PulseBar`**: Folded `MAIN`/`SWARM` relationship pills cleanly into `ModelBar` (reserving a separate breadcrumb row for worker/child sessions) and made `PulseBar` reveal smoothly on the `Live` tab only after scrolling past `HeroSpeedCards`, eliminating duplicate hero metrics at the top of the pane.
  - **Live Tab Refinement**: Upgraded `HeroSpeedCards` with a full-width bottom-anchored smooth area-gradient sparkline, merged `KpiGrid` into one unified hairline-divided strip, redesigned `ContextWindowCard` into a segmented bar with interactive hover highlighting, an aligned 2-column token table (including finer MCP/skills/rules/checkpoint breakdown when present), and a 4-column micro-metric strip.
  - **Hatched Quota Runway Bar (`QuotaPoolsList.tsx`)**: Visualizes projected quota burn before window reset directly inside the 5h/7d progress bar via a diagonal hatched stripe, replacing noisy status pills with calm inline captions and detailed tooltips.
  - **16w / 52w Activity Heatmap & Monochrome Token Iceberg View (`ActivityHeatmapCard.tsx`, `lib/telemetry.ts`)**: Added optional 52-week history toggle (`16w | 52w`) and daily `newTokens` vs `cachedTokens` split powering a Monochrome Token Iceberg chart (New Tokens above baseline vs Cached Read below baseline).
  - **Ultra-Compact Narrow Sidebar Polish**: Improved responsive degradation down to `<= 250px` auxiliary side panes and fixed narrow/medium Trend Chart Y-axis label overlap.
- **AI Agent Install Guide & Product-First Documentation (`AGENTS.md`, `README*.md`, `docs/*.md`)**:
  - Added `AGENTS.md` with deterministic macOS/Linux/Windows install, `--doctor` verification, update, and uninstall steps for coding agents.
  - Reordered `README.md` and `README.zh-CN.md` to lead with immediate interface screenshots, 10-second Quick Install, a scannable 3-tab tour, and grounded engineering craftsmanship details.
- **First-Class Native AGY Swarm Observability Cockpit (`lib/swarm.ts`, `SubagentsCard.tsx`, `SessionRelBar.tsx`)**:
  - Read-only, mtime-cached discovery and parsing of Antigravity's native swarm metadata (`swarm.json`, `members.json`, `plan.json`, and bounded tail/head reads of `board.jsonl`) with reverse-lookup indexing from any worker back to its coordinator.
  - Full **Swarm Cockpit** UI displaying swarm title & goal, live pulsing `@rosterName` states (`working` / `waiting` / `stopped` / `killed`), assigned task titles, optional `Flat | By Thread` grouping, `share` / `branch` worktree badges, `Board #seq` progress, active-first sorting, rolled-up swarm calls / tokens / USD / 5h & 7d quota burn, worker-view coordinator breadcrumbs, and `[Swarm @rosterName]` labels in the conversation switcher.
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
  - Added a standalone Vite + Preact + Tailwind CSS v4 launch website (`site/`) with interactive 3-tab HUD Simulator, OS-aware install switcher, Craftsmanship showcase, Feature Tour, and GitHub Pages deployment workflow.
  - Refreshed `README.md`, `README.zh-CN.md`, and complete bilingual guides (`docs/INSTALLATION*.md`, `docs/GUIDE*.md`).
- **Multi-Store DB Discovery, Quota `k`-Fitter & Trace CLI**:
  - Auto-discovers and merges App, CLI (`agy`), ACP, and IDE sibling/running-process conversation stores (with persisted `discovered-roots.json`) into unified history, spend, and quota-pool accounting.
  - Added empirical Huber/Tukey IRLS `k`-multiplier & Claude 3-parameter token ridge quota solver ([quota-fitter.ts](plugin/sidecars/hud_panel/lib/quota-fitter.ts) & [quota-solver.ts](plugin/sidecars/hud_panel/lib/quota-solver.ts)) with adaptive `6σ` MAD outlier rejection, OOS validation guardrails, runway depletion forecasts, unattributed remote quota gap estimates, per-call/turn/session quota burn indicators, the Quota Rules card, and a 16w/52w daily activity heatmap.
  - Added `tools/hud-trace.mjs` and `tools/test/trace.test.mjs` for recording mid-execution LS + SQLite transitions, viewing timelines, and exporting sanitized regression fixtures.

### Changed

- **Node.js 22.18+ Sidecar Runtime**: Migrated sidecar backend modules to native TypeScript (`*.ts`) running directly on Node.js `22.18+` with built-in `node:sqlite` and zero runtime npm dependencies.
- **Plugin-Only Architecture**: Removed the legacy Python desktop pill, `--cli` / `--watch` modes, `pyproject.toml`, and `plugin/install_plugin.py`; AGY-HUD now ships cleanly as the native Antigravity 2.0 side-pane plugin installed via `scripts/install.{sh,ps1}` or `node plugin/install.mjs`.
- **LS Placeholder & Idle State Accuracy**: Expanded `KNOWN_LS_PLACEHOLDERS`, preserved fallback generator model from tail steps on synthetic fallbacks, and cleared stale `activeStep` / `currentModel.isActive` when LS reports idle.

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
