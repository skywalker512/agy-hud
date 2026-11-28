<div align="center">

<img src="docs/assets/banner.svg" alt="AGY-HUD Banner" width="100%" />

<p>
  <strong>Live telemetry for Google Antigravity — real-time speed, live first-token TTFT monitor, Gemini Global Pulse 7d/5m radar &amp; Arena PK, prompt cache survival, calibrated quota runway, recursive Swarm rollup, and 2x Wrapped posters right in your side pane.</strong>
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-22.18%2B%20node%3Asqlite-06b6d4?style=flat-square" alt="Node.js 22.18+ node:sqlite" />
  <img src="https://img.shields.io/badge/Runtime%20Deps-Zero-10b981?style=flat-square" alt="Zero Runtime Dependencies" />
  <img src="https://img.shields.io/badge/Platforms-macOS%20%7C%20Linux%20%7C%20Windows-3b82f6?style=flat-square" alt="macOS | Linux | Windows" />
  <img src="https://img.shields.io/badge/UI-EN%20%2F%20%E4%B8%AD%E6%96%87-6366f1?style=flat-square" alt="EN / 中文" />
</p>

<p>
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://agy-hud.512.pub/">Website</a> ·
  <a href="https://agy-hud.512.pub/pulse/">Gemini Pulse Radar</a> ·
  <a href="#quick-install">Quick Install</a> ·
  <a href="#interface-tour">Tour</a> ·
  <a href="docs/GUIDE.md">Technical Guide</a> ·
  <a href="AGENTS.md">AGENTS.md</a>
</p>

</div>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/screenshots/hud-live-dark-en.png" alt="AGY-HUD Live Tab (English, Dark)" width="100%" />
      <br />
      <sub><strong>Live</strong> — Sustained speed &amp; area sparkline, 2-col Context X-Ray, live Cache TTL survival, and Native Swarm Cockpit.</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/screenshots/hud-calls-dark-en.png" alt="AGY-HUD Calls Tab (English, Dark)" width="100%" />
      <br />
      <sub><strong>Calls</strong> — Full-session Trend Explorer with minimap brush, 5-tab Call Inspector, timing waterfall &amp; token breakdown.</sub>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/assets/screenshots/hud-account-dark-en.png" alt="AGY-HUD Account Tab (English, Dark)" width="100%" />
      <br />
      <sub><strong>Account</strong> — Hatched 5h/7d runway bar, <code>k</code>-rules, Cache TTL curve, 16w/52w Iceberg heatmap &amp; 1-click update.</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/screenshots/hud-calls-light-en.png" alt="AGY-HUD Light Theme Synchronization" width="100%" />
      <br />
      <sub><strong>Native Light Sync</strong> — Mirrors Antigravity's theme, font scale, and strong-contrast mode automatically.</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/screenshots/hud-live-dark-zh.png" alt="AGY-HUD Chinese Localization (Dark)" width="100%" />
      <br />
      <sub><strong>Bilingual EN / 中文</strong> — Smart first-launch locale detection with instant manual toggle.</sub>
    </td>
  </tr>
</table>

---

## <a id="quick-install"></a>Quick Install

> **Pure official Antigravity Sidecar · Zero CDP · Zero `app.asar` patching · 100% local read-only · Zero runtime dependencies**

### macOS & Linux

```sh
curl -fsSL https://h.512.pub | sh
```

### Windows (PowerShell 5.1+ / 7+)

```powershell
irm https://h.512.pub | iex
```

