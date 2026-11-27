# AGY-HUD — Live Telemetry & CLI `/statusline` for Google Antigravity

Auxiliary side-pane UI plugin (`Live` / `Calls` / `Account`), bundled read-only `/agy-hud` Agent Skill, and Antigravity CLI `/statusline` adapter displaying real-time Token/s (`GEN` & `E2E`), live first-token `TTFT` monitor, Gemini Global Pulse & Cyber Arena PK, actual routed model ID (`f19`), Context Window X-Ray, Prompt Cache TTL survival, recursive Swarm/subagent rollup, calibrated `5h` / `7d` quota runway, and 2x Wrapped share posters.

Requires **Node.js >= 22.18** (for built-in `node:sqlite` and native TypeScript stripping). Zero runtime dependencies · 100% local read-only.

## Install

```bash
# Official Antigravity CLI plugin install (from local clone)
agy plugin validate --strict ./plugin
agy plugin install ./plugin

# Or atomic staged copy install via included zero-dependency installer
node plugin/install.mjs

# Live development symlink mode
node plugin/install.mjs --link
```

## Antigravity CLI `/statusline` & `/agy-hud` Skill

- **Bundled `/agy-hud` Skill**: Ask Antigravity about your current turn's `GEN/E2E TPS`, `TTFT`, context window breakdown, Prompt Cache TTL survival, or `5h`/`7d` quota runway (or click any starter prompt chip on the plugin page).
- **Terminal `/statusline` HUD**: Run `node plugin/install.mjs --statusline` (or `node ~/.gemini/config/plugins/agy-hud/sidecars/hud_panel/statusline.ts --setup-statusline`) to enable the width-adaptive AGY-HUD status bar inside `agy` CLI (`--two-line` and `--stack` supported).

Restart or reload Antigravity plugins if the side-pane icon does not appear immediately. To remove:

```bash
node plugin/install.mjs --uninstall-statusline
node plugin/install.mjs --uninstall
```

## Run Unit Tests

```bash
npm run test:sidecar
```
