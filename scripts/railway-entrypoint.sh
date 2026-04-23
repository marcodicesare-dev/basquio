#!/usr/bin/env bash
#
# Railway entrypoint dispatcher.
#
# Both the deck-worker service AND the Discord-bot service inside the
# basquio-bot Railway project build from the same Dockerfile.worker image
# (which COPY's the whole monorepo). Each service has its own env var
# fingerprint:
#   - Discord bot service:  has DISCORD_BOT_TOKEN (and does NOT have NEXT_PUBLIC_SUPABASE_URL)
#   - Deck worker service:  has NEXT_PUBLIC_SUPABASE_URL (and does NOT have DISCORD_BOT_TOKEN)
#
# This script discriminates by DISCORD_BOT_TOKEN because it is absolutely
# unambiguous: only the Discord bot ever has it. If it is set we start the
# bot; otherwise we start the deck worker.
#
# Background / why this dispatcher exists: Apr 21 2026 forensic — the root
# railway.toml was shared between two services and a deck-worker hardening
# commit silently replaced the Discord bot startCommand, causing a 24-hour
# silent bot outage and an unrecoverable 2-hour strategy call. The PROPER
# fix is per-service Config-as-Code Paths in the Railway dashboard (see
# apps/bot/README.md). This dispatcher is the belt-and-suspenders so a
# future misconfiguration cannot silently run the wrong code.

set -euo pipefail

# --conditions=react-server makes Node's resolver treat the runtime as a
# React Server Component context, which resolves the `server-only` marker
# package to its empty entry instead of the client-guard entry that
# throws. The deck worker (and the new file-ingest consumer B4b) imports
# several apps/web modules that declare `import "server-only"` to
# enforce the Next.js boundary; without this condition the worker
# crashes on module load.
export NODE_OPTIONS="${NODE_OPTIONS:-} --conditions=react-server"

if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
  echo "[railway-entrypoint] DISCORD_BOT_TOKEN detected. Starting Discord bot."
  cd /app/apps/bot
  exec node --import tsx src/index.ts
fi

echo "[railway-entrypoint] no DISCORD_BOT_TOKEN. Starting deck worker + file-ingest consumer."
cd /app
exec node --import tsx scripts/worker.ts
