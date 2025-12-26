ARG NODE_VERSION=20

# ============================================================
# Build Stage - Compile TypeScript
# ============================================================
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ============================================================
# Test Stage - Run test suite
# ============================================================
FROM node:${NODE_VERSION}-bookworm-slim AS test

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "test"]


# ============================================================
# Runtime Stage - STDIO server (Claude Desktop)
# ============================================================
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN groupadd --system mcp && \
    useradd --system --gid mcp --home /app --shell /usr/sbin/nologin mcp && \
    chown -R mcp:mcp /app

USER mcp
CMD ["node", "dist/index.js"]


# ============================================================
# Runtime HTTP Stage - HTTP server (ChatGPT)
# ============================================================
FROM runtime AS runtime-http

ENV PORT=3000 \
    MCP_HOST=0.0.0.0 \
    MCP_AUTH_MODE=none

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/http.js"]
