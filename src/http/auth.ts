import * as jose from 'jose';
import type { Request, Response, NextFunction } from 'express';
import type { Auth0Config } from '../types.js';

export interface AuthenticatedRequest extends Request {
  auth?: jose.JWTPayload;
}

let jwksCache: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let jwksCacheDomain: string | null = null;

/**
 * Get or create a cached JWKS fetcher for the given Auth0 domain
 */
function getJWKS(domain: string): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!jwksCache || jwksCacheDomain !== domain) {
    const jwksUrl = new URL(`https://${domain}/.well-known/jwks.json`);
    jwksCache = jose.createRemoteJWKSet(jwksUrl);
    jwksCacheDomain = domain;
  }
  return jwksCache;
}

/**
 * Verify an Auth0 JWT token
 * @param token - The JWT token to verify
 * @param config - Auth0 configuration
 * @returns The decoded JWT payload
 * @throws Error if verification fails
 */
export async function verifyAuth0Token(
  token: string,
  config: Auth0Config
): Promise<jose.JWTPayload> {
  const JWKS = getJWKS(config.domain);

  const { payload } = await jose.jwtVerify(token, JWKS, {
    issuer: `https://${config.domain}/`,
    audience: config.audience,
    algorithms: ['RS256'],
  });

  return payload;
}

/**
 * Create Express middleware for Auth0 JWT verification
 * @param config - Auth0 configuration
 * @returns Express middleware function
 */
export function createAuthMiddleware(config: Auth0Config) {
  const buildChallenge = (req: Request): string => {
    const rawHost =
      typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    const resourceMetadata = host
      ? `https://${host}/.well-known/oauth-protected-resource`
      : '/.well-known/oauth-protected-resource';
    return `Bearer realm="mcp", resource_metadata="${resourceMetadata}", scope="openid profile email"`;
  };

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', buildChallenge(req));
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authorization header with Bearer token required',
        },
        id: null,
      });
      return;
    }

    const token = authHeader.slice(7);

    try {
      const payload = await verifyAuth0Token(token, config);
      req.auth = payload;
      next();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Token verification failed';
      console.error('[Auth] Token verification failed:', message);

      res.setHeader('WWW-Authenticate', buildChallenge(req));
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Invalid or expired token',
        },
        id: null,
      });
    }
  };
}
