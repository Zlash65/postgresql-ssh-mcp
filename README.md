# PostgreSQL MCP Server with SSH Tunneling

MCP server for PostgreSQL with built-in SSH tunnel support. Connects through bastion hosts automatically—no manual `ssh -L` needed.

## Tools

- **execute_query** - Run SQL queries with parameters. Results capped at `MAX_ROWS`.
- **explain_query** - Get the execution plan for a query.
- **list_schemas** - List database schemas.
- **list_tables** - List tables with row counts and sizes.
- **describe_table** - Show columns, indexes, and constraints.
- **list_databases** - List all databases on the server.
- **get_connection_status** - Check pool and tunnel health.
- **get_database_version** - PostgreSQL version string.
- **get_database_size** - Database size and largest tables.
- **get_table_stats** - Vacuum times, sequential scans, row estimates.
- **list_active_connections** - Current sessions from `pg_stat_activity`.
- **list_long_running_queries** - Queries exceeding a time threshold.

Read-only mode is enabled by default. It blocks `INSERT`, `UPDATE`, `DELETE`, and DDL statements.

## Configuration

Set environment variables directly or use a `.env` file. See `.env.example` for all options.

**Database connection:**

```
DATABASE_URI=postgresql://user:password@localhost:5432/mydb
```

Or use individual variables: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`.

**SSL:** Set `DATABASE_SSL=true` to force SSL, `false` to disable, or leave unset for auto-detection.

**SSH tunnel:**

```
SSH_ENABLED=true
SSH_HOST=bastion.example.com
SSH_USER=ubuntu
SSH_PRIVATE_KEY_PATH=~/.ssh/id_rsa
```

Host keys are verified against `~/.ssh/known_hosts`. If you get an unknown host error:

```bash
ssh-keyscan -H bastion.example.com >> ~/.ssh/known_hosts
```

**Server options:**

```
READ_ONLY=true       # default, blocks writes
QUERY_TIMEOUT=30000  # ms
MAX_ROWS=1000        # per query
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

**Direct connection:**

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/path/to/postgresql-ssh-mcp/dist/index.js"],
      "env": {
        "DATABASE_URI": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

**With SSH tunnel:**

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/path/to/postgresql-ssh-mcp/dist/index.js"],
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

### Docker

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

## Usage with VS Code

Add to your settings JSON or create `.vscode/mcp.json` in your workspace:

```json
{
  "mcp": {
    "servers": {
      "postgres": {
        "command": "node",
        "args": ["/path/to/postgresql-ssh-mcp/dist/index.js"],
        "env": {
          "DATABASE_URI": "postgresql://user:password@localhost:5432/mydb"
        }
      }
    }
  }
}
```

## Building

```bash
npm install
npm run build
```

Docker:

```bash
docker build -t postgresql-ssh-mcp .
```

## Development

```bash
npm test              # all tests
npm run test:unit     # unit tests only
npm run test:docker   # full integration with SSH

npm run lint
```
