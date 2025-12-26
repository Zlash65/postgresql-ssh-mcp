import { parse as parseConnectionString } from 'pg-connection-string';
import type {
  DatabaseConfig,
  SSLPreference,
  SSHTunnelConfig,
  ParsedConfig,
  HttpConfig,
  AuthMode,
} from './types.js';
import { parseAllowedOrigins } from './http/origin.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseDatabaseConfig(): DatabaseConfig {
  const uri = process.env.DATABASE_URI;

  if (uri) {
    if (uri.includes('sslmode=')) {
      console.error(
        '[Config] Warning: sslmode in DATABASE_URI is ignored. Use DATABASE_SSL env var instead.'
      );
    }

    const parsed = parseConnectionString(uri);

    if (!parsed.host) {
      throw new Error('DATABASE_URI missing host');
    }
    if (!parsed.database) {
      throw new Error('DATABASE_URI missing database name');
    }
    if (!parsed.user) {
      throw new Error('DATABASE_URI missing user');
    }

    return {
      host: parsed.host,
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.database,
      user: parsed.user,
      password: parsed.password || '',
    };
  }

  return {
    host: requireEnv('DATABASE_HOST'),
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: requireEnv('DATABASE_NAME'),
    user: requireEnv('DATABASE_USER'),
    password: requireEnv('DATABASE_PASSWORD'),
  };
}

