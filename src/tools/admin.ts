import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from '../connection/postgres-pool.js';
import {
  successResponse,
  errorResponseFromError,
  wrapToolOutputSchema,
} from '../lib/tool-response.js';

const NullableNumber = z.union([z.number(), z.string(), z.null()]);
const TimestampSchema = z.union([z.string(), z.date()]);
const NullableTimestamp = TimestampSchema.nullable();

const TunnelStateSchema = z
  .object({
    status: z.enum([
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
      'failed',
    ]),
    localPort: z.number().nullable(),
    uptime: z.number(),
    reconnectAttempts: z.number(),
    lastError: z.string().optional(),
  })
  .passthrough();

const ConnectionStatusSchema = z
  .object({
    initialized: z.boolean(),
    reconnecting: z.boolean(),
    database: z.object({
      host: z.string(),
      port: z.number(),
      database: z.string(),
      user: z.string(),
      ssl: z.boolean(),
    }),
    tunnel: TunnelStateSchema.optional(),
    pool: z.object({
      totalCount: z.number(),
      idleCount: z.number(),
      waitingCount: z.number(),
    }),
    mode: z.enum(['read-only', 'read-write']),
    maxRows: z.number(),
    queryTimeout: z.number(),
    maxConcurrentQueries: z.number(),
    activeQueries: z.number(),
  })
  .passthrough();

const ActiveConnectionRowSchema = z
  .object({
    pid: z.union([z.number(), z.string()]),
    username: z.string(),
    application_name: z.string().nullable(),
    client_addr: z.string().nullable(),
    state: z.string().nullable(),
    query_start: NullableTimestamp,
    query_duration_seconds: NullableNumber,
    query_preview: z.string().nullable(),
  })
  .passthrough();

const LongRunningQueryRowSchema = z
  .object({
    pid: z.union([z.number(), z.string()]),
    username: z.string(),
    application_name: z.string().nullable(),
    state: z.string().nullable(),
    query_start: NullableTimestamp,
    duration_seconds: NullableNumber,
    query: z.string().nullable(),
  })
  .passthrough();

const DatabaseSizeSchema = z
  .object({
    database_size: z.string(),
    database_name: z.string(),
  })
  .passthrough();

const TableSizeSchema = z
  .object({
    table_name: z.string(),
    total_size: z.string(),
    table_size: z.string(),
    indexes_size: z.string(),
  })
  .passthrough();

const DatabaseSizeResultSchema = z
  .object({
    database: DatabaseSizeSchema,
    largestTables: z.array(TableSizeSchema),
  })
  .passthrough();

const TableStatsSchema = z
  .object({
    schemaname: z.string(),
    table_name: z.string(),
    live_rows: NullableNumber,
    dead_rows: NullableNumber,
    rows_modified_since_analyze: NullableNumber,
    last_vacuum: NullableTimestamp,
    last_autovacuum: NullableTimestamp,
    last_analyze: NullableTimestamp,
    last_autoanalyze: NullableTimestamp,
    seq_scan: NullableNumber,
    seq_tup_read: NullableNumber,
    idx_scan: NullableNumber,
    idx_tup_fetch: NullableNumber,
    inserts: NullableNumber,
    updates: NullableNumber,
    deletes: NullableNumber,
  })
  .passthrough();

const TableStatsResultSchema = z.union([
  TableStatsSchema,
  z.object({ error: z.string() }),
]);

const ConnectionStatusOutputSchema = wrapToolOutputSchema(
  ConnectionStatusSchema
);
const ActiveConnectionsOutputSchema = wrapToolOutputSchema(
  z.array(ActiveConnectionRowSchema)
);
const LongRunningQueriesOutputSchema = wrapToolOutputSchema(
  z.array(LongRunningQueryRowSchema)
);
const DatabaseVersionOutputSchema = wrapToolOutputSchema(z.string());
const DatabaseSizeOutputSchema = wrapToolOutputSchema(
  DatabaseSizeResultSchema
);
const TableStatsOutputSchema = wrapToolOutputSchema(TableStatsResultSchema);

