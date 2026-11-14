# AGY-HUD Antigravity 2.0 Plugin

Auxiliary side-pane UI plugin (`Live` / `Calls` / `Account`) displaying real-time Token/s (`GEN` & `E2E`), `TTFT`, actual routed model ID (`f19`), context window composition & per-tool token footprint, live streaming thinking/reply traces with phase diagnostics, subagent/Side-Q hierarchy, and `5h` / `7d` quota + API-equivalent spend.

Requires **Node.js >= 22.5** (for built-in `node:sqlite`).

## Install

```bash
# Standard staged copy install
python plugin/install_plugin.py

# Live development symlink mode
python plugin/install_plugin.py --link
```

Restart or reload Antigravity plugins if the side-pane icon does not appear immediately. To remove:

```bash
python plugin/install_plugin.py --uninstall
```

## Run Unit Tests

```bash
node --test plugin/sidecars/hud_panel/test/server.test.mjs
```
