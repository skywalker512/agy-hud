# AGY-HUD Gemini Pulse Collector & Edge Gateway (Cloudflare Workers Free + KV)

Zero-cost (**$0/month, no credit card required**) 5-minute telemetry collector & edge gateway for `https://agy-hud.512.pub`:

- **Cron**: Runs every **5 minutes** (`*/5 * * * *`) → **288 KV writes/day** (28.8% of the 1,000/day Free Tier limit). Refreshes 7d comparison curves every 30 minutes and reuses them from KV between ticks.
- **Storage**: Compact JSON snapshot with a rolling **24-hour 5-minute ring buffer (288 points)** + 7d TTFT / E2E / TPS / Cache / Uptime series + P99 tail latency + Tool Call error rate + Google Cloud Service Health incidents.
- **Unified Custom Domain (`https://agy-hud.512.pub`)**:
  - `GET /` → Official AGY-HUD Website (edge-proxied & cached from GitHub Pages)
  - `GET /pulse/` → Standalone Gemini 5m Live Pulse Radar
  - `GET /v1/pulse.json` → Full CORS-enabled, edge-cached (`max-age=90`) Gemini telemetry feed
  - `GET /v1/health` → Collector health & 5m ring-buffer point count

## Deploy in 3 Minutes ($0 Free Tier)

```bash
cd workers/gemini-pulse
npm install

# 1. Sign in to Cloudflare (opens browser, no credit card required for Workers Free + KV)
npx wrangler login

# 2. Create the KV namespace and copy the returned `id` into wrangler.jsonc
npx wrangler kv namespace create GEMINI_PULSE_KV

# 3. Deploy the Worker + 30m Cron Trigger
npx wrangler deploy
```

### Trigger the First Snapshot Immediately (Optional)

The Worker automatically seeds KV on the first `GET /v1/pulse.json` request if empty. To force a manual refresh:

```bash
npx wrangler secret put REFRESH_TOKEN
curl -X POST https://agy-hud.512.pub/v1/refresh \
  -H "Authorization: Bearer <your-token>"
```

## Live Production Feed

- **Official Worker Endpoint**: `https://agy-hud.512.pub/v1/pulse.json` (health: `https://agy-hud.512.pub/v1/health`)
- **Official Website `/pulse/`**: Connected to `https://agy-hud.512.pub` by default (can be overridden via `?feed=...` or switched to direct browser mode).
- **AGY-HUD Sidecar**: Uses `https://agy-hud.512.pub` by default with automatic fallback to direct OpenRouter + local 48h 30m cache (`AGY_HUD_PULSE_FEED_URL=direct` disables the remote feed).
