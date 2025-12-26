import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cors from 'cors';
import { isOriginAllowed } from '../../src/http/origin.js';

describe('HTTP Endpoints', () => {
  describe('health endpoints', () => {
    it('GET /health returns ok status', async () => {
      const app = express();
      app.get('/health', (_req, res) => {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '1.1.0',
        });
      });

      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.version).toBe('1.1.0');
      expect(response.body.timestamp).toBeDefined();
    });

    it('GET /health/ready returns ready when db connected', async () => {
      const app = express();
      const mockHealthCheck = vi.fn().mockResolvedValue(undefined);

      app.get('/health/ready', async (_req, res) => {
        try {
          await mockHealthCheck();
          res.json({
            status: 'ready',
            database: 'connected',
            timestamp: new Date().toISOString(),
          });
        } catch {
          res.status(503).json({
            status: 'not_ready',
            database: 'disconnected',
          });
        }
      });

      const response = await request(app).get('/health/ready');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body.database).toBe('connected');
    });

    it('GET /health/ready returns 503 when db disconnected', async () => {
      const app = express();
      const mockHealthCheck = vi.fn().mockRejectedValue(new Error('Connection failed'));

      app.get('/health/ready', async (_req, res) => {
        try {
          await mockHealthCheck();
          res.json({ status: 'ready', database: 'connected' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          res.status(503).json({
            status: 'not_ready',
            database: 'disconnected',
            error: message,
          });
        }
      });

      const response = await request(app).get('/health/ready');
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.database).toBe('disconnected');
      expect(response.body.error).toBe('Connection failed');
    });
  });

  describe('OAuth discovery endpoint', () => {
    it('GET /.well-known/oauth-protected-resource returns correct metadata', async () => {
      const app = express();
      const auth0Domain = 'test.auth0.com';

      app.get('/.well-known/oauth-protected-resource', (req, res) => {
        res.json({
          resource: `https://${req.get('host')}/mcp`,
          authorization_servers: [`https://${auth0Domain}`],
          scopes_supported: ['openid', 'profile', 'email'],
          bearer_methods_supported: ['header'],
        });
      });

      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .set('Host', 'api.example.com');

      expect(response.status).toBe(200);
      expect(response.body.resource).toBe('https://api.example.com/mcp');
      expect(response.body.authorization_servers).toEqual(['https://test.auth0.com']);
      expect(response.body.scopes_supported).toContain('openid');
      expect(response.body.bearer_methods_supported).toEqual(['header']);
    });
  });

  describe('CORS configuration', () => {
    it('responds to OPTIONS preflight with correct headers', async () => {
      const app = express();
      const allowedOrigins = ['https://chatgpt.com', 'https://chat.openai.com'];
      app.use(cors({
        origin: (origin, callback) => {
          callback(null, isOriginAllowed(origin, allowedOrigins));
        },
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'Accept'],
        exposedHeaders: ['mcp-session-id'],
        credentials: true,
      }));
      app.post('/mcp', (_req, res) => res.json({ ok: true }));

      const response = await request(app)
        .options('/mcp')
        .set('Origin', 'https://chatgpt.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization, mcp-session-id');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('https://chatgpt.com');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toContain('mcp-session-id');
    });

    it('includes mcp-session-id in exposed headers', async () => {
      const app = express();
      app.use(cors({
        origin: true,
        exposedHeaders: ['mcp-session-id'],
      }));
      app.get('/test', (_req, res) => {
        res.set('mcp-session-id', 'test-session-123');
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/test')
        .set('Origin', 'https://chatgpt.com');

      expect(response.headers['access-control-expose-headers']).toContain('mcp-session-id');
    });
  });

  describe('MCP endpoint error responses', () => {
    it('returns JSON-RPC error for missing session on non-initialize request', async () => {
      const app = express();
      app.use(express.json());

      app.post('/mcp', (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        const isInitialize = req.body?.method === 'initialize';

        if (!sessionId && !isInitialize) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'First request must be an initialize request',
            },
            id: null,
          });
          return;
        }
        res.json({ jsonrpc: '2.0', result: {}, id: req.body?.id });
      });

      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

      expect(response.status).toBe(400);
      expect(response.body.jsonrpc).toBe('2.0');
      expect(response.body.error.code).toBe(-32000);
      expect(response.body.error.message).toContain('initialize');
    });

    it('returns JSON-RPC error for invalid session', async () => {
      const app = express();
      app.use(express.json());
      const sessions = new Map();

      app.post('/mcp', (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string;

        if (sessionId && !sessions.has(sessionId)) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Session not found or expired',
            },
            id: null,
          });
          return;
        }
        res.json({ jsonrpc: '2.0', result: {}, id: req.body?.id });
      });

      const response = await request(app)
        .post('/mcp')
        .set('mcp-session-id', 'invalid-session-id')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toContain('Session not found');
    });

    it('GET /mcp returns error without session', async () => {
      const app = express();

      app.get('/mcp', (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (!sessionId) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Missing mcp-session-id header' },
            id: null,
          });
          return;
        }
        res.json({ ok: true });
      });

      const response = await request(app).get('/mcp');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('mcp-session-id');
    });

    it('DELETE /mcp returns error without session', async () => {
      const app = express();

      app.delete('/mcp', (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (!sessionId) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Missing mcp-session-id header' },
            id: null,
          });
          return;
        }
        res.status(204).send();
      });

      const response = await request(app).delete('/mcp');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('mcp-session-id');
    });
  });
});
