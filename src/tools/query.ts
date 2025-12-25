import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from '../connection/postgres-pool.js';
import { successResponse, errorResponseFromError } from '../lib/tool-response.js';

export function registerQueryTools(
  server: McpServer,
  connectionManager: ConnectionManager
): void {
  server.registerTool(
    'execute_query',
    {
      description:
        'Execute SQL with optional parameters. Results are capped by MAX_ROWS and include a truncated flag.',
      inputSchema: {
        sql: z.string().describe('SQL to execute'),
        params: z
          .array(z.any())
          .optional()
          .describe('Parameters for $1, $2, ...'),
      },
    },
    async ({ sql, params }) => {
      try {
        const result = await connectionManager.executeQuery(sql, params);

        const output = {
          rows: result.rows,
          rowCount: result.rowCount,
          truncated: result.truncated,
          fields: result.fields,
        };

        return successResponse(output);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );

  server.registerTool(
    'explain_query',
    {
      description:
        'Return an EXPLAIN plan for a query. ANALYZE executes the query.',
      inputSchema: {
        sql: z.string().describe('SQL query to explain'),
        analyze: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Run EXPLAIN ANALYZE (executes the query). Limited in read-only mode.'
          ),
        format: z
          .enum(['text', 'json', 'yaml', 'xml'])
          .optional()
          .default('text')
          .describe('Output format for the execution plan'),
      },
    },
    async ({ sql, analyze, format }) => {
      try {
        const options = [`FORMAT ${format.toUpperCase()}`];
        if (analyze) {
          options.push('ANALYZE');
        }

        const explainSql = `EXPLAIN (${options.join(', ')}) ${sql}`;
        const result = await connectionManager.executeQuery(explainSql);

        let output: string;
        if (format === 'json') {
          output = JSON.stringify(result.rows[0]?.['QUERY PLAN'], null, 2);
        } else {
          output = result.rows.map((r) => r['QUERY PLAN']).join('\n');
        }

        return successResponse(output);
      } catch (error) {
        return errorResponseFromError(error);
      }
    }
  );
}
