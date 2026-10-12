ARG NODE_IMAGE=node:24-alpine
# ── Build stage: install workspace, build web (Vite) and server (esbuild bundle)
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/maps/package.json packages/maps/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && pnpm --filter @agora/server deploy --prod --legacy /out

# ── Runtime stage: Node + server bundle + static web build, non-root
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/public \
    MAP_PATH=/app/maps/hq.tmj
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./public
COPY --from=build /src/packages/maps/hq.tmj ./maps/hq.tmj
COPY --from=build /src/packages/maps/worlds/starter.json ./maps/worlds/starter.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
