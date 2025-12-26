import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConnectionManager } from './connection/postgres-pool.js';
import { registerQueryTools } from './tools/query.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerAdminTools } from './tools/admin.js';
import { VERSION } from './version.js';

export interface ServerFactoryResponse {
  server: McpServer;
  cleanup: () => Promise<void>;
}

export function createServer(
  connectionManager: ConnectionManager
): ServerFactoryResponse {
  const server = new McpServer(
    {
      name: 'postgresql-ssh-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    }
  );

  registerQueryTools(server, connectionManager);
  registerSchemaTools(server, connectionManager);
  registerAdminTools(server, connectionManager);

  return {
    server,
    cleanup: async () => {
      await connectionManager.close();
    },
  };
}
