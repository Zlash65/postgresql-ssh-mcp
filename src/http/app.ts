import type { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HttpConfig } from '../types.js';
import type { ConnectionManager } from '../connection/postgres-pool.js';
import { createServer } from '../server.js';
import { createAuthMiddleware } from './auth.js';
import { createOriginGuard, isOriginAllowed } from './origin.js';
import { VERSION } from '../version.js';

interface Session {
  transport: StreamableHTTPServerTransport;
  lastAccess: number;
}

const jsonRpcError = (
  res: Response,
  status: number,
  code: number,
  message: string
): void => {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
};

export interface HttpAppContext {
  app: ReturnType<typeof createMcpExpressApp>;
  sessions: Map<string, Session>;
  stop: () => Promise<void>;
}

export function createHttpApp(options: {
  httpConfig: HttpConfig;
  connectionManager: ConnectionManager;
  enableJsonResponse?: boolean;
}): HttpAppContext {
  const { httpConfig, connectionManager, enableJsonResponse } = options;
  const stateless = httpConfig.stateless;
  const jsonResponseEnabled = stateless ? true : enableJsonResponse ?? false;
  const sessions = new Map<string, Session>();
  const serverPool = stateless
    ? createServerPool(httpConfig.serverPoolSize, connectionManager)
    : null;
  const allowedHostnames = normalizeAllowedHostnames(httpConfig.allowedHosts);

  const app = createMcpExpressApp({
    host: httpConfig.host,
    allowedHosts: allowedHostnames,
  });

  const allowedOrigins = httpConfig.allowedOrigins;

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isOriginAllowed(origin, allowedOrigins));
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'mcp-session-id',
        'Accept',
      ],
      exposedHeaders: ['mcp-session-id'],
      credentials: true,
      maxAge: 86400,
    })
  );

  if (httpConfig.authMode === 'oauth') {
    const resolveResourceHost = (req: Request): string | undefined => {
      const hostHeader = req.get('host')?.trim();
      if (hostHeader) {
        return hostHeader;
      }
      if (httpConfig.allowedHosts && httpConfig.allowedHosts.length > 0) {
        return httpConfig.allowedHosts[0];
      }
      if (httpConfig.host !== '0.0.0.0' && httpConfig.host !== '::') {
        return httpConfig.host;
      }
      return undefined;
    };

    const buildResourceMetadata = (host: string) => ({
      resource: `https://${host}/mcp`,
      authorization_servers: [`https://${httpConfig.auth0Domain}`],
      scopes_supported: ['openid', 'profile', 'email'],
      bearer_methods_supported: ['header'],
      ...(httpConfig.resourceDocumentation && {
        resource_documentation: httpConfig.resourceDocumentation,
      }),
    });

    app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
      const resourceHost = resolveResourceHost(req);
      if (!resourceHost) {
        res.status(400).json({
          error: 'Unable to determine resource host. Ensure Host header is set.',
        });
        return;
      }
      res.json(buildResourceMetadata(resourceHost));
    });

    app.get('/mcp/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
      const resourceHost = resolveResourceHost(req);
      if (!resourceHost) {
        res.status(400).json({
          error: 'Unable to determine resource host. Ensure Host header is set.',
        });
        return;
      }
      res.json(buildResourceMetadata(resourceHost));
    });
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: VERSION,
    });
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await connectionManager.healthCheck();
      res.json({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(503).json({
        status: 'not_ready',
        database: 'disconnected',
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use('/mcp', createOriginGuard(allowedOrigins));

  if (httpConfig.authMode === 'oauth') {
    const authMiddleware = createAuthMiddleware({
      domain: httpConfig.auth0Domain!,
      audience: httpConfig.auth0Audience!,
    });
    app.use('/mcp', authMiddleware);
  }

  app.post('/mcp', async (req: Request, res: Response) => {
    if (stateless) {
      if (!serverPool) {
        jsonRpcError(res, 500, -32603, 'Server pool not initialized');
        return;
      }

      const server = await serverPool.acquire();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: jsonResponseEnabled,
        enableDnsRebindingProtection: true,
        allowedOrigins,
        allowedHosts: httpConfig.allowedHosts,
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[HTTP] Error handling stateless request:`, message);
        if (!res.headersSent) {
          jsonRpcError(res, 500, -32603, 'Internal error');
        }
      } finally {
        try {
          await server.close();
        } catch {
          /* ignore close errors */
        }
        serverPool.release(server);
      }

      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session: Session | undefined;

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!;
      session.lastAccess = Date.now();
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const sessionRef: { current?: Session } = {};

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          sessions.set(id, sessionRef.current!);
        },
        onsessionclosed: (id: string) => {
          sessions.delete(id);
        },
        enableJsonResponse: jsonResponseEnabled,
        enableDnsRebindingProtection: true,
        allowedOrigins,
        allowedHosts: httpConfig.allowedHosts,
      });

      const { server } = createServer(connectionManager);
      await server.connect(transport);

      sessionRef.current = {
        transport,
        lastAccess: Date.now(),
      };

      session = sessionRef.current;
    } else {
      const status = sessionId ? 404 : 400;
      jsonRpcError(
        res,
        status,
        -32000,
        sessionId
          ? 'Session not found or expired'
          : 'First request must be an initialize request'
      );
      return;
    }

    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[HTTP] Error handling request:`, message);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, 'Internal error');
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    if (stateless) {
      jsonRpcError(res, 405, -32000, 'Method not allowed');
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      jsonRpcError(res, 400, -32000, 'Missing mcp-session-id header');
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      jsonRpcError(res, 404, -32000, 'Session not found or expired');
      return;
    }

    session.lastAccess = Date.now();

    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[HTTP] Error handling GET request:`, message);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, 'Internal error');
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    if (stateless) {
      jsonRpcError(res, 405, -32000, 'Method not allowed');
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      jsonRpcError(res, 400, -32000, 'Missing mcp-session-id header');
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      jsonRpcError(res, 404, -32000, 'Session not found or expired');
      return;
    }

    try {
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
      console.error(`[HTTP] Session deleted: ${sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[HTTP] Error handling DELETE request:`, message);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, 'Internal error');
      }
    }
  });

  const cleanupIntervalMs = httpConfig.sessionCleanupIntervalMs;
  const sessionTtlMs = httpConfig.sessionTtlMinutes * 60 * 1000;
  const cleanupInterval = stateless
    ? null
    : setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of sessions) {
          if (now - session.lastAccess > sessionTtlMs) {
            console.error(`[HTTP] Cleaning up expired session: ${sessionId}`);
            try {
              session.transport.close();
            } catch {
              /* ignore close errors */
            }
            sessions.delete(sessionId);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.error(
            `[HTTP] Cleaned up ${cleanedCount} expired session(s), ${sessions.size} active`
          );
        }
      }, cleanupIntervalMs);

  const stop = async (): Promise<void> => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    for (const session of sessions.values()) {
      try {
        await session.transport.close();
      } catch {
        /* ignore close errors */
      }
    }
    sessions.clear();

    if (serverPool) {
      await serverPool.stop();
    }
  };

  return { app, sessions, stop };
}

interface ServerPool {
  acquire: () => Promise<McpServer>;
  release: (server: McpServer) => void;
  stop: () => Promise<void>;
}

function createServerPool(
  size: number,
  connectionManager: ConnectionManager
): ServerPool {
  const idle: McpServer[] = [];
  const allServers: McpServer[] = [];
  const waiters: Array<(server: McpServer) => void> = [];

  for (let i = 0; i < size; i++) {
    const { server } = createServer(connectionManager);
    idle.push(server);
    allServers.push(server);
  }

  return {
    acquire: async () => {
      const server = idle.pop();
      if (server) {
        return server;
      }
      return new Promise<McpServer>((resolve) => {
        waiters.push(resolve);
      });
    },
    release: (server) => {
      resetServerState(server);
      const next = waiters.shift();
      if (next) {
        next(server);
        return;
      }
      idle.push(server);
    },
    stop: async () => {
      waiters.length = 0;
      idle.length = 0;
      await Promise.all(
        allServers.map(async (server) => {
          try {
            await server.close();
          } catch {
            /* ignore close errors */
          }
        })
      );
    },
  };
}

function resetServerState(server: McpServer): void {
  try {
    const wrapper = server as unknown as Record<string, unknown>;
    const inner = wrapper?.server as Record<string, unknown> | undefined;

    if (!inner) {
      return;
    }

    if ('_clientCapabilities' in inner) {
      inner._clientCapabilities = undefined;
    }
    if ('_clientVersion' in inner) {
      inner._clientVersion = undefined;
    }
    if ('_loggingLevels' in inner) {
      const loggingLevels = inner._loggingLevels;
      if (loggingLevels instanceof Map) {
        loggingLevels.clear();
      }
    }
  } catch (err) {
    console.error(
      '[HTTP] Server state reset failed (SDK structure changed?):',
      err instanceof Error ? err.message : String(err)
    );
  }
}

function normalizeAllowedHostnames(
  allowedHosts?: string[]
): string[] | undefined {
  if (!allowedHosts || allowedHosts.length === 0) {
    return undefined;
  }

  const hostnames = new Set<string>();
  for (const host of allowedHosts) {
    try {
      const url = new URL(host.includes('://') ? host : `http://${host}`);
      if (url.hostname) {
        hostnames.add(url.hostname.toLowerCase());
      }
    } catch {
      hostnames.add(host.toLowerCase());
    }
  }

  return hostnames.size > 0 ? Array.from(hostnames) : undefined;
}
