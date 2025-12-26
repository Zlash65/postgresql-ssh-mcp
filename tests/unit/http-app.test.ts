import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createHttpApp } from '../../src/http/app.js';
import type { ConnectionManager } from '../../src/connection/postgres-pool.js';
import type { HttpConfig } from '../../src/types.js';

const createConnectionManager = (): ConnectionManager =>
  ({
    healthCheck: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn(),
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

describe('HTTP app integration', () => {
  let connectionManager: ConnectionManager;
  let appContext: ReturnType<typeof createHttpApp>;
  const acceptHeader = 'application/json, text/event-stream';

  const initializeSession = async () => {
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
          clientInfo: {
            name: 'http-app-test',
            version: '0.0.0',
          },
        },
      });

    return response;
  };

  beforeEach(() => {
    connectionManager = createConnectionManager();
    appContext = createHttpApp({
      httpConfig,
      connectionManager,
      enableJsonResponse: true,
    });
  });

  afterEach(async () => {
    await appContext.stop();
  });

  it('initializes a session and lists tools', async () => {
    const initResponse = await initializeSession();

    expect(initResponse.status).toBe(200);
    const sessionId = initResponse.headers['mcp-session-id'];
    expect(sessionId).toBeDefined();

    const toolsResponse = await request(appContext.app)
      .post('/mcp')
      .set('mcp-session-id', sessionId)
      .set('Accept', acceptHeader)
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(toolsResponse.status).toBe(200);
    const toolNames = toolsResponse.body.result.tools.map(
      (tool: { name: string }) => tool.name
    );
    expect(toolNames).toContain('execute_query');
  });

  it('returns 406 for GET /mcp without SSE Accept header', async () => {
    const initResponse = await initializeSession();

    const sessionId = initResponse.headers['mcp-session-id'];
    const response = await request(appContext.app)
      .get('/mcp')
      .set('mcp-session-id', sessionId);

    expect(response.status).toBe(406);
  });

  it('health/ready mirrors connection manager status', async () => {
    const okResponse = await request(appContext.app).get('/health/ready');
    expect(okResponse.status).toBe(200);
    expect(connectionManager.healthCheck).toHaveBeenCalled();

    vi.mocked(connectionManager.healthCheck).mockRejectedValueOnce(
      new Error('db down')
    );

    const failResponse = await request(appContext.app).get('/health/ready');
    expect(failResponse.status).toBe(503);
    expect(failResponse.body.error).toBe('db down');
  });

  it('includes resource_documentation in OAuth metadata when configured', async () => {
    const oauthConfig: HttpConfig = {
      ...httpConfig,
      authMode: 'oauth',
      auth0Domain: 'test.auth0.com',
      auth0Audience: 'https://api.example.com',
      resourceDocumentation: 'https://docs.example.com/mcp',
      allowedHosts: ['api.example.com'],
    };

    const oauthContext = createHttpApp({
      httpConfig: oauthConfig,
      connectionManager,
    });

    try {
      const response = await request(oauthContext.app)
        .get('/.well-known/oauth-protected-resource')
        .set('Host', 'api.example.com');

      expect(response.status).toBe(200);
      expect(response.body.resource_documentation).toBe(
        'https://docs.example.com/mcp'
      );
    } finally {
      await oauthContext.stop();
    }
  });

  it('cleans up expired sessions on the cleanup interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const ttlConfig: HttpConfig = {
      ...httpConfig,
      sessionTtlMinutes: 1,
    };

    const ttlContext = createHttpApp({
      httpConfig: ttlConfig,
      connectionManager,
      enableJsonResponse: true,
    });

    try {
      const initResponse = await request(ttlContext.app)
        .post('/mcp')
        .set('Accept', acceptHeader)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: 'http-app-test',
              version: '0.0.0',
            },
          },
        });

      const sessionId = initResponse.headers['mcp-session-id'];
      expect(sessionId).toBeDefined();
      expect(ttlContext.sessions.size).toBe(1);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
      await vi.runOnlyPendingTimersAsync();

      expect(ttlContext.sessions.size).toBe(0);
    } finally {
      await ttlContext.stop();
      vi.useRealTimers();
    }
  });
});
