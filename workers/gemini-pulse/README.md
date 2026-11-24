# AGY-HUD Gemini Pulse Collector (Cloudflare Workers Free + KV)

Zero-cost (**$0/month, no credit card required**) 30-minute telemetry collector for the 5 Gemini models tracked by AGY-HUD (`Gemini 4 Neon`, `Hydrogen`, `Carbon`, `Argon`, `3.8 Flash`).

- **Cron**: Runs every 30 minutes (`*/30 * * * *`) → **48 KV writes/day** (< 5% of the 1,000/day Free Tier limit).
- **Storage**: Single compact JSON snapshot (`~40 KB`) with a rolling **48-hour 30m ring buffer** + 7d TTFT / E2E / TPS / Cache / Uptime series + P99 tail latency + Tool Call error rate + Google Cloud Service Health incidents.
- **Endpoints**:
  - `GET /v1/pulse.json` — Full CORS-enabled, edge-cached (`max-age=180`) Gemini telemetry feed.
  - `GET /v1/health` — Collector status & 30m ring-buffer point count.

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
