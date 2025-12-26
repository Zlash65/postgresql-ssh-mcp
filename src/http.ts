#!/usr/bin/env node

import { parseConfig, parseHttpConfig } from './config.js';
import { ConnectionManager } from './connection/postgres-pool.js';
import { createHttpApp } from './http/app.js';
import { obfuscateConnectionString } from './lib/obfuscate.js';

async function main(): Promise<void> {
  console.error('[HTTP] Starting MCP HTTP server...');

  const config = parseConfig();
  const httpConfig = parseHttpConfig();

  const connectionManager = new ConnectionManager(config);

  try {
    await connectionManager.initialize();
    console.error('[HTTP] Database connection established');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      '[HTTP] Database connection failed:',
      obfuscateConnectionString(message)
    );
    process.exit(1);
  }

  const { app, stop } = createHttpApp({
    httpConfig,
    connectionManager,
  });

  const server = app.listen(httpConfig.port, httpConfig.host, () => {
    console.error(
      `[HTTP] Server running on http://${httpConfig.host}:${httpConfig.port}`
    );
    console.error(
      `[HTTP] MCP endpoint: http://${httpConfig.host}:${httpConfig.port}/mcp`
    );
    console.error(`[HTTP] Auth mode: ${httpConfig.authMode}`);
    if (httpConfig.allowedOrigins && httpConfig.allowedOrigins.length > 0) {
      console.error(
        `[HTTP] Allowed origins: ${httpConfig.allowedOrigins.join(', ')}`
      );
    }
    if (httpConfig.allowedHosts && httpConfig.allowedHosts.length > 0) {
      console.error(
        `[HTTP] Allowed hosts: ${httpConfig.allowedHosts.join(', ')}`
      );
    }
    console.error(
      `[HTTP] Database mode: ${config.readOnly ? 'read-only' : 'read-write'}`
    );
    console.error(
      `[HTTP] Session mode: ${httpConfig.stateless ? 'stateless' : 'stateful'}`
    );
    if (!httpConfig.stateless) {
      console.error(
        `[HTTP] Session TTL: ${httpConfig.sessionTtlMinutes} minutes`
      );
      console.error(
        `[HTTP] Session cleanup interval: ${httpConfig.sessionCleanupIntervalMs} ms`
      );
    } else {
      console.error(
        `[HTTP] Server pool size: ${httpConfig.serverPoolSize}`
      );
    }

    if (config.ssh) {
      console.error('[HTTP] SSH tunnel: enabled');
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[HTTP] Received ${signal}, starting graceful shutdown...`);

    await stop();

    server.close(() => {
      console.error('[HTTP] Server closed to new connections');
    });

    await connectionManager.close();

    console.error('[HTTP] Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    console.error(
      '[HTTP] Uncaught exception:',
      obfuscateConnectionString(err.message)
    );
    console.error(err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(
      '[HTTP] Unhandled rejection:',
      obfuscateConnectionString(message)
    );
    process.exit(1);
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[HTTP] Failed to start:', obfuscateConnectionString(message));
  process.exit(1);
});
