<div align="center">

<img src="docs/assets/banner.svg" alt="AGY-HUD Banner" width="100%" />

<p>
  <strong>Live telemetry for Google Antigravity — real-time speed, TTFT waterfalls, prompt cache survival, calibrated quota runway, and native Swarm visibility right in your side pane.</strong>
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
  <a href="https://skywalker512.github.io/agy-hud/">Website</a> ·
  <a href="#quick-install">Quick Install</a> ·
  <a href="#interface-tour">Tour</a> ·
  <a href="#craftsmanship">Craftsmanship</a> ·
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
curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh
```

### Windows (PowerShell 5.1+ / 7+)

```powershell
irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex
```

### AI Agent Install (1 Sentence)

Paste this into Antigravity, Claude Code, Codex, or any coding agent (instructions live in [`AGENTS.md`](AGENTS.md)):

> `Install agy-hud from https://github.com/skywalker512/agy-hud following AGENTS.md and verify the installation.`

<details>
<summary><strong>Source install, dev hot-reload (<code>--link</code>), <code>--doctor</code>, and uninstall</strong></summary>

```bash
git clone https://github.com/skywalker512/agy-hud.git && cd agy-hud
node plugin/install.mjs          # Atomic copy-install to ~/.gemini/config/plugins/agy-hud
node plugin/install.mjs --link   # Dev symlink (macOS/Linux) or junction (Windows)
node plugin/install.mjs --doctor # Run 6 environment & bundle health checks
node plugin/install.mjs --update # Safe CLI upgrade with automatic rollback
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
- **Native AGY Swarm Cockpit**: Automatically appears on Swarm sessions to track `@rosterName` worker states, active tasks, `Board #seq`, rolled-up swarm burn, and one-click coordinator↔worker breadcrumbs.

### 2. Calls — *Why was that turn slow or expensive?*
- **Full-Session Trend Explorer**: Never locked to the last 32 calls. Switch across 6 metrics (`TPS`, `TTFT`, `OUT`, `CACHE`, `CTX`, `QUOTA%`), scrub history with the **Minimap Brush**, drag-to-zoom on the canvas, lock/unlock **`Follow Live`**, and click any point to jump straight to that call.
- **5-Tab Call Detail Inspector**: Click any call row to inspect `Overview` (4-cell strip, proportional **Timing Waterfall** for `TTFT / Think / Tool Gen & TC-WAIT / Reply`, and **Token Composition Bar**), `Thinking`, `Tools`, `Reply`, and `Raw`.
- **Search, Filter & Export**: Hit `/` to search across models, prompts, and tool names; filter anomalies (`Slow TTFT >3s`, `Low Cache <60%`, `Stall / Buf`, `Compacts`); sort by slowest or costliest; or copy a clean **Markdown / JSON** report in one click.

### 3. Account — *How long will my quota last?*
- **Dual 5h / 7d Quota Runway**: Hatched diagonal runway bars show projected burn before reset right inside the progress bar—so you can tell at a glance whether your current pace finishes safely or runs dry early.
- **Calibrated `k`-Multiplier Rules & Prompt Cache TTL**: See empirically fitted quota multipliers per model family alongside 7-bucket Prompt Cache survival curves (`P80` / `P50` safe windows and cumulative expired-cache cost).
- **Unified Ledger, 16w/52w Heatmap & Iceberg View**: Automatically merges App, CLI (`agy`), ACP, and IDE stores into one spend grid, a **16-week / 52-week Activity Heatmap**, and a **Monochrome Token Iceberg** view (New Tokens above baseline vs Cached Read below baseline), plus 1-click in-app updates.

---

## <a id="craftsmanship"></a>Craftsmanship & Details

