import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../src/http/app.js';
import type { ConnectionManager } from '../../src/connection/postgres-pool.js';
import type { HttpConfig } from '../../src/types.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import * as jose from 'jose';

const createConnectionManager = (): ConnectionManager =>
  ({
    healthCheck: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn(),
  }) as unknown as ConnectionManager;

const oauthConfig: HttpConfig = {
  port: 3000,
  host: '127.0.0.1',
  authMode: 'oauth',
  auth0Domain: 'test.auth0.com',
  auth0Audience: 'https://api.example.com',
  sessionTtlMinutes: 30,
  stateless: false,
  serverPoolSize: 4,
  sessionCleanupIntervalMs: 300000,
  allowedHosts: ['api.example.com'],
};

describe('HTTP OAuth auth flow', () => {
  let connectionManager: ConnectionManager;
  let appContext: ReturnType<typeof createHttpApp>;

  beforeEach(() => {
    connectionManager = createConnectionManager();
    appContext = createHttpApp({
      httpConfig: oauthConfig,
      connectionManager,
      enableJsonResponse: true,
    });
  });

  afterEach(async () => {
    await appContext.stop();
    vi.clearAllMocks();
  });

  it('rejects missing Authorization header with 401', async () => {
    const response = await request(appContext.app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Host', 'api.example.com')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.0' },
        },
      });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain(
      'resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"'
    );
    expect(response.body.error.code).toBe(-32001);
    expect(response.body.error.message).toContain('Authorization header');
  });

  it('rejects invalid token with 401', async () => {
    vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new Error('Invalid token'));

    const response = await request(appContext.app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', 'Bearer invalid.token')
      .set('Host', 'api.example.com')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.0' },
        },
      });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain(
      'resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"'
    );
    expect(response.body.error.code).toBe(-32001);
    expect(response.body.error.message).toContain('Invalid or expired token');
  });
});
