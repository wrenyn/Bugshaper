# Build with sibling website (separate packages / local checkout):
#   docker build -t bugshaper-backend --build-context website=../website .
# Compose: docker compose up -d --build

FROM node:22-bookworm-slim AS site-build
WORKDIR /website
COPY --from=website package.json ./
RUN npm install
COPY --from=website ./ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    BUGSHAPER_HOST=0.0.0.0 \
    BUGSHAPER_PORT=4318 \
    BUGSHAPER_MEDIA_DIR=/data/media \
    BUGSHAPER_TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
COPY --from=site-build /website/dist ./public/www
RUN mkdir -p /data/media && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4318/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.mjs"]
