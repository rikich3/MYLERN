# Imagen auxiliar del cliente de terminal mylern-cli.
# No es un contenedor de ejecucion permanente: se usa de forma puntual
#   docker compose --profile herramientas run --rm cli ls --limite 20
FROM node:22-alpine AS build
WORKDIR /app
COPY cli/package.json cli/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY cli/tsconfig.json ./
COPY cli/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY cli/package.json ./
RUN addgroup -S mylern && adduser -S mylern -G mylern
USER mylern
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["help"]
