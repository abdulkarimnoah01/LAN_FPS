# Spectre Orbit Matchmaking & Signaling Server
FROM node:22-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --only=production

COPY server/index.mjs ./

# Copy built online frontend for optional static serving
COPY dist/online/ ./public/

ENV PORT=8080
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/public

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "index.mjs"]
