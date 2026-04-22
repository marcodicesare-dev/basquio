# Basquio Discord bot

The Discord bot captures voice + text from the Basquio Discord workspace, transcribes via Deepgram, summarizes via Anthropic, and writes structured rows to the `transcripts` and `transcript_chunks` tables in Supabase. Long-lived process. Always-on. Single source of truth for team voice context.

## Railway deploy contract (CRITICAL — read before touching anything in this directory)

This service is one of multiple Railway services inside the `basquio-bot` Railway project. The other service is the deck worker (built from the repo root `Dockerfile.worker` + `scripts/worker.ts`). **The two services have NOTHING to do with each other except sharing the Railway project shell.**

Hard rules:

1. **`apps/bot/railway.toml` is the source of truth for this service.** In the Railway dashboard, the `basquio-bot` service must have its "Config-as-Code Path" set to `apps/bot/railway.toml`. Do NOT let it fall back to the repo-root `railway.toml` — that file is the deck worker config and will crash the bot on first deploy.
2. **Build path:** `apps/bot/Dockerfile` only. Never `Dockerfile.worker`.
3. **Start command:** `pnpm start` (resolves to `tsx src/index.ts` per `apps/bot/package.json`). Never `node --import tsx scripts/worker.ts` — that's the deck worker entry.
4. **Watch patterns:** `apps/bot/**`, `packages/types/**`, `code/contracts.ts`, lockfile, workspace file. NOTHING ELSE. Editing `scripts/**`, `packages/workflows/**`, `apps/web/**` must NEVER trigger a bot redeploy.
5. **Env var convention:** the bot uses `SUPABASE_URL` (no `NEXT_PUBLIC_` prefix). Do NOT rename it; the bot is not a Next.js app, and renaming will break the deployed env.

## What broke on April 21, 2026 (so this never happens again)

- Three commits on Apr 21 between 00:22 and 01:37 UTC (`7792727`, `d77142e`, `cbb6445`) hardened the deck worker by rewriting the repo-root `railway.toml`.
- The Discord bot Railway service was silently consuming that root file because it had no service-scoped override. The new deck-worker start command crash-looped on the bot service (`NEXT_PUBLIC_SUPABASE_URL is required` — a deck-worker-only env var name).
- Bot died at Apr 20 21:14 UTC. The 2-hour Apr 21 strategy call was never recorded. No audio, no transcript, no recovery.
- Forensic write-up + rules: `docs/decision-log.md` ("Service-scoped Railway configs"), `rules/canonical-rules.md` ("Railway / Multi-Service Deploy Rules"), `memory/canonical-memory.md` ("Production Incident Memory: April 21, 2026").

## Audit-before-touch checklist

Before pushing any change to `apps/bot/**`, `apps/bot/railway.toml`, or `apps/bot/Dockerfile`:

```bash
# 1. Confirm what services exist in the project
railway list

# 2. Read the env vars on every service that might consume your file
railway variables --service basquio-bot

# 3. After deploy, tail logs for 60s and confirm no crash loop
railway logs --service basquio-bot
```

If you see `[basquio-worker]` in the bot's logs — STOP. The bot is running the wrong code. The Railway dashboard's Config-as-Code Path is wrong; fix it before doing anything else.

## Local development

```bash
cd apps/bot
pnpm install
cp .env.example .env  # fill in DISCORD_BOT_TOKEN, DEEPGRAM_API_KEY, etc.
pnpm dev
```

Required env vars (production list lives on Railway):
- `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_VOICE_CHANNEL_ID`, `DISCORD_GENERAL_CHANNEL_ID`, `DISCORD_DOCS_CHANNEL_ID`, `DISCORD_LIVECHAT_CHANNEL_ID`
- `DEEPGRAM_API_KEY`
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `LINEAR_API_KEY`, `LINEAR_TEAM_ID`
- `INTERCOM_ACCESS_TOKEN`, `INTERCOM_ADMIN_ID`, `INTERCOM_API_BASE_URL`

## Health verification

A successful end-to-end test:

1. Join the `#basquio-vocal` Discord voice channel.
2. Speak for ~10 seconds.
3. Leave.
4. Within 60 seconds: a row should appear in Supabase `transcripts` table with your name as a participant.

If no row lands, check `railway logs --service basquio-bot` immediately. Common failure modes:

- Wrong start command running (see audit-before-touch above).
- Deepgram API key revoked.
- Discord token rotated and not re-deployed.
- Supabase service role key revoked.

## Watchdog (TODO)

A 30-minute heartbeat alarm on the `transcripts` table is required (see decision-log Apr 21). Until shipped, the operator (Marco) checks `railway logs --service basquio-bot` after every commit that touches `railway.toml`, `Dockerfile.worker`, or `apps/bot/Dockerfile`.
