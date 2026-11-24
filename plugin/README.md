# AGY-HUD Antigravity 2.0 Plugin

Auxiliary side-pane UI plugin (`Live` / `Calls` / `Account`) displaying real-time Token/s (`GEN` & `E2E`), `TTFT` root-cause attribution, Gemini Global Pulse & Cyber Arena PK, actual routed model ID (`f19`), context window X-Ray, Prompt Cache TTL survival, recursive Swarm/subagent rollup, calibrated `5h` / `7d` quota runway, and 2x Wrapped share posters.

Requires **Node.js >= 22.18** (for built-in `node:sqlite` and native TypeScript stripping).

## Install

```bash
# Standard staged copy install
node plugin/install.mjs

# Live development symlink mode
node plugin/install.mjs --link
```

Restart or reload Antigravity plugins if the side-pane icon does not appear immediately. To remove:

```bash
node plugin/install.mjs --uninstall
```

## Run Unit Tests

```bash
npm run test:sidecar
```
