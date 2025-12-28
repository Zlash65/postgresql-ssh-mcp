import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from '../connection/postgres-pool.js';
import {
  successResponse,
  errorResponseFromError,
  wrapToolOutputSchema,
} from '../lib/tool-response.js';

const SchemaRowSchema = z
  .object({
    schema_name: z.string(),
    schema_owner: z.string(),
    schema_type: z.enum(['system', 'user']),
  })
  .passthrough();

const TableRowSchema = z
  .object({
    table_name: z.string(),
    table_type: z.string(),
    estimated_row_count: z.union([z.number(), z.string()]),
    total_size: z.string(),
  })
  .passthrough();

const ColumnSchema = z
  .object({
    column_name: z.string(),
    data_type: z.string(),
    is_nullable: z.string(),
    column_default: z.string().nullable(),
    character_maximum_length: z.union([z.number(), z.string(), z.null()]),
    numeric_precision: z.union([z.number(), z.string(), z.null()]),
    numeric_scale: z.union([z.number(), z.string(), z.null()]),
  })
  .passthrough();

const ConstraintSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    columns: z.array(z.string()),
    foreignTable: z.string().optional(),
    foreignSchema: z.string().optional(),
    foreignColumn: z.string().optional(),
  })
  .passthrough();

const IndexSchema = z
  .object({
    indexname: z.string(),
    indexdef: z.string(),
  })
  .passthrough();

const DescribeTableResultSchema = z
  .object({
    table: z.object({
      schema: z.string(),
      name: z.string(),
    }),
    columns: z.array(ColumnSchema),
    constraints: z.array(ConstraintSchema),
    indexes: z.array(IndexSchema),
  })
  .passthrough();

const DatabaseRowSchema = z
  .object({
    name: z.string(),
    owner: z.string(),
    encoding: z.string(),
    collation: z.string(),
    size: z.string(),
  })
  .passthrough();

const ListSchemasOutputSchema = wrapToolOutputSchema(z.array(SchemaRowSchema));
const ListTablesOutputSchema = wrapToolOutputSchema(z.array(TableRowSchema));
const DescribeTableOutputSchema = wrapToolOutputSchema(
  DescribeTableResultSchema
);
const ListDatabasesOutputSchema = wrapToolOutputSchema(
  z.array(DatabaseRowSchema)
);

export function registerSchemaTools(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.registerTool(
    'list_schemas',
    {
      description: 'List schemas (excludes system schemas by default).',
      inputSchema: {
        includeSystem: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include system schemas (pg_*, information_schema)'),
      },
      outputSchema: ListSchemasOutputSchema,
    },
    async ({ includeSystem }) => {
      try {
        let sql = `
          SELECT
            schema_name,
            schema_owner,
            CASE
              WHEN schema_name LIKE 'pg_%' THEN 'system'
              WHEN schema_name = 'information_schema' THEN 'system'
              ELSE 'user'
            END as schema_type
          FROM information_schema.schemata
        `;

        if (!includeSystem) {
          sql += ` WHERE schema_name NOT LIKE 'pg_%'
                   AND schema_name != 'information_schema'`;
        }

        sql += ' ORDER BY schema_type, schema_name';

        const result = await connectionManager.executeQuery(sql);
        return successResponse(result.rows);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'list_tables',
    {
      description:
        'List tables in a schema with estimated row counts and sizes.',
      inputSchema: {
        schema: z
          .string()
          .optional()
          .default('public')
          .describe('Schema name (default: public)'),
        includeViews: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include views in the listing'),
      },
      outputSchema: ListTablesOutputSchema,
    },
    async ({ schema, includeViews }) => {
      try {
        const tableTypes = includeViews
          ? "'BASE TABLE', 'VIEW'"
          : "'BASE TABLE'";

        const sql = `
          SELECT
            t.table_name,
            t.table_type,
            COALESCE(pg_stat_user_tables.n_live_tup, 0) as estimated_row_count,
            pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as total_size
          FROM information_schema.tables t
          LEFT JOIN pg_stat_user_tables
            ON t.table_name = pg_stat_user_tables.relname
            AND t.table_schema = pg_stat_user_tables.schemaname
          WHERE t.table_schema = $1
            AND t.table_type IN (${tableTypes})
          ORDER BY t.table_name
        `;

        const result = await connectionManager.executeQuery(sql, [schema]);
        return successResponse(result.rows);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'describe_table',
    {
      description: 'Describe a table (columns, constraints, indexes).',
      inputSchema: {
        schema: z
          .string()
          .optional()
          .default('public')
          .describe('Schema name (default: public)'),
        table: z.string().describe('Table name to describe'),
      },
      outputSchema: DescribeTableOutputSchema,
    },
    async ({ schema, table }) => {
      try {
        const columnsSql = `
          SELECT
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length,
            numeric_precision,
            numeric_scale
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `;

        const constraintsSql = `
          SELECT
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc
          LEFT JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
          WHERE tc.table_schema = $1 AND tc.table_name = $2
          ORDER BY tc.constraint_name, kcu.ordinal_position
        `;

        const indexesSql = `
          SELECT
            indexname,
            indexdef
          FROM pg_indexes
          WHERE schemaname = $1 AND tablename = $2
          ORDER BY indexname
        `;

        const [columnsResult, constraintsResult, indexesResult] =
          await Promise.all([
            connectionManager.executeQuery(columnsSql, [schema, table]),
            connectionManager.executeQuery(constraintsSql, [schema, table]),
            connectionManager.executeQuery(indexesSql, [schema, table]),
          ]);

        const constraints: Record<
          string,
          {
            type: string;
            columns: string[];
            foreignTable?: string;
            foreignSchema?: string;
            foreignColumn?: string;
          }
        > = {};

        for (const row of constraintsResult.rows) {
          const name = row.constraint_name as string;
          if (!constraints[name]) {
            const constraintData: {
              type: string;
              columns: string[];
              foreignTable?: string;
              foreignSchema?: string;
              foreignColumn?: string;
            } = {
              type: row.constraint_type as string,
              columns: [],
            };

            // Only include foreign key fields when they have non-null values
            if (row.foreign_table !== null) {
              constraintData.foreignTable = row.foreign_table as string;
            }
            if (row.foreign_table_schema !== null) {
              constraintData.foreignSchema = row.foreign_table_schema as string;
            }
            if (row.foreign_column !== null) {
              constraintData.foreignColumn = row.foreign_column as string;
            }

            constraints[name] = constraintData;
          }
          if (row.column_name) {
            constraints[name].columns.push(row.column_name as string);
          }
        }

        const output = {
          table: { schema, name: table },
          columns: columnsResult.rows,
          constraints: Object.entries(constraints).map(([name, data]) => ({
            name,
            ...data,
          })),
          indexes: indexesResult.rows,
        };

        return successResponse(output);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'list_databases',
    {
      description: 'List databases with owner, encoding, and size.',
      inputSchema: {},
      outputSchema: ListDatabasesOutputSchema,
    },
    async () => {
      try {
        const sql = `
          SELECT
            datname as name,
            pg_catalog.pg_get_userbyid(datdba) as owner,
            pg_catalog.pg_encoding_to_char(encoding) as encoding,
            datcollate as collation,
            pg_size_pretty(pg_database_size(datname)) as size
          FROM pg_database
          WHERE datistemplate = false
          ORDER BY datname
        `;

        const result = await connectionManager.executeQuery(sql);
        return successResponse(result.rows);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );
}
