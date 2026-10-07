# Relay: single image serving the API, dashboard PWA, landing page and widget.js
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/widget/package.json apps/widget/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @relay/server deploy --prod --legacy /out/server

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web
COPY --from=build /out/server /app/server
COPY --from=build /app/apps/web/dist /app/web
VOLUME /data
EXPOSE 8787
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.ts"]
