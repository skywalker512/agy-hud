---
name: agy-hud
description: >-
  Inspect live Google Antigravity telemetry from AGY-HUD (GEN/E2E TPS, TTFT,
  context window X-Ray breakdown, Prompt Cache TTL survival, calibrated 5h/7d
  quota runway, Swarm rollup, and slow/expensive call diagnostics) or configure
  the AGY-HUD Antigravity CLI /statusline. Use when the user asks about model
  speed, latency, context usage, cache hit rate, quota remaining, session spend,
  or clicks an AGY-HUD starter prompt.
---

# AGY-HUD Read-Only Telemetry & CLI Statusline Skill

Use this skill to answer user questions about live Google Antigravity performance, context window composition, Prompt Cache TTL survival, 5h/7d quota runway, Swarm rollup, or to configure the Antigravity CLI `/statusline`.

All telemetry inspection is **100% local and read-only** (`node:sqlite` `?mode=ro`). Never patch `app.asar`, inject JavaScript, or launch Antigravity with `--remote-debugging-port`.

## 1. Inspect Live Telemetry

Run the bundled helper script from this skill directory:

```bash
# Structured Markdown telemetry snapshot (recommended for reading & summarizing)
node scripts/inspect.mjs --inspect

# Machine-readable JSON snapshot (when filtering or doing calculations)
node scripts/inspect.mjs --inspect --json

# Inspect more recent calls or target a specific conversation UUID
node scripts/inspect.mjs --inspect --calls 15
node scripts/inspect.mjs --inspect --conversation <conversation-uuid>
```

### How to Present Results

- **Speed & Latency**: Distinguish post-TTFT streaming speed (`GEN TPS`) from end-to-end speed (`E2E TPS`), highlight `TTFT` (flagging turns `> 3s`), and note single-packet `BUF` responses separately so averages are clear.
- **Context Window & Headroom**: Report current token usage vs. cap, `%` used, estimated headroom turns (`~Nt`), and top context consumers (especially `Tool Results` / `Tool Defs` bloat if present).
- **Prompt Cache & TTL**: Report latest & session cache hit rate, estimated `P80` / `P50` survival window, live survival probability, and the dollar/quota penalty if the cache expires.
- **Quota & Spend**: Report session spend (and recursive subagent/Swarm tree rollup when present), local history totals, and live 5h/7d quota pools + runway if available from the Language Server.
- **Actionable Recommendation**: End with 1–2 concise takeaways (e.g., whether to `/compact`, continue before cache TTL expires, or inspect a slow tool call).

## 2. Configure Antigravity CLI `/statusline`

When the user asks to enable, preview, check, or remove the AGY-HUD terminal status bar for Antigravity CLI (`agy`):

```bash
# Preview the rendered terminal statusline
node scripts/inspect.mjs

# Enable AGY-HUD in ~/.gemini/antigravity-cli/settings.json (atomic 0600 write)
node scripts/inspect.mjs --setup-statusline

# Optional: 2-line rich layout or stack below the built-in status line
node scripts/inspect.mjs --setup-statusline --two-line
node scripts/inspect.mjs --setup-statusline --stack

# Check current CLI statusLine status
node scripts/inspect.mjs --status

# Remove AGY-HUD from ~/.gemini/antigravity-cli/settings.json
node scripts/inspect.mjs --remove-statusline
```

Remind the user that inside an active `agy` CLI session they can also toggle or reset the status line at any time via `/statusline on`, `/statusline off`, or `/statusline delete`.

## 3. Opening the Visual Side Pane

If the user asks to open the visual **AGY-HUD** side pane in the Antigravity App:
- Surface the AGY-HUD side-pane toggle if UI plugin navigation is available, or guide them to click the **AGY-HUD** icon in the Auxiliary Side Pane (`Live` · `Calls` · `Account`).
