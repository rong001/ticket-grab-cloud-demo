FROM node:20-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/prisma apps/api/prisma
COPY apps/api/package.json apps/api/
COPY apps/worker apps/worker
RUN pnpm --filter @ticket-grab/shared build \
 && pnpm --filter @ticket-grab/api exec prisma generate \
 && pnpm --filter @ticket-grab/worker build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
