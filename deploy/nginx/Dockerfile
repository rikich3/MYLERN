# Contenedor 05 -- reverse proxy tls
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/conf.d/mylern.conf   /etc/nginx/plantillas/mylern.conf.template
COPY deploy/nginx/cloudflare-ips.conf  /etc/nginx/plantillas/cloudflare-ips.conf
COPY deploy/nginx/entrypoint.sh /docker-entrypoint.d/40-mylern.sh
RUN chmod +x /docker-entrypoint.d/40-mylern.sh
EXPOSE 80 443
