# EagleBot — Bot Engine Server

Standalone Node.js server that processes Telegram bot interactions.

## Setup

1. Install dependencies: `npm install`
2. Copy `env.example` to `.env` and fill in values: `cp server/env.example server/.env`
3. Start Redis: `redis-server`
4. Start dev server: `npm run dev`

> The template is `server/env.example`, **without** the leading dot. A file
> named `.env.example` is swallowed by the `.env*` rule in `.gitignore:34`,
> so it never reaches a clone — step 2 used to point at a file that was not
> there.

## Environment Variables

Full list with comments: [`env.example`](./env.example).

### Required (the boot asserts these)

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (NOT anon key)
- `BASE_WEBHOOK_URL` — Public URL for this server (e.g., https://your-domain.com)

### Common

- `PORT` — Server port (default: 3001)
- `REDIS_URL` — Redis connection URL (default: redis://localhost:6379)
- `PUBLIC_APP_URL` — Public URL of the Next.js front (the Mini App lives there)
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — MTProto credentials from
  https://my.telegram.org, needed for cloning and scheduled campaigns

### Next ↔ worker, and the AI (scheduled post campaigns)

These four are what the scheduled-campaign feature needs, and getting them
wrong reads as a broken product rather than as missing configuration.

- `INTERNAL_API_SECRET` — shared secret for the three internal endpoints
  (`POST /api/mtproto/enqueue`, `POST /api/mtproto/ensure-bot-access`,
  `POST /api/ai/assist`). **The same value must be set in the Next app's
  `.env`, under the same name.** An unset secret NEVER authorises: it means
  "not configured", not "open". With it unset, the "promote the bot" button
  and all three assistant buttons answer 503 forever. Generate one with
  `openssl rand -hex 32`.
- `GEMINI_API_KEY` — Google Gemini key for the AI treatment of a cloned
  draft. Empty disables the AI silently (same pattern as VAPID); nothing here
  may keep the worker from booting. Worker only — this key is **not**
  replicated in the Next `.env`.
- `GEMINI_MODEL` — default `gemini-3.8-flash`. Swappable without a deploy;
  confirm the exact model name on ai.google.dev before changing it.
- `NEXT_PUBLIC_BOT_SERVER_URL` — set in the **Next app's** `.env`, not here.
  It is the URL of this server, and it is what every Server Action uses to
  reach the endpoints above (default `http://localhost:3001`). The design doc
  called it `BOT_SERVER_URL` in §5.1; the code has always read
  `NEXT_PUBLIC_BOT_SERVER_URL`, and that is the name that works.

## Endpoints

- `GET /health` — Health check
- `POST /webhook/:botId` — Telegram webhook receiver
- `POST /api/bots/:botId/register-webhook` — Register Telegram webhook for a bot

## Architecture

The engine receives Telegram updates via webhooks, looks up the lead and active flow,
then executes flow nodes sequentially. Delay nodes schedule future execution via BullMQ.
Input and button nodes pause execution until the user responds.
