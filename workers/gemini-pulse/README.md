# AGY-HUD Gemini Pulse Collector & Edge Gateway (Cloudflare Workers Free + KV)

Zero-cost (**$0/month, no credit card required**) 5-minute telemetry collector & edge gateway for `https://agy-hud.512.pub`:

- **Cron**: Runs every **5 minutes** (`*/5 * * * *`) → **288 KV writes/day** (28.8% of the 1,000/day Free Tier limit). Refreshes 7d comparison curves every 30 minutes per model and reuses them from KV between ticks.
- **Storage**: Compact JSON snapshot with a rolling **24-hour 5-minute ring buffer (288 points)** + 7d TTFT / E2E / TPS / Cache / Uptime series + evenly downsampled 24h availability + P99 tail latency + Tool Call error rate + Google Cloud Service Health incidents.
- **Unified Custom Domain (`https://agy-hud.512.pub`)**:
  - `GET /` → Official AGY-HUD Website (served via Cloudflare Workers Static Assets)
  - `GET /pulse/` → Standalone Gemini 5m Live Pulse Radar (Workers Static Assets)
  - `GET /v1/pulse.json` → Full CORS-enabled, edge-cached (`max-age=90`, ETag/304) Gemini telemetry feed
  - `GET /v1/health` → Edge-cached (`max-age=30`) collector health & 5m ring-buffer point count

## Deploy in 3 Minutes ($0 Free Tier)

```bash
cd workers/gemini-pulse
npm ci

# 1. Sign in to Cloudflare (opens browser, no credit card required for Workers Free + KV)
npx wrangler login

# 2. Create the KV namespace and copy the returned `id` into wrangler.jsonc
npx wrangler kv namespace create GEMINI_PULSE_KV

# 3. Build static site & deploy the Worker + 5m Cron Trigger
npm run deploy
```

### Trigger the First Snapshot Immediately (Optional)

If KV is empty on cold start, `GET /v1/pulse.json` triggers a background seed behind a short KV lock and returns `503` with `Retry-After: 10`. To force an immediate manual refresh:

```bash
npx wrangler secret put REFRESH_TOKEN
curl -X POST https://agy-hud.512.pub/v1/refresh \
  -H "Authorization: Bearer <your-token>"
```

## Live Production Feed

- **Official Worker Endpoint**: `https://agy-hud.512.pub/v1/pulse.json` (health: `https://agy-hud.512.pub/v1/health`)
- **Official Website `/pulse/`**: Connected to `https://agy-hud.512.pub` by default (can be overridden for the session via `?feed=...` or switched to direct browser mode).
- **AGY-HUD Sidecar**: Uses `https://agy-hud.512.pub` by default with automatic fallback to direct OpenRouter + local 24h 5m ring buffer (`AGY_HUD_PULSE_FEED_URL=direct` disables the remote feed).
