import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthMiddleware, verifyAuth0Token } from '../../src/http/auth.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import * as jose from 'jose';

describe('verifyAuth0Token', () => {
  const config = {
    domain: 'test.auth0.com',
    audience: 'https://api.example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns payload for valid token', async () => {
    const mockPayload = { sub: 'user123', aud: 'https://api.example.com' };
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: mockPayload,
      protectedHeader: { alg: 'RS256' },
    } as never);

    const result = await verifyAuth0Token('valid.jwt.token', config);
    expect(result).toEqual(mockPayload);
  });

  it('throws for invalid token', async () => {
    vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('Invalid signature'));

    await expect(verifyAuth0Token('invalid.token', config)).rejects.toThrow(
      'Invalid signature'
    );
  });

  it('throws for expired token', async () => {
    vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('Token expired'));

    await expect(verifyAuth0Token('expired.token', config)).rejects.toThrow(
      'Token expired'
    );
  });

  it('calls jwtVerify with correct options', async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'user' },
      protectedHeader: { alg: 'RS256' },
    } as never);

    await verifyAuth0Token('test.token', config);

    expect(jose.jwtVerify).toHaveBeenCalledWith(
      'test.token',
      expect.any(Function),
      {
        issuer: 'https://test.auth0.com/',
        audience: 'https://api.example.com',
        algorithms: ['RS256'],
      }
    );
  });
});

describe('createAuthMiddleware', () => {
  const config = {
    domain: 'test.auth0.com',
    audience: 'https://api.example.com',
  };

  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let headerMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn(() => ({ json: jsonMock }));
    mockReq = { headers: {} };
    headerMock = vi.fn();
    mockRes = { status: statusMock, json: jsonMock, setHeader: headerMock };
    mockNext = vi.fn();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const middleware = createAuthMiddleware(config);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authorization header with Bearer token required',
      },
      id: null,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    mockReq.headers = { authorization: 'Basic dXNlcjpwYXNz' };
    const middleware = createAuthMiddleware(config);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.auth for valid token', async () => {
    const mockPayload = { sub: 'user123' };
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: mockPayload,
      protectedHeader: { alg: 'RS256' },
    } as never);

    mockReq.headers = { authorization: 'Bearer valid.jwt.token' };
    const middleware = createAuthMiddleware(config);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as { auth?: unknown }).auth).toEqual(mockPayload);
  });

  it('returns 401 for invalid token', async () => {
    vi.mocked(jose.jwtVerify).mockRejectedValue(new Error('Invalid token'));

    mockReq.headers = { authorization: 'Bearer invalid.token' };
    const middleware = createAuthMiddleware(config);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Invalid or expired token',
      },
      id: null,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('extracts token correctly from Bearer header', async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'user' },
      protectedHeader: { alg: 'RS256' },
    } as never);

    mockReq.headers = { authorization: 'Bearer my.test.token' };
    const middleware = createAuthMiddleware(config);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(jose.jwtVerify).toHaveBeenCalledWith(
      'my.test.token',
      expect.any(Function),
      expect.any(Object)
    );
  });
});
