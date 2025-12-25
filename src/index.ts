#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseConfig } from './config.js';
import { ConnectionManager } from './connection/postgres-pool.js';
import { createServer } from './server.js';
import { obfuscateConnectionString } from './lib/obfuscate.js';

async function main(): Promise<void> {
  console.error('[postgresql-ssh-mcp] Starting server...');

  let cleanup: (() => Promise<void>) | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let isShuttingDown = false;

  try {
    const config = parseConfig();

    const connectionManager = new ConnectionManager(config);

    const { server, cleanup: serverCleanup } = createServer(connectionManager);
    cleanup = async () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      await serverCleanup();
    };

    const handleShutdown = async (signal: string): Promise<void> => {
      console.error(`[postgresql-ssh-mcp] Received ${signal}, shutting down...`);
      isShuttingDown = true;

      if (cleanup) {
        try {
          await cleanup();
        } catch (err) {
          console.error('[postgresql-ssh-mcp] Error during cleanup:', err);
        }
      }

      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    process.on('uncaughtException', (err) => {
      console.error(
        '[postgresql-ssh-mcp] Uncaught exception:',
        obfuscateConnectionString(err.message)
      );
      console.error(err.stack);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      const message =
        reason instanceof Error ? reason.message : String(reason);
      console.error(
        '[postgresql-ssh-mcp] Unhandled rejection:',
        obfuscateConnectionString(message)
      );
      process.exit(1);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[postgresql-ssh-mcp] Server running on STDIO');
    console.error(
      `[postgresql-ssh-mcp] Mode: ${config.readOnly ? 'read-only' : 'read-write'}`
    );
    console.error(`[postgresql-ssh-mcp] Max rows per query: ${config.maxRows}`);

    if (config.ssh) {
      console.error('[postgresql-ssh-mcp] SSH tunnel: enabled');
    }

    const retryIntervalMs = 5000;
    let attempts = 0;

    const attemptInitialize = async (): Promise<void> => {
      if (isShuttingDown) {
        return;
      }

      try {
        await connectionManager.initialize();
        console.error('[postgresql-ssh-mcp] Database connection established');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          '[postgresql-ssh-mcp] Database connection failed:',
          obfuscateConnectionString(message)
        );

        try {
          await connectionManager.close();
        } catch {
          // Ignore cleanup errors during retry
        }

        attempts += 1;
        console.error(
          `[postgresql-ssh-mcp] Retrying connection in ${retryIntervalMs}ms (attempt ${attempts})`
        );
        retryTimer = setTimeout(() => {
          void attemptInitialize();
        }, retryIntervalMs);
      }
    };

    void attemptInitialize();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      '[postgresql-ssh-mcp] Fatal error:',
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
  console.error('[postgresql-ssh-mcp] Failed to start:', err);
  process.exit(1);
});
