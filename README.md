<div align="center">

<img src="docs/assets/banner.svg" alt="AGY-HUD Banner" width="100%" />

<p>
  <strong>Real-time token speed, TTFT, actual routed model ID, and context window monitor for the Google Antigravity app</strong>
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-22.5%2B%20node%3Asqlite-06b6d4?style=flat-square" alt="Node.js 22.5+ node:sqlite" />
  <img src="https://img.shields.io/badge/Runtime%20Deps-Zero-10b981?style=flat-square" alt="Zero Runtime Dependencies" />
  <img src="https://img.shields.io/badge/UI-EN%20%2F%20%E4%B8%AD%E6%96%87-6366f1?style=flat-square" alt="EN / 中文" />
</p>

<p>
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p>
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#protobuf-map">Data Fields</a> ·
  <a href="#development">Development</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

</div>

---

<div align="center">
  <img src="docs/assets/hud-showcase.svg" alt="AGY-HUD Side-Pane Preview" width="60%" />
</div>

---

## <a id="overview"></a>Overview

**AGY-HUD** is a side-pane plugin for the Google Antigravity 2.0 app. It reads Antigravity's local SQLite conversation databases (`~/.gemini/antigravity/conversations/<uuid>.db` and `-wal`) in read-only mode, plus the local loopback Language Server for live streaming steps and 5h/7d quota windows. Without proxying any API traffic, it shows generation throughput, `TTFT`, the **actual routed backend model ID**, context window composition, per-call phase timing, subagent/Side-Q trees, and API-equivalent spend.

### Key Features

- **Actual Routed Model ID First**: Prioritizes protobuf field `f19`, the actual routed backend model identifier (such as `gemini-4-carbon` or `gemini-3.8-flash-k`), and normalizes LS generator aliases (e.g. `-high` / `MODEL_PLACEHOLDER_*`). Reads the reported context limit from `f9.f10.f4` (for example `256,000`), falling back to pattern-matched model limits only when omitted.
- **Generation, End-to-End & Phase Diagnostics**: Reports both post-TTFT streaming speed (`GEN TPS`) and overall speed including `TTFT` (`E2E TPS`). Single-packet buffered responses are flagged as `BUF` and excluded from both `PEAK TPS` and weighted `AVG GEN`, so averages never exceed peak throughput. Slow tool-call turns separate `THK` from `TOOL GEN` duration (`TC-WAIT`) and clamp tool execution intervals so model streaming time never inflates `TOOL TIME`.
- **3-Tab Side Pane (`Live` / `Calls` / `Account`)**:
  - **Live**: Real-time `GEN`/`E2E` speed cards, context window breakdown (`Sys Prompt`, `Tool Defs`, `Tool Results`, `Model Replies`, `User/Ckpt`, plus per-tool token footprint), recent calls with auto-scrolling live `THINKING` / `REPLY` previews, and linked **Subagent / Side-Q** navigation.
  - **Calls**: Multi-metric trend chart (`TPS` / `TTFT` / `OUT` / `CACHE` / `CTX`), collapsible turn dividers, context compaction cards, and on-demand expandable call traces (`60k` char detail cap).
  - **Account**: Dual `5h` / `7d` quota pool windows with countdowns, local API-equivalent spend (`Session` / `Today` / `Month` / `All DBs`), cache savings, and non-blocking background indexing across large conversation histories.
- **Zero Runtime Dependencies**: The sidecar runs on Antigravity's built-in `sidecar_sdk` and Node.js 22.5+ built-in `node:sqlite`. The UI is a prebuilt bundle and switches between `EN` and `中文`.

---

## <a id="quick-start"></a>Quick Start

Install into `~/.gemini/config/plugins/agy-hud` (reload or restart Antigravity if the icon does not appear immediately):

```bash
# Copy-install (staged atomic replace; requires Node.js >= 22.5)
node plugin/install.mjs

# Or symlink the repo's plugin/ folder for live development hot-reload
node plugin/install.mjs --link
```

To uninstall:

```bash
node plugin/install.mjs --uninstall
```

---

## <a id="protobuf-map"></a>Data Fields

AGY-HUD reads `gen_metadata` and `steps` from `~/.gemini/antigravity/conversations/<uuid>.db`:

| Field Path | Decoded Data | Fallback |
| :--- | :--- | :--- |
| `gen_metadata.f1.f19` | **Routed backend model identifier** (e.g. `gemini-3.8-flash-k`) | UI display label (`f1.f21`) |
| `gen_metadata.f1.f4` | Cached (`f5`), new input (`f2`), output (`f3` or `f1`), thinking (`f9`), visible (`f10`) | Legacy usage (`f1.f17.f2`) |
| `gen_metadata.f1.f9.f10` | Active context size (`f1`) and window limit (`f4`, e.g. `256,000`) | `cached + new_input`; per-model limit table |
| `gen_metadata.f1.f11` / `f1.f12` | Time to first token (`TTFT`, `f11`) and streaming duration (`f12`) | `0.0s` |
| `steps` (`status != 3`) | Active generation timer (`step_type = 15`), `TOOL` state on other non-terminal steps, timestamps mapped via `f1.f20` | Idle state |

---

## <a id="development"></a>Development

The sidecar backend lives in `plugin/sidecars/hud_panel/` and needs no build. The UI source is in `web/` (Preact + TypeScript + Tailwind) and builds into `plugin/sidecars/hud_panel/ui/`:

```bash
cd web
npm install
npm run build      # typecheck + build into the plugin's ui/ folder
npm run dev        # rebuild on change (pair with `node plugin/install.mjs --link`)
```

Run the tests:

```bash
node --test plugin/sidecars/hud_panel/test/server.test.mjs
```

---

## Project Structure

```text
agy-hud/
├── plugin/                      # Antigravity 2.0 side-pane plugin (what gets installed)
│   ├── plugin.json              # Plugin manifest
│   ├── install.mjs              # Installer / uninstaller
│   ├── assets/logo.svg          # Plugin icon
│   └── sidecars/hud_panel/      # node:sqlite backend (lib/, pricing.json) & built UI (ui/)
├── web/                         # UI source (Preact + TypeScript + Tailwind)
├── tools/                       # Trace collector / replay CLI for regression fixtures
├── docs/
│   └── assets/                  # SVG banner and preview graphics
├── CHANGELOG.md
└── LICENSE
```

---

## License

Released under the [MIT License](LICENSE).
