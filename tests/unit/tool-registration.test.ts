import { describe, it, expect, vi } from 'vitest';
import { createServer } from '../../src/server.js';
import type { ConnectionManager } from '../../src/connection/postgres-pool.js';

describe('MCP tool registration', () => {
  it('registers all expected tools', () => {
    const fakeManager = {
      executeQuery: vi.fn(),
      getStatus: vi.fn(),
      close: vi.fn(),
    } as unknown as ConnectionManager;

    const { server } = createServer(fakeManager);
    const toolRegistry = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;

    const toolNames = Object.keys(toolRegistry);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'execute_query',
        'explain_query',
        'list_schemas',
        'list_tables',
        'describe_table',
        'list_databases',
        'get_connection_status',
        'list_active_connections',
        'list_long_running_queries',
        'get_database_version',
        'get_database_size',
        'get_table_stats',
      ])
    );

    const missingOutputSchema = toolNames.filter(
      (name) => !toolRegistry[name]?.outputSchema
    );
    expect(missingOutputSchema).toEqual([]);
  });
});