function parseSSLPreference(): SSLPreference {
  const sslEnv = process.env.DATABASE_SSL?.toLowerCase();

  return {
    explicit:
      sslEnv === 'true' ? 'true' : sslEnv === 'false' ? 'false' : null,
    ca: process.env.DATABASE_SSL_CA,
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

function parseSSHConfig(): SSHTunnelConfig | undefined {
  if (process.env.SSH_ENABLED !== 'true') {
    return undefined;
  }

  const privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH;
  const password = process.env.SSH_PASSWORD;

  if (!privateKeyPath && !password) {
    throw new Error(
      'SSH_ENABLED is true but no authentication method provided. ' +
        'Set either SSH_PRIVATE_KEY_PATH or SSH_PASSWORD.'
    );
  }

  const port = parseInt(process.env.SSH_PORT || '22', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('SSH_PORT must be a number between 1 and 65535');
  }

  const keepaliveInterval = parseInt(
    process.env.SSH_KEEPALIVE_INTERVAL || '10000',
    10
  );
  if (isNaN(keepaliveInterval) || keepaliveInterval < 1) {
    throw new Error(
      'SSH_KEEPALIVE_INTERVAL must be a positive number (minimum 1ms)'
    );
  }

  const trustOnFirstUse = process.env.SSH_TRUST_ON_FIRST_USE !== 'false';
  const maxReconnectAttempts = parseInt(
    process.env.SSH_MAX_RECONNECT_ATTEMPTS || '5',
    10
  );
  if (isNaN(maxReconnectAttempts) || maxReconnectAttempts < -1) {
    throw new Error(
      'SSH_MAX_RECONNECT_ATTEMPTS must be a number >= -1 (use -1 for unlimited)'
    );
  }

  return {
    host: requireEnv('SSH_HOST'),
    port,
    username: requireEnv('SSH_USER'),
    privateKeyPath,
    privateKeyPassphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE,
    password,
    strictHostKey: process.env.SSH_STRICT_HOST_KEY !== 'false',
    trustOnFirstUse,
    knownHostsPath: process.env.SSH_KNOWN_HOSTS_PATH,
    keepaliveInterval,
    maxReconnectAttempts,
  };
}

function parseAllowedHosts(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const hosts = raw
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  if (hosts.length === 0) {
    return undefined;
  }

  const normalized = hosts.map((host) => {
    try {
      const url = new URL(host.includes('://') ? host : `http://${host}`);
      return url.host.toLowerCase();
    } catch {
      throw new Error(`MCP_ALLOWED_HOSTS contains invalid host: ${host}`);
    }
  });

  return Array.from(new Set(normalized));
}

export function parseConfig(): ParsedConfig {
  const database = parseDatabaseConfig();
  const sslPreference = parseSSLPreference();
  const ssh = parseSSHConfig();

  const readOnly = process.env.READ_ONLY !== 'false';
  const queryTimeout = parseInt(process.env.QUERY_TIMEOUT || '30000', 10);
  const maxRows = parseInt(process.env.MAX_ROWS || '1000', 10);
  const maxConcurrentQueries = parseInt(
    process.env.MAX_CONCURRENT_QUERIES || '10',
    10
  );
  const poolDrainTimeoutMs = parseInt(
    process.env.POOL_DRAIN_TIMEOUT_MS || '5000',
    10
  );

  if (isNaN(queryTimeout) || queryTimeout < 0) {
    throw new Error('QUERY_TIMEOUT must be a positive number');
  }
  if (isNaN(maxRows) || maxRows < 1) {
    throw new Error('MAX_ROWS must be a positive number');
  }
  if (isNaN(maxConcurrentQueries) || maxConcurrentQueries < 1) {
    throw new Error('MAX_CONCURRENT_QUERIES must be a positive number');
  }
  if (isNaN(poolDrainTimeoutMs) || poolDrainTimeoutMs < 1) {
    throw new Error('POOL_DRAIN_TIMEOUT_MS must be a positive number');
  }
  if (database.port < 1 || database.port > 65535) {
    throw new Error('DATABASE_PORT must be between 1 and 65535');
  }

  console.error('[Config] Database:', {
    host: database.host,
    port: database.port,
    database: database.database,
    user: database.user,
  });
  console.error('[Config] Mode:', readOnly ? 'read-only' : 'read-write');
  console.error('[Config] Max rows:', maxRows);
  console.error('[Config] Max concurrent queries:', maxConcurrentQueries);
  console.error('[Config] Query timeout:', queryTimeout, 'ms');
  console.error('[Config] Pool drain timeout:', poolDrainTimeoutMs, 'ms');

  if (ssh) {
    console.error('[Config] SSH tunnel enabled:', {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      authMethod: ssh.privateKeyPath ? 'key' : 'password',
      strictHostKey: ssh.strictHostKey,
      trustOnFirstUse: ssh.trustOnFirstUse,
    });
  }

  return {
    database,
    sslPreference,
    ssh,
    readOnly,
    queryTimeout,
    maxRows,
    maxConcurrentQueries,
    poolDrainTimeoutMs,
  };
}

/**
 * Parse HTTP server configuration from environment variables
 */
export function parseHttpConfig(): HttpConfig {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.MCP_HOST || '0.0.0.0';
  const authMode = (process.env.MCP_AUTH_MODE || 'none') as AuthMode;
  const stateless = process.env.MCP_STATELESS !== 'false';
  let sessionTtlMinutes = parseInt(
    process.env.MCP_SESSION_TTL_MINUTES || '30',
    10
  );
  const serverPoolSize = parseInt(
    process.env.MCP_SERVER_POOL_SIZE || '4',
    10
  );
  const sessionCleanupIntervalMs = parseInt(
    process.env.MCP_SESSION_CLEANUP_INTERVAL_MS || '300000',
    10
  );
  const allowedOrigins = parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS);
  const allowedHosts = parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a number between 1 and 65535');
  }

  if (authMode !== 'none' && authMode !== 'oauth') {
    throw new Error('MCP_AUTH_MODE must be "none" or "oauth"');
  }

  if (isNaN(sessionTtlMinutes) || sessionTtlMinutes < 1) {
    if (!stateless) {
      throw new Error('MCP_SESSION_TTL_MINUTES must be a positive number');
    }
    sessionTtlMinutes = 30;
  }
  if (isNaN(serverPoolSize) || serverPoolSize < 1) {
    throw new Error('MCP_SERVER_POOL_SIZE must be a positive number');
  }
  if (isNaN(sessionCleanupIntervalMs) || sessionCleanupIntervalMs < 1) {
    throw new Error('MCP_SESSION_CLEANUP_INTERVAL_MS must be a positive number');
  }

  const auth0Domain = process.env.AUTH0_DOMAIN;
  const auth0Audience = process.env.AUTH0_AUDIENCE;
  const resourceDocumentation = process.env.MCP_RESOURCE_DOCUMENTATION;

  if (authMode === 'oauth') {
    if (!auth0Domain) {
      throw new Error('AUTH0_DOMAIN is required when MCP_AUTH_MODE=oauth');
    }
    if (!auth0Audience) {
      throw new Error('AUTH0_AUDIENCE is required when MCP_AUTH_MODE=oauth');
    }
  }

  if (resourceDocumentation) {
    try {
      new URL(resourceDocumentation);
    } catch {
      throw new Error(
        'MCP_RESOURCE_DOCUMENTATION must be a valid URL (e.g., https://docs.example.com)'
      );
    }
  }

  console.error('[Config] HTTP server:', {
    port,
    host,
    authMode,
    stateless,
    serverPoolSize,
    sessionCleanupIntervalMs,
    ...(!stateless && { sessionTtlMinutes }),
    ...(allowedOrigins && { allowedOrigins }),
    ...(allowedHosts && { allowedHosts }),
    ...(authMode === 'oauth' && {
      auth0Domain,
      auth0Audience,
    }),
    ...(resourceDocumentation && { resourceDocumentation }),
  });

  return {
    port,
    host,
    authMode,
    auth0Domain,
    auth0Audience,
    sessionTtlMinutes,
    stateless,
    serverPoolSize,
    sessionCleanupIntervalMs,
    allowedOrigins,
    allowedHosts,
    resourceDocumentation,
  };
}
