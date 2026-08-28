# Contenedor 01 -- servidor backend & api mylern
# Contexto de build: raiz del repositorio (necesita backend/ y deploy/postgres/init/)
FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini curl && addgroup -S mylern && adduser -S mylern -G mylern

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
# Las migraciones viajan con la imagen para poder aplicarlas sobre una base ya creada.
COPY deploy/postgres/init ./migrations

USER mylern
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/salud/listo || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
