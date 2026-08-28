# Contenedor 04 -- web app mylern (SPA servida por nginx)
FROM node:22-alpine AS build
WORKDIR /app
COPY webapp/package.json webapp/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY webapp/tsconfig.json webapp/vite.config.ts webapp/index.html ./
COPY webapp/src ./src
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/webapp/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
