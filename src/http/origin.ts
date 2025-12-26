import type { Request, Response, NextFunction } from 'express';

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function parseAllowedOrigins(
  raw: string | undefined
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === '*') {
    return undefined;
  }

  const rawList = trimmed.split(',');
  const normalized = rawList
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));

  return unique.length > 0 ? unique : undefined;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[] | undefined
): boolean {
  if (!origin || !allowedOrigins || allowedOrigins.length === 0) {
    return true;
  }
  const normalized = normalizeOrigin(origin);
  return allowedOrigins.includes(normalized);
}

export function createOriginGuard(allowedOrigins: string[] | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      next();
      return;
    }

    const originHeader = req.get('origin') ?? undefined;

    if (!isOriginAllowed(originHeader, allowedOrigins)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `Invalid Origin header: ${originHeader}`,
        },
        id: null,
      });
      return;
    }

    next();
  };
}