<sub><code>h.512.pub</code> automatically serves <a href="scripts/install.sh"><code>install.sh</code></a> to <code>curl</code>/<code>wget</code>, <a href="scripts/install.ps1"><code>install.ps1</code></a> to PowerShell, and redirects browsers to <a href="https://agy-hud.512.pub/">agy-hud.512.pub</a> (inspect directly at <code>https://h.512.pub/sh</code> or <code>/ps1</code>).</sub>

### AI Agent Install (1 Sentence)

Paste this into Antigravity, Claude Code, Codex, or any coding agent (`https://h.512.pub/agent` serves [`AGENTS.md`](AGENTS.md) directly):

> `Install AGY-HUD following https://h.512.pub/agent and verify.`

<details>
<summary><strong>Official <code>agy plugin install</code>, CLI <code>/statusline</code>, dev hot-reload (<code>--link</code>), <code>--doctor</code>, and uninstall</strong></summary>

```bash
git clone https://github.com/skywalker512/agy-hud.git && cd agy-hud
agy plugin validate --strict ./plugin  # Verify manifest, /agy-hud skill & sidecar against official loader
agy plugin install ./plugin            # Install via official Antigravity CLI plugin manager
# Or use the built-in zero-dependency installer:
node plugin/install.mjs                # Atomic copy-install to ~/.gemini/config/plugins/agy-hud
node plugin/install.mjs --statusline   # Enable width-adaptive AGY-HUD terminal /statusline for `agy` CLI
node plugin/install.mjs --link         # Dev symlink (macOS/Linux) or junction (Windows)
node plugin/install.mjs --doctor       # Run 6 environment & bundle health checks
node plugin/install.mjs --update       # Safe CLI upgrade with automatic rollback
node plugin/install.mjs --uninstall-statusline
node plugin/install.mjs --uninstall
```

</details>

*Requires **Node.js 22.18+** (built-in `node:sqlite`) and **Google Antigravity 2.0**. Restart Antigravity (or reload plugins) if the AGY-HUD icon does not appear immediately. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for custom paths, pinned versions, and troubleshooting.*

---

## <a id="interface-tour"></a>Interface Tour

AGY-HUD organizes everything into three calm, glanceable views designed for a narrow auxiliary side pane:

### 1. Live — *What is happening right now?*
- **Hero Speed & Area Sparkline**: Separates post-TTFT streaming speed (`GEN TPS`) from end-to-end speed (`E2E TPS`), showing a session-average delta badge and a smooth bottom-anchored sparkline without single-packet spikes skewing your numbers.
- **Context Window X-Ray**: Clean segmented bar with interactive hover highlighting and an aligned 2-column token table (`Sys Prompt`, `Tool Defs`, `Tool Results` with per-tool leaderboard, `Model Replies`, `User / Ckpt`, plus finer MCP/skills/rules breakdown when present).
- **Stay Ahead of Compaction & Cache Expiry**: A compact 4-column micro-metric strip shows estimated **headroom turns (`~Nt`)**, **cache hit %**, live **Prompt Cache TTL survival probability**, and **session cost / `5h` quota burn**.
- **Native AGY Swarm Cockpit & Recursive Tree Rollup**: Automatically appears on Swarm sessions to track `@rosterName` worker states, active tasks, `Board #seq`, recursively rolled-up tree cost/output/quota across nested subagents & Side-Q, and one-click coordinator↔worker breadcrumbs.

### 2. Calls — *Why was that turn slow or expensive?*
- **Session & Global Trend Explorer**: Switch between full-session history (6 metrics: `TPS`, `TTFT`, `OUT`, `CACHE`, `CTX`, `QUOTA%`, with Minimap Brush, drag-to-zoom, and `Follow Live`) and **Global Trend** mode—plotting OpenRouter 7d/5m Gemini curves (Vertex vs AI Studio split) with your local telemetry overlaid.
- **5-Tab Call Detail Inspector**: Click any call row to inspect `Overview` (4-cell strip, proportional **Timing Waterfall** for `TTFT / Think / Tool Gen & TC-WAIT / Reply`, and **Token Composition Bar**), `Thinking`, `Tools`, `Reply`, and `Raw`.
- **Search, Filter & Export**: Hit `/` to search across models, prompts, and tool names; filter anomalies (`Slow TTFT >3s`, `Low Cache <60%`, `Stall / Buf`, `Compacts`); sort by slowest or costliest; or copy a clean **Markdown / JSON** report in one click.

### 3. Account — *How long will my quota last?*
- **Gemini Global Pulse, Local-vs-Global Comparison & Cyber Arena PK**: Compare your local 30m/24h/7d Gemini TTFT, TPS, and cache hit rate against the live global pool ([`agy-hud.512.pub/pulse/`](https://agy-hud.512.pub/pulse/)), inspect context-bucketed latency hints alongside GCP Service Health incidents, and duel models head-to-head in **Cyber Arena PK**.
- **Dual 5h / 7d Quota Runway & Calibrated `k`-Rules**: Hatched diagonal runway bars show projected burn before reset right inside the progress bar alongside empirically fitted per-model `k`-multipliers and 7-bucket Prompt Cache TTL survival curves (`P80` / `P50` horizons and expired-cache cost).
- **Unified Ledger, 16w/52w Iceberg Heatmap & 2x Wrapped Poster**: Automatically merges App, CLI (`agy`), ACP, and IDE stores into one spend grid, a **16w / 52w Activity Heatmap**, a **Monochrome Token Iceberg** view, one-click **2x PNG Wrapped share posters** (Cyber / Gold / Light), and safe in-app updates.

---

## <a id="craftsmanship"></a>Craftsmanship & Details

- **Native Host Theme, Font & Strong-Contrast Sync** — [`useThemeSync.ts`](web/src/hooks/useThemeSync.ts) samples Antigravity's live CSS variables (`--background`, `--card`, `--primary`), font family, font scale, and high-contrast mode via `MutationObserver` and host `theme-change` events. Layered borderless cards, custom SVG icons, custom popover selects, and a scroll-aware `PulseBar` (which stays hidden at the top of `Live` so numbers never duplicate) make the HUD feel built into Antigravity.
- **Prompt Cache TTL Survival Modeling** — [`cache-ttl.ts`](plugin/sidecars/hud_panel/lib/cache-ttl.ts) fits a regularized Log-Logistic survival curve $S(t) = (1 - p_0) / (1 + (t / t_{50})^k)$ per model family (`P80` / `P50` horizons, distinct sharp TTL cliffs for Claude vs gentle LRU decay for Gemini), giving live expiry probability and exact miss penalty in USD and `5h` quota `%`.
- **Quota Runway & Empirical IRLS Calibration** — Fits per-model `k`-multipliers and Claude 3-parameter token ridge weights using Huber/Tukey IRLS + adaptive `6σ` MAD outlier rejection over clean short windows (`≤ 15 min`), isolating remote spend gaps and showing out-of-sample (`OOS`) validation status before dropping `provisional` tags.
- **True Telemetry Fidelity** — Opens local SQLite + WAL databases strictly read-only (`node:sqlite`, `?mode=ro`), decodes Protobuf `gen_metadata.f1.f19` for the actual backend routed model ID and `f9.f10.f4` for the real context cap, isolates single-packet `BUF` bursts so sustained `AVG GEN` never exceeds `PEAK`, separates `THK` from `TC-WAIT` tool stalls, and unifies App + CLI (`agy`) + ACP + IDE sibling stores.
- **First-Class Native AGY Swarm Cockpit** — Directly reads Antigravity's on-disk swarm state (`swarm.json`, `members.json`, `plan.json`, bounded tail reads of `board.jsonl`) with combined `mtime` caching. Surfaces live pulsing `@rosterName` states, task summaries, `Flat | By Thread` grouping, `share`/`branch` worktree badges, `Board #seq`, rolled-up swarm quota/cost, and reverse-indexed worker→coordinator navigation.
- **Account Insights, Smart Locale & Hardened Self-Updater** — Combines 16w/52w Activity Heatmaps and the Monochrome Token Iceberg view with multi-signal EN/中文 detection (zero-weighting macOS `PingFang.ttc` to avoid false positives) and a zero-dependency in-app updater enforced by a strict GitHub HTTPS allowlist, zip-slip protection, SHA-256 backend diff detection, and atomic swap with rollback.
- **Antigravity CLI `/statusline` & Bundled `/agy-hud` Read-Only Skill** — Ships a zero-dependency terminal status-line adapter ([`statusline.ts`](plugin/sidecars/hud_panel/statusline.ts)) that consumes Antigravity CLI's official `/statusline` JSON stdin stream and enriches it with live `GEN TPS`, `TTFT`, Context headroom, and Cache TTL survival (`--two-line` and `--stack` supported), paired with the bundled [`/agy-hud`](plugin/skills/agy-hud/SKILL.md) skill so starter prompts and chat queries can inspect telemetry directly on demand.

---

## <a id="shortcuts"></a>Keyboard Shortcuts & Chart Controls

| Shortcut / Gesture | Action |
| :--- | :--- |
| `1` / `2` / `3` | Switch between **Live**, **Calls**, and **Account** tabs |
| `/` | Focus Call Log search (auto-switches to **Calls** tab) |
| `Esc` | Clear search, close popovers, or dismiss chart crosshair |
| **Drag horizontally** on Trend Chart | Draw a marquee (`≥ 8 px`) to zoom into that range |
| **Click** a point/bar on Trend Chart | Jump directly to and expand that call in the Call Log |
| `Ctrl` / `Cmd` / `Shift` + **Wheel** | Smooth cursor-centered zoom (never hijacks page scroll) |
| **Minimap Brush** | Drag handles to resize, drag body to pan, click track to jump, double-click to reset |

---

## Privacy, Architecture & FAQ

- **100% Local Read-Only Telemetry**: AGY-HUD reads `~/.gemini/antigravity/conversations/<uuid>.db` (`?mode=ro`), local loopback Language Server RPC, and on-disk Swarm metadata. Prompts, code, and local telemetry never leave your machine; outbound requests are strictly read-only public fetches (GitHub release checks and toggleable Gemini Global Pulse status feeds).
- **Zero Patching, Survives Updates**: Because AGY-HUD is a standard Antigravity sidecar plugin—never touching `app.asar` or requiring CDP flags—it keeps working across Antigravity updates and launches cleanly from your normal app icon.
- **Why Node.js 22.18+?** Built-in `node:sqlite` and native TypeScript stripping allow the entire sidecar backend and installer to run with **zero runtime npm dependencies**.

---

## Documentation & Development

| Resource | Description |
| :--- | :--- |
| [Launch Website](https://agy-hud.512.pub/) | Interactive 3-tab HUD preview, 16-theme sync & OS install picker ([`site/`](site/)) |
| [Gemini Pulse Radar](https://agy-hud.512.pub/pulse/) | Standalone 5-minute global Gemini TTFT, TPS, cache hit & GCP incident dashboard ([`workers/gemini-pulse/`](workers/gemini-pulse/)) |
| [Installation & Self-Upgrade Guide](docs/INSTALLATION.md) | Custom paths, pinned versions, `--doctor`, security model & troubleshooting ([中文](docs/INSTALLATION.zh-CN.md)) |
| [User & Technical Guide](docs/GUIDE.md) | Deep dive into Swarm Cockpit, Gemini Pulse, Cache TTL math, IRLS `k`-fitter, Protobuf map & API ([中文](docs/GUIDE.zh-CN.md)) |
| [AGENTS.md](AGENTS.md) | Copy-pasteable install & verification guide for AI coding agents |
| [CHANGELOG.md](CHANGELOG.md) | Full release history |

<details>
<summary><strong>Local development & test commands</strong></summary>

```bash
# Build UI bundle (Preact + TypeScript + Tailwind CSS v4 -> plugin/sidecars/hud_panel/ui/)
npm --prefix web install
npm run build:ui
npm --prefix web run dev          # watch mode paired with `node plugin/install.mjs --link`

# Full verification: web/site/worker typecheck + sidecar, worker & tools test suites
npm run check
npm run build:site
```

</details>

---

## Acknowledgments & Inspirations

AGY-HUD stands on the shoulders of the Antigravity open-source community:

- **[adahime/agy-hud](https://github.com/adahime/agy-hud)** by [@adahime](https://github.com/adahime) — Upstream fork origin that pioneered read-only local SQLite/WAL protobuf (`f19` / `gen_metadata`) telemetry and the original Antigravity 2.0 side-pane plugin architecture.
- **[ATtacK030130/antigrative-dashboard](https://github.com/ATtacK030130/antigrative-dashboard)** — Inspired our hatched diagonal Quota Runway bar, Monochrome Token Iceberg visualization, and restrained editorial aesthetic.
- **[yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)** — Inspired our borderless layered surface hierarchy, 2-column aligned Context Window table, and concise sidebar navigation.
- **[WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)** — Inspired our bottom-anchored Hero sparkline and smooth borderless activity heatmap.
- **[AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor)** — Inspired our `AGENTS.md` one-sentence AI-agent installation workflow.

Released under the [MIT License](LICENSE).
