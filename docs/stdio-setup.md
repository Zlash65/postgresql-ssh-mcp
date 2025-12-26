# STDIO Setup Guide

This guide covers setting up the PostgreSQL MCP server in STDIO mode for Claude Desktop and local development.

---

## Claude Desktop

### Configuration File Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%/Claude/claude_desktop_config.json` |

> **Tip:** In Claude Desktop, go to **Settings > Developer > Edit Config** to open the file directly.

### Basic Configuration

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@zlash65/postgresql-ssh-mcp"],
      "env": {
        "DATABASE_URI": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### With SSH Tunnel

Connect through a bastion host to an internal database:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@zlash65/postgresql-ssh-mcp"],
      "env": {
        "DATABASE_URI": "postgresql://dbuser:dbpass@db.internal:5432/mydb",
        "SSH_ENABLED": "true",
        "SSH_HOST": "bastion.example.com",
        "SSH_USER": "ec2-user",
        "SSH_PRIVATE_KEY_PATH": "/Users/you/.ssh/id_rsa"
      }
    }
  }
}
```

### Read-Write Mode

By default, the server blocks data modifications. Enable writes explicitly:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@zlash65/postgresql-ssh-mcp"],
      "env": {
        "DATABASE_URI": "postgresql://user:password@localhost:5432/mydb",
        "READ_ONLY": "false"
      }
    }
  }
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

### Run from Source

```bash
# Set environment variables
export DATABASE_URI="postgresql://postgres:postgres@localhost:5432/testdb"

# Run the STDIO server
node dist/index.js
```

### Connect Claude Desktop to Local Build

Point Claude Desktop to your local build instead of npx:

```json
{
  "mcpServers": {
    "postgres-dev": {
      "command": "node",
      "args": ["/path/to/postgresql-ssh-mcp/dist/index.js"],
      "env": {
        "DATABASE_URI": "postgresql://postgres:postgres@localhost:5432/testdb"
      }
    }
  }
}
```

### Development Workflow

```bash
# Watch mode for TypeScript (rebuild on changes)
npm run build -- --watch

# Run tests
npm test

# Run tests in watch mode
npm run test:unit -- --watch

# Type check
npm run typecheck

# Lint
npm run lint
```

### Test Database with Docker

Spin up a local PostgreSQL for testing:

```bash
docker run -d \
  --name postgres-mcp-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:16-alpine
```

Connect with:

```bash
export DATABASE_URI="postgresql://postgres:postgres@localhost:5432/testdb"
```

---

## Other MCP Clients

Any MCP client that launches commands with environment variables can use:

```
command: npx
args: ["-y", "@zlash65/postgresql-ssh-mcp"]
```

Or for a local build:

```
command: node
args: ["/path/to/dist/index.js"]
```

---

## Notes

- If `DATABASE_URI` includes `sslmode=...`, it is ignored. Use `DATABASE_SSL` instead.
- Read-only mode blocks: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `COPY`, `LOCK`, `PREPARE`, `EXECUTE`.
- SSH tunnel reconnects automatically on connection loss (up to `SSH_MAX_RECONNECT_ATTEMPTS`).
