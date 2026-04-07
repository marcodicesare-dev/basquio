FROM node:22-slim

RUN apt-get update && apt-get install -y ffmpeg python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy monorepo root for workspace resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot ./apps/bot
COPY packages/types ./packages/types
COPY code ./code

RUN corepack enable && pnpm install --filter @basquio/bot...

WORKDIR /app/apps/bot
ENTRYPOINT ["pnpm", "start"]
