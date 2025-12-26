import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOriginGuard } from '../../src/http/origin.js';

describe('origin guard', () => {
  const allowedOrigins = [
    'https://chatgpt.com',
    'http://localhost:3000',
  ];

  const createApp = () => {
    const app = express();
    app.use('/mcp', createOriginGuard(allowedOrigins));
    app.get('/mcp', (_req, res) => res.json({ ok: true }));
    return app;
  };

  const createOpenApp = () => {
    const app = express();
    app.use('/mcp', createOriginGuard(undefined));
    app.get('/mcp', (_req, res) => res.json({ ok: true }));
    return app;
  };

  it('allows requests without an Origin header', async () => {
    const response = await request(createApp()).get('/mcp');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('allows requests with a whitelisted Origin', async () => {
    const response = await request(createApp())
      .get('/mcp')
      .set('Origin', 'https://chatgpt.com');
    expect(response.status).toBe(200);
  });

  it('normalizes Origin before checking', async () => {
    const response = await request(createApp())
      .get('/mcp')
      .set('Origin', 'https://CHATGPT.com/');
    expect(response.status).toBe(200);
  });

  it('rejects requests with a non-whitelisted Origin', async () => {
    const response = await request(createApp())
      .get('/mcp')
      .set('Origin', 'https://evil.example.com');
    expect(response.status).toBe(403);
    expect(response.body.error.message).toContain('Invalid Origin header');
  });

  it('allows all origins when no allowlist is configured', async () => {
    const response = await request(createOpenApp())
      .get('/mcp')
      .set('Origin', 'https://anything.example.com');
    expect(response.status).toBe(200);
  });
});
