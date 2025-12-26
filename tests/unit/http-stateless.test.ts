import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
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
  stateless: true,
  serverPoolSize: 2,
  sessionCleanupIntervalMs: 300000,
};

describe('HTTP stateless mode', () => {
  let connectionManager: ConnectionManager;
  let appContext: ReturnType<typeof createHttpApp>;
  const acceptHeader = 'application/json, text/event-stream';

  beforeEach(() => {
    connectionManager = createConnectionManager();
    appContext = createHttpApp({
      httpConfig,
      connectionManager,
    });
  });

  afterEach(async () => {
    await appContext.stop();
  });

  it('does not issue a session id for initialize', async () => {
    const response = await request(appContext.app)
      .post('/mcp')
      .set('Accept', acceptHeader)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'stateless-test', version: '0.0.0' },
        },
      });

    expect(response.status).toBe(200);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(appContext.sessions.size).toBe(0);
  });

  it('handles tool requests without a session', async () => {
    const response = await request(appContext.app)
      .post('/mcp')
      .set('Accept', acceptHeader)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(response.status).toBe(200);
    const toolNames = response.body.result.tools.map(
      (tool: { name: string }) => tool.name
    );
    expect(toolNames).toContain('execute_query');
    expect(response.headers['mcp-session-id']).toBeUndefined();
  });

  it('rejects GET/DELETE in stateless mode', async () => {
    const getResponse = await request(appContext.app).get('/mcp');
    expect(getResponse.status).toBe(405);
    expect(getResponse.body.error.message).toContain('Method not allowed');

    const deleteResponse = await request(appContext.app).delete('/mcp');
    expect(deleteResponse.status).toBe(405);
    expect(deleteResponse.body.error.message).toContain('Method not allowed');
  });
});
