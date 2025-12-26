# Streamable HTTP Setup Guide

This guide covers setting up the PostgreSQL MCP server in HTTP mode for ChatGPT, web clients, and local development.

---

## Quick Start

```bash
DATABASE_URI="postgresql://user:pass@localhost:5432/mydb" \
  npx @zlash65/postgresql-ssh-mcp-http
```

The MCP endpoint is available at `http://localhost:3000/mcp`.

---

## Configuration

### Basic Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `MCP_HOST` | `0.0.0.0` | Bind address |
| `MCP_STATELESS` | `true` | Stateless mode (recommended for ChatGPT) |
| `MCP_AUTH_MODE` | `none` | `none` or `oauth` |

### Stateless vs Stateful Mode

**Stateless (`MCP_STATELESS=true`, default):**
- Each request includes the MCP initialize handshake
- Only `POST /mcp` is available
- No session storage between requests
- `MCP_SERVER_POOL_SIZE` controls reusable server instances
- Recommended for ChatGPT and serverless deployments

**Stateful (`MCP_STATELESS=false`):**
- Clients maintain a session ID across requests
- `POST /mcp`, `GET /mcp`, `DELETE /mcp` all available
- `MCP_SESSION_TTL_MINUTES` controls session expiry
- Better for long-running integrations

### Security Settings

| Variable | Description |
|----------|-------------|
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins. Empty or `*` disables checks. |
| `MCP_ALLOWED_HOSTS` | Comma-separated allowed Host header values. Protects against DNS rebinding. |

Example:

```bash
MCP_ALLOWED_ORIGINS="https://chatgpt.com,https://platform.openai.com" \
MCP_ALLOWED_HOSTS="your-subdomain.example.com" \
  npx @zlash65/postgresql-ssh-mcp-http
```

---

## HTTPS for Production

ChatGPT and other external clients require HTTPS. Use nginx as a reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name your-subdomain.example.com;

    ssl_certificate /etc/letsencrypt/live/your-subdomain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-subdomain.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> **Tip:** Use [Certbot](https://certbot.eff.org/) to obtain free Let's Encrypt certificates.

### Local Development with ngrok

For local testing with ChatGPT, use [ngrok](https://ngrok.com/) to expose your server:

```bash
ngrok http 3000
```

ngrok provides a public HTTPS URL that tunnels to your local server.

---

## Health Checks

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Basic health check (always returns ok) |
| `GET /health/ready` | Readiness check (verifies database connection) |

Example responses:

```json
// GET /health
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "version": "1.1.0"
}

// GET /health/ready
{
  "status": "ready",
  "database": "connected",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Local Development

### Prerequisites

- Node.js 20+
- A running PostgreSQL instance

### Clone and Install

```bash
git clone https://github.com/zlash65/postgresql-ssh-mcp.git

cd postgresql-ssh-mcp
npm install
npm run build
```

### Run HTTP Server from Source

```bash
export DATABASE_URI="postgresql://postgres:postgres@localhost:5432/testdb"

node dist/http.js
```

### Development Workflow

```bash
# Watch mode for TypeScript
npm run build -- --watch

# In another terminal, run the HTTP server
DATABASE_URI="postgresql://postgres:postgres@localhost:5432/testdb" node dist/http.js
```

### Test with curl

```bash
# Health check
curl http://localhost:3000/health

# MCP initialize (stateless mode)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'
```

### Docker Development

Build and run the HTTP server container:

```bash
# Build
docker build --target runtime-http -t postgresql-mcp-http .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URI="postgresql://host.docker.internal:5432/testdb" \
  postgresql-mcp-http
```

> **Note:** Use `host.docker.internal` to connect to host PostgreSQL from Docker on macOS/Windows.

### Test Database with Docker

```bash
docker run -d \
  --name postgres-mcp-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:16-alpine
```

---

## OAuth Authentication

For ChatGPT integration with OAuth, see [ChatGPT Setup Guide](chatgpt-setup.md).

Quick overview:

```bash
MCP_AUTH_MODE=oauth \
AUTH0_DOMAIN=your-tenant.us.auth0.com \
AUTH0_AUDIENCE=https://your-subdomain.example.com \
DATABASE_URI="postgresql://..." \
  npx @zlash65/postgresql-ssh-mcp-http
```

---

## Docker Compose Example

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mydb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  mcp-http:
    build:
      context: .
      target: runtime-http
    ports:
      - "3000:3000"
    environment:
      DATABASE_URI: postgresql://postgres:postgres@postgres:5432/mydb
      MCP_ALLOWED_HOSTS: localhost:3000
    depends_on:
      - postgres

volumes:
  pgdata:
```

---

## Troubleshooting

### Connection Refused

- Verify PostgreSQL is running and accessible
- Check `DATABASE_URI` format
- For Docker, use correct network addresses

### CORS Errors

- Set `MCP_ALLOWED_ORIGINS` to include the client origin
- Ensure the Origin header is being sent

### 401 Unauthorized

- If using OAuth, verify Auth0 configuration
- Check that the JWT audience matches `AUTH0_AUDIENCE`

### Session Not Found (Stateful Mode)

- Sessions expire after `MCP_SESSION_TTL_MINUTES`
- Ensure the client sends the `mcp-session-id` header
