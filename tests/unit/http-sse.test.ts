import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createHttpApp } from '../../src/http/app.js';
import type { ConnectionManager } from '../../src/connection/postgres-pool.js';
import type { HttpConfig } from '../../src/types.js';

const createConnectionManager = (): ConnectionManager =>
  ({
    healthCheck: async () => undefined,
    close: async () => undefined,
    executeQuery: async () => undefined,
  }) as unknown as ConnectionManager;

const httpConfig: HttpConfig = {
  port: 3000,
  host: '127.0.0.1',
  authMode: 'none',
  sessionTtlMinutes: 30,
  stateless: false,
  serverPoolSize: 4,
  sessionCleanupIntervalMs: 300000,
};

describe('HTTP SSE flow', () => {
  let connectionManager: ConnectionManager;
  let appContext: ReturnType<typeof createHttpApp>;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    connectionManager = createConnectionManager();
    appContext = createHttpApp({
      httpConfig,
      connectionManager,
      enableJsonResponse: false,
    });
    server = appContext.app.listen(0);
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await appContext.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const initializeSession = async (): Promise<string> => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'sse-test-client',
          version: '0.0.0',
        },
      },
    });

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const sessionId = res.headers['mcp-session-id'];
          if (typeof sessionId !== 'string') {
            reject(new Error('Missing mcp-session-id header'));
            res.destroy();
            return;
          }
          res.destroy();
          resolve(sessionId);
        }
      );

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  };

  it('opens an SSE stream with correct headers', async () => {
    const sessionId = await initializeSession();

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'mcp-session-id': sessionId,
          },
        },
        (res) => {
          try {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');
            res.destroy();
            resolve();
          } catch (err) {
            res.destroy();
            reject(err);
          }
        }
      );

      req.on('error', reject);
      req.end();
    });
  });
});
