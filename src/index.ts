#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseConfig } from './config.js';
import { ConnectionManager } from './connection/postgres-pool.js';
import { createServer } from './server.js';
import { obfuscateConnectionString } from './lib/obfuscate.js';

async function main(): Promise<void> {
  console.error('[postgres-mcp] Starting server...');

  let cleanup: (() => Promise<void>) | null = null;

  try {
    const config = parseConfig();

    const connectionManager = new ConnectionManager(config);
    await connectionManager.initialize();

    const { server, cleanup: serverCleanup } = createServer(connectionManager);
    cleanup = serverCleanup;

    const handleShutdown = async (signal: string): Promise<void> => {
      console.error(`[postgres-mcp] Received ${signal}, shutting down...`);

      if (cleanup) {
        try {
          await cleanup();
        } catch (err) {
          console.error('[postgres-mcp] Error during cleanup:', err);
        }
      }

      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    process.on('uncaughtException', (err) => {
      console.error(
        '[postgres-mcp] Uncaught exception:',
        obfuscateConnectionString(err.message)
      );
      console.error(err.stack);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      const message =
        reason instanceof Error ? reason.message : String(reason);
      console.error(
        '[postgres-mcp] Unhandled rejection:',
        obfuscateConnectionString(message)
      );
      process.exit(1);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[postgres-mcp] Server running on STDIO');
    console.error(
      `[postgres-mcp] Mode: ${config.readOnly ? 'read-only' : 'read-write'}`
    );
    console.error(`[postgres-mcp] Max rows per query: ${config.maxRows}`);

    if (config.ssh) {
      console.error('[postgres-mcp] SSH tunnel: enabled');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      '[postgres-mcp] Fatal error:',
      obfuscateConnectionString(message)
    );

    if (cleanup) {
      try {
        await cleanup();
      } catch {
        // Ignore cleanup errors during fatal shutdown
      }
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[postgres-mcp] Failed to start:', err);
  process.exit(1);
});