export function registerAdminTools(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.registerTool(
    'get_connection_status',
    {
      description:
        'Get connection status, pool stats, and tunnel state.',
      inputSchema: {},
      outputSchema: ConnectionStatusOutputSchema,
    },
    async () => {
      const status = connectionManager.getStatus();
      return successResponse(status);
    }
  );

  server.registerTool(
    'list_active_connections',
    {
      description:
        'List active connections from pg_stat_activity.',
      inputSchema: {
        includeIdle: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include idle connections in the listing'),
      },
      outputSchema: ActiveConnectionsOutputSchema,
    },
    async ({ includeIdle }) => {
      try {
        let sql = `
          SELECT
            pid,
            usename as username,
            application_name,
            client_addr,
            state,
            query_start,
            EXTRACT(EPOCH FROM (now() - query_start))::integer as query_duration_seconds,
            LEFT(query, 100) as query_preview
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid != pg_backend_pid()
        `;

        if (!includeIdle) {
          sql += ` AND state != 'idle'`;
        }

        sql += ' ORDER BY query_start DESC NULLS LAST';

        const result = await connectionManager.executeQuery(sql);
        return successResponse(result.rows);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'list_long_running_queries',
    {
      description:
        'List queries running longer than a threshold.',
      inputSchema: {
        minDurationSeconds: z
          .number()
          .optional()
          .default(5)
          .describe('Minimum duration in seconds (default: 5)'),
      },
      outputSchema: LongRunningQueriesOutputSchema,
    },
    async ({ minDurationSeconds }) => {
      try {
        const sql = `
          SELECT
            pid,
            usename as username,
            application_name,
            state,
            query_start,
            EXTRACT(EPOCH FROM (now() - query_start))::integer as duration_seconds,
            query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid != pg_backend_pid()
            AND state != 'idle'
            AND query_start < now() - interval '1 second' * $1
          ORDER BY query_start ASC
        `;

        const result = await connectionManager.executeQuery(sql, [
          minDurationSeconds,
        ]);
        return successResponse(result.rows);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'get_database_version',
    {
      description: 'Get PostgreSQL server version.',
      inputSchema: {},
      outputSchema: DatabaseVersionOutputSchema,
    },
    async () => {
      try {
        const result = await connectionManager.executeQuery('SELECT version()');
        return successResponse(result.rows[0]?.version || 'Unknown');
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'get_database_size',
    {
      description: 'Get database size and largest tables.',
      inputSchema: {
        limit: z
          .number()
          .optional()
          .default(10)
          .describe('Number of largest tables to return (default: 10)'),
      },
      outputSchema: DatabaseSizeOutputSchema,
    },
    async ({ limit }) => {
      try {
        const dbSizeSql = `
          SELECT
            pg_size_pretty(pg_database_size(current_database())) as database_size,
            current_database() as database_name
        `;

        const tablesSql = `
          SELECT
            schemaname || '.' || tablename as table_name,
            pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))) as total_size,
            pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))) as table_size,
            pg_size_pretty(pg_indexes_size(quote_ident(schemaname) || '.' || quote_ident(tablename))) as indexes_size
          FROM pg_tables
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) DESC
          LIMIT $1
        `;

        const [dbResult, tablesResult] = await Promise.all([
          connectionManager.executeQuery(dbSizeSql),
          connectionManager.executeQuery(tablesSql, [limit]),
        ]);

        return successResponse({
          database: dbResult.rows[0],
          largestTables: tablesResult.rows,
        });
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'get_table_stats',
    {
      description:
        'Get table statistics (rows, vacuum/analyze, scan counts).',
      inputSchema: {
        schema: z
          .string()
          .optional()
          .default('public')
          .describe('Schema name (default: public)'),
        table: z.string().describe('Table name'),
      },
      outputSchema: TableStatsOutputSchema,
    },
    async ({ schema, table }) => {
      try {
        const sql = `
          SELECT
            schemaname,
            relname as table_name,
            n_live_tup as live_rows,
            n_dead_tup as dead_rows,
            n_mod_since_analyze as rows_modified_since_analyze,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze,
            seq_scan,
            seq_tup_read,
            idx_scan,
            idx_tup_fetch,
            n_tup_ins as inserts,
            n_tup_upd as updates,
            n_tup_del as deletes
          FROM pg_stat_user_tables
          WHERE schemaname = $1 AND relname = $2
        `;

        const result = await connectionManager.executeQuery(sql, [
          schema,
          table,
        ]);

        if (result.rows.length === 0) {
          return successResponse({
            error: `Table ${schema}.${table} not found`,
          });
        }

        return successResponse(result.rows[0]);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );
}