- **Native Host Theme, Font & Strong-Contrast Sync** — [`useThemeSync.ts`](web/src/hooks/useThemeSync.ts) samples Antigravity's live CSS variables (`--background`, `--card`, `--primary`), font family, font scale, and high-contrast mode via `MutationObserver` and host `theme-change` events. Layered borderless cards, custom SVG icons, custom popover selects, and a scroll-aware `PulseBar` (which stays hidden at the top of `Live` so numbers never duplicate) make the HUD feel built into Antigravity.
- **Prompt Cache TTL Survival Modeling** — [`cache-ttl.ts`](plugin/sidecars/hud_panel/lib/cache-ttl.ts) fits a regularized Log-Logistic survival curve $S(t) = (1 - p_0) / (1 + (t / t_{50})^k)$ per model family (`P80` / `P50` horizons, distinct sharp TTL cliffs for Claude vs gentle LRU decay for Gemini), giving live expiry probability and exact miss penalty in USD and `5h` quota `%`.
- **Quota Runway & Empirical IRLS Calibration** — Fits per-model `k`-multipliers and Claude 3-parameter token ridge weights using Huber/Tukey IRLS + adaptive `6σ` MAD outlier rejection over clean short windows (`≤ 15 min`), isolating remote spend gaps and showing out-of-sample (`OOS`) validation status before dropping `provisional` tags.
- **True Telemetry Fidelity** — Opens local SQLite + WAL databases strictly read-only (`node:sqlite`, `?mode=ro`), decodes Protobuf `gen_metadata.f1.f19` for the actual backend routed model ID and `f9.f10.f4` for the real context cap, isolates single-packet `BUF` bursts so sustained `AVG GEN` never exceeds `PEAK`, separates `THK` from `TC-WAIT` tool stalls, and unifies App + CLI (`agy`) + ACP + IDE sibling stores.
- **First-Class Native AGY Swarm Cockpit** — Directly reads Antigravity's on-disk swarm state (`swarm.json`, `members.json`, `plan.json`, bounded tail reads of `board.jsonl`) with combined `mtime` caching. Surfaces live pulsing `@rosterName` states, task summaries, `Flat | By Thread` grouping, `share`/`branch` worktree badges, `Board #seq`, rolled-up swarm quota/cost, and reverse-indexed worker→coordinator navigation.
- **Account Insights, Smart Locale & Hardened Self-Updater** — Combines 16w/52w Activity Heatmaps and the Monochrome Token Iceberg view with multi-signal EN/中文 detection (zero-weighting macOS `PingFang.ttc` to avoid false positives) and a zero-dependency in-app updater enforced by a strict GitHub HTTPS allowlist, zip-slip protection, SHA-256 backend diff detection, and atomic swap with rollback.

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

- **100% Local Read-Only**: AGY-HUD reads `~/.gemini/antigravity/conversations/<uuid>.db` (`?mode=ro`), local loopback Language Server RPC, and on-disk Swarm metadata. Prompts, code, and telemetry never leave your machine. The only optional outbound request is checking/downloading releases from `github.com/skywalker512/agy-hud`.
- **Zero Patching, Survives Updates**: Because AGY-HUD is a standard Antigravity sidecar plugin—never touching `app.asar` or requiring CDP flags—it keeps working across Antigravity updates and launches cleanly from your normal app icon.
- **Why Node.js 22.18+?** Built-in `node:sqlite` and native TypeScript stripping allow the entire sidecar backend and installer to run with **zero runtime npm dependencies**.

---

## Documentation & Development

| Resource | Description |
| :--- | :--- |
| [Launch Website](https://skywalker512.github.io/agy-hud/) | Interactive 3-tab HUD preview & OS install picker ([`site/`](site/)) |
| [Installation & Self-Upgrade Guide](docs/INSTALLATION.md) | Custom paths, pinned versions, `--doctor`, security model & troubleshooting ([中文](docs/INSTALLATION.zh-CN.md)) |
| [User & Technical Guide](docs/GUIDE.md) | Deep dive into Swarm Cockpit, Cache TTL math, IRLS `k`-fitter, Protobuf map & API ([中文](docs/GUIDE.zh-CN.md)) |
| [AGENTS.md](AGENTS.md) | Copy-pasteable install & verification guide for AI coding agents |
| [CHANGELOG.md](CHANGELOG.md) | Full release history |

<details>
<summary><strong>Local development & test commands</strong></summary>

```bash
# Build UI bundle (Preact + TypeScript + Tailwind CSS v4 -> plugin/sidecars/hud_panel/ui/)
npm --prefix web install
npm --prefix web run build
npm --prefix web run dev          # watch mode paired with `node plugin/install.mjs --link`

# Full verification: backend typecheck + UI build + all unit & trace tests
npm --prefix plugin/sidecars/hud_panel run check
node --test tools/test/trace.test.mjs
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
