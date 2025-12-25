import { parse as parseConnectionString } from 'pg-connection-string';
import type {
  DatabaseConfig,
  SSLPreference,
  SSHTunnelConfig,
  ParsedConfig,
} from './types.js';

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

  return {
    host: requireEnv('SSH_HOST'),
    port,
    username: requireEnv('SSH_USER'),
    privateKeyPath,
    privateKeyPassphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE,
    password,
    strictHostKey: process.env.SSH_STRICT_HOST_KEY !== 'false',
    knownHostsPath: process.env.SSH_KNOWN_HOSTS_PATH,
    keepaliveInterval,
  };
}

export function parseConfig(): ParsedConfig {
  const database = parseDatabaseConfig();
  const sslPreference = parseSSLPreference();
  const ssh = parseSSHConfig();

  const readOnly = process.env.READ_ONLY !== 'false';
  const queryTimeout = parseInt(process.env.QUERY_TIMEOUT || '30000', 10);
  const maxRows = parseInt(process.env.MAX_ROWS || '1000', 10);

  if (isNaN(queryTimeout) || queryTimeout < 0) {
    throw new Error('QUERY_TIMEOUT must be a positive number');
  }
  if (isNaN(maxRows) || maxRows < 1) {
    throw new Error('MAX_ROWS must be a positive number');
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
  console.error('[Config] Query timeout:', queryTimeout, 'ms');

  if (ssh) {
    console.error('[Config] SSH tunnel enabled:', {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      authMethod: ssh.privateKeyPath ? 'key' : 'password',
      strictHostKey: ssh.strictHostKey,
    });
  }

  return {
    database,
    sslPreference,
    ssh,
    readOnly,
    queryTimeout,
    maxRows,
  };
}
