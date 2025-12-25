# PostgreSQL MCP Server (SSH Tunnel)

[![npm version][npm-version-badge]][npm-package]
[![npm downloads][npm-downloads-badge]][npm-package]
[![license][license-badge]][license-link]

Secure PostgreSQL MCP server with built-in SSH tunneling. Connect through bastion hosts automatically, no manual `ssh -L` required.

- Stdio transport for local MCP clients (Claude Desktop, VS Code, etc.)
- Read-only by default (opt in to writes)
- Pooled connections with safe defaults and query limits

## Quickstart (npx)

This server runs as a local process that speaks MCP over stdio, so your MCP client should spawn it.

### Claude Desktop

Config file locations:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json` (some installs use `%APPDATA%/Claude/config.json`)

If you cannot find the file, open Claude Desktop > Settings > Developer > Edit Config.

Direct connection:

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

With SSH tunnel:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@zlash65/postgresql-ssh-mcp"],
      "env": {
        "DATABASE_URI": "postgresql://user:password@db.internal:5432/mydb",
        "SSH_ENABLED": "true",
        "SSH_HOST": "bastion.example.com",
        "SSH_USER": "ubuntu",
        "SSH_PRIVATE_KEY_PATH": "~/.ssh/id_rsa"
      }
    }
  }
}
```

### VS Code

Add to your settings JSON or create `.vscode/mcp.json` in your workspace:

```json
{
  "mcp": {
    "servers": {
      "postgres": {
        "command": "npx",
        "args": ["-y", "@zlash65/postgresql-ssh-mcp"],
        "env": {
          "DATABASE_URI": "postgresql://user:password@localhost:5432/mydb"
        }
      }
    }
  }
}
```

Note: `env` values must be strings in JSON configs.
Restart Claude Desktop after editing the config file.

## Configuration

Set environment variables directly or use a `.env` file. See `.env.example` for the full list.

### Database connection

Use a single connection string:

```
DATABASE_URI=postgresql://user:password@localhost:5432/mydb
```

Or individual variables: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`.

### SSL/TLS

`DATABASE_SSL=true` to force SSL, `DATABASE_SSL=false` to disable, or leave unset for auto-detection.

Optional:
- `DATABASE_SSL_CA=/path/to/ca.pem`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false`

### SSH tunnel

```
SSH_ENABLED=true
SSH_HOST=bastion.example.com
SSH_USER=ubuntu
SSH_PRIVATE_KEY_PATH=~/.ssh/id_rsa
```

Optional:
- `SSH_PORT` (default 22)
- `SSH_PRIVATE_KEY_PASSPHRASE`
- `SSH_PASSWORD`
- `SSH_KEEPALIVE_INTERVAL` (ms, default 10000)
- `SSH_KNOWN_HOSTS_PATH` (defaults to `~/.ssh/known_hosts`)
- `SSH_TRUST_ON_FIRST_USE` (default `true`, auto-adds new hosts to `known_hosts`)
- `SSH_STRICT_HOST_KEY=false` (disable verification, insecure)

### Host key verification (first time UX)

By default the server uses **trust-on-first-use**: the first time it sees a host, it will **accept and save** the key
to `known_hosts` automatically. No manual `ssh-keyscan` step required.
The server retries connections on startup, so you do not need to restart after the key is saved.

If you want strict verification, set `SSH_TRUST_ON_FIRST_USE=false`. In that mode, using a domain name or IP in
`SSH_HOST` requires it to already exist in `known_hosts`, or the server will fail.

Add the host key manually:

```bash
ssh-keyscan -H bastion.example.com >> ~/.ssh/known_hosts
```

For non-standard ports:

```bash
ssh-keyscan -p 2222 -H bastion.example.com >> ~/.ssh/known_hosts
```

You can also point to a custom file with `SSH_KNOWN_HOSTS_PATH`. For local dev only, you may set
`SSH_STRICT_HOST_KEY=false` to skip verification (not recommended for production).

### Server options

```
READ_ONLY=true       # default, blocks writes
QUERY_TIMEOUT=30000  # ms
MAX_ROWS=1000        # per query
```

## Tools

| Tool | Description |
| --- | --- |
| execute_query | Run SQL queries with parameters (capped by `MAX_ROWS`) |
| explain_query | Get the execution plan for a query |
| list_schemas | List database schemas |
| list_tables | List tables with row counts and sizes |
| describe_table | Show columns, indexes, and constraints |
| list_databases | List all databases on the server |
| get_connection_status | Check pool and tunnel health |
| get_database_version | PostgreSQL version string |
| get_database_size | Database size and largest tables |
| get_table_stats | Vacuum times, sequential scans, row estimates |
| list_active_connections | Current sessions from `pg_stat_activity` |
| list_long_running_queries | Queries exceeding a time threshold |

Read-only mode is enabled by default. It blocks `INSERT`, `UPDATE`, `DELETE`, and DDL statements.

## Docker

```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "DATABASE_URI", "postgresql-ssh-mcp"],
      "env": {
        "DATABASE_URI": "postgresql://user:password@host.docker.internal:5432/mydb"
      }
    }
  }
}
```

Use `host.docker.internal` instead of `localhost` to reach the host machine.

## Building

```bash
npm install
npm run build
```

## Development

```bash
npm test              # all tests
npm run test:unit     # unit tests only
npm run test:docker   # full integration with SSH

npm run lint
```

[npm-package]: https://www.npmjs.com/package/@zlash65/postgresql-ssh-mcp
[npm-version-badge]: https://img.shields.io/npm/v/@zlash65/postgresql-ssh-mcp?color=2f6feb&label=npm
[npm-downloads-badge]: https://img.shields.io/npm/dm/@zlash65/postgresql-ssh-mcp?color=2f6feb
[license-badge]: https://img.shields.io/npm/l/@zlash65/postgresql-ssh-mcp?color=2f6feb
[license-link]: LICENSE
