import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig, parseHttpConfig } from '../../src/config.js';

describe('parseConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URI;
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USER;
    delete process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    delete process.env.SSH_ENABLED;
    delete process.env.SSH_HOST;
    delete process.env.SSH_PORT;
    delete process.env.SSH_USER;
    delete process.env.SSH_PASSWORD;
    delete process.env.SSH_PRIVATE_KEY_PATH;
    delete process.env.SSH_PRIVATE_KEY_PASSPHRASE;
    delete process.env.SSH_STRICT_HOST_KEY;
    delete process.env.SSH_KNOWN_HOSTS_PATH;
    delete process.env.SSH_KEEPALIVE_INTERVAL;
    delete process.env.SSH_MAX_RECONNECT_ATTEMPTS;
    delete process.env.READ_ONLY;
    delete process.env.QUERY_TIMEOUT;
    delete process.env.MAX_ROWS;
    delete process.env.MAX_CONCURRENT_QUERIES;
    delete process.env.POOL_DRAIN_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('DATABASE_URI parsing', () => {
    it('parses valid DATABASE_URI', () => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost:5432/testdb';
      const config = parseConfig();
      expect(config.database.host).toBe('localhost');
      expect(config.database.port).toBe(5432);
      expect(config.database.database).toBe('testdb');
      expect(config.database.user).toBe('user');
      expect(config.database.password).toBe('pass');
    });

    it('uses default port when not specified in URI', () => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost/testdb';
      const config = parseConfig();
      expect(config.database.port).toBe(5432);
    });

    it('throws when DATABASE_URI missing host', () => {
      process.env.DATABASE_URI = 'postgresql:///testdb';
      expect(() => parseConfig()).toThrow(/missing host/);
    });

    it('throws when DATABASE_URI missing database', () => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost:5432';
      expect(() => parseConfig()).toThrow(/missing database/);
    });

    it('throws when DATABASE_URI missing user', () => {
      process.env.DATABASE_URI = 'postgresql://localhost:5432/testdb';
      expect(() => parseConfig()).toThrow(/missing user/);
    });
  });

  describe('individual database env vars', () => {
    it('parses individual env vars when DATABASE_URI not set', () => {
      process.env.DATABASE_HOST = 'db.example.com';
      process.env.DATABASE_PORT = '5433';
      process.env.DATABASE_NAME = 'mydb';
      process.env.DATABASE_USER = 'admin';
      process.env.DATABASE_PASSWORD = 'secret';
      const config = parseConfig();
      expect(config.database.host).toBe('db.example.com');
      expect(config.database.port).toBe(5433);
      expect(config.database.database).toBe('mydb');
      expect(config.database.user).toBe('admin');
      expect(config.database.password).toBe('secret');
    });

    it('uses default port 5432 when DATABASE_PORT not set', () => {
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_NAME = 'testdb';
      process.env.DATABASE_USER = 'user';
      process.env.DATABASE_PASSWORD = 'pass';
      const config = parseConfig();
      expect(config.database.port).toBe(5432);
    });

    it('throws when DATABASE_HOST missing', () => {
      process.env.DATABASE_NAME = 'testdb';
      process.env.DATABASE_USER = 'user';
      process.env.DATABASE_PASSWORD = 'pass';
      expect(() => parseConfig()).toThrow(/DATABASE_HOST/);
    });

    it('throws for invalid DATABASE_PORT', () => {
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_NAME = 'testdb';
      process.env.DATABASE_USER = 'user';
      process.env.DATABASE_PASSWORD = 'pass';
      process.env.DATABASE_PORT = '99999';
      expect(() => parseConfig()).toThrow(/DATABASE_PORT must be between 1 and 65535/);
    });
  });

  describe('SSL configuration', () => {
    beforeEach(() => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost:5432/testdb';
    });

    it('parses DATABASE_SSL=true', () => {
      process.env.DATABASE_SSL = 'true';
      const config = parseConfig();
      expect(config.sslPreference.explicit).toBe('true');
    });

    it('parses DATABASE_SSL=false', () => {
      process.env.DATABASE_SSL = 'false';
      const config = parseConfig();
      expect(config.sslPreference.explicit).toBe('false');
    });

    it('returns null explicit for unset DATABASE_SSL', () => {
      const config = parseConfig();
      expect(config.sslPreference.explicit).toBeNull();
    });

    it('parses DATABASE_SSL_REJECT_UNAUTHORIZED', () => {
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
      const config = parseConfig();
      expect(config.sslPreference.rejectUnauthorized).toBe(false);
    });
  });

  describe('SSH configuration', () => {
    beforeEach(() => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost:5432/testdb';
    });

    it('returns undefined ssh when SSH_ENABLED not true', () => {
      const config = parseConfig();
      expect(config.ssh).toBeUndefined();
    });

    it('parses SSH config when enabled with password', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'sshpass';
      const config = parseConfig();
      expect(config.ssh).toBeDefined();
      expect(config.ssh!.host).toBe('bastion.example.com');
      expect(config.ssh!.port).toBe(22);
      expect(config.ssh!.username).toBe('ubuntu');
      expect(config.ssh!.password).toBe('sshpass');
      expect(config.ssh!.trustOnFirstUse).toBe(true);
    });

    it('parses SSH config with private key', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PRIVATE_KEY_PATH = '/path/to/key';
      const config = parseConfig();
      expect(config.ssh!.privateKeyPath).toBe('/path/to/key');
    });

    it('throws when SSH enabled but no auth method', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      expect(() => parseConfig()).toThrow(/no authentication method/);
    });

    it('throws for invalid SSH_PORT', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_PORT = '99999';
      expect(() => parseConfig()).toThrow(/SSH_PORT must be a number between 1 and 65535/);
    });

    it('throws for SSH_KEEPALIVE_INTERVAL=0', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_KEEPALIVE_INTERVAL = '0';
      expect(() => parseConfig()).toThrow(/SSH_KEEPALIVE_INTERVAL must be a positive number/);
    });

    it('throws for negative SSH_KEEPALIVE_INTERVAL', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_KEEPALIVE_INTERVAL = '-1';
      expect(() => parseConfig()).toThrow(/SSH_KEEPALIVE_INTERVAL must be a positive number/);
    });

    it('accepts valid SSH_KEEPALIVE_INTERVAL', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_KEEPALIVE_INTERVAL = '5000';
      const config = parseConfig();
      expect(config.ssh!.keepaliveInterval).toBe(5000);
    });

    it('parses SSH_TRUST_ON_FIRST_USE=false', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_TRUST_ON_FIRST_USE = 'false';
      const config = parseConfig();
      expect(config.ssh!.trustOnFirstUse).toBe(false);
    });

    it('parses SSH_MAX_RECONNECT_ATTEMPTS', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_MAX_RECONNECT_ATTEMPTS = '-1';
      const config = parseConfig();
      expect(config.ssh!.maxReconnectAttempts).toBe(-1);
    });

    it('throws for invalid SSH_MAX_RECONNECT_ATTEMPTS', () => {
      process.env.SSH_ENABLED = 'true';
      process.env.SSH_HOST = 'bastion.example.com';
      process.env.SSH_USER = 'ubuntu';
      process.env.SSH_PASSWORD = 'pass';
      process.env.SSH_MAX_RECONNECT_ATTEMPTS = '-2';
      expect(() => parseConfig()).toThrow(/SSH_MAX_RECONNECT_ATTEMPTS/);
    });
  });

  describe('server options', () => {
    beforeEach(() => {
      process.env.DATABASE_URI = 'postgresql://user:pass@localhost:5432/testdb';
    });

    it('defaults READ_ONLY to true', () => {
      const config = parseConfig();
      expect(config.readOnly).toBe(true);
    });

    it('parses READ_ONLY=false', () => {
      process.env.READ_ONLY = 'false';
      const config = parseConfig();
      expect(config.readOnly).toBe(false);
    });

    it('defaults QUERY_TIMEOUT to 30000', () => {
      const config = parseConfig();
      expect(config.queryTimeout).toBe(30000);
    });

    it('parses custom QUERY_TIMEOUT', () => {
      process.env.QUERY_TIMEOUT = '60000';
      const config = parseConfig();
      expect(config.queryTimeout).toBe(60000);
    });

    it('defaults MAX_ROWS to 1000', () => {
      const config = parseConfig();
      expect(config.maxRows).toBe(1000);
    });

    it('parses custom MAX_ROWS', () => {
      process.env.MAX_ROWS = '5000';
      const config = parseConfig();
      expect(config.maxRows).toBe(5000);
    });

    it('throws for invalid MAX_ROWS', () => {
      process.env.MAX_ROWS = '0';
      expect(() => parseConfig()).toThrow(/MAX_ROWS must be a positive number/);
    });

    it('defaults MAX_CONCURRENT_QUERIES to 10', () => {
      const config = parseConfig();
      expect(config.maxConcurrentQueries).toBe(10);
    });

    it('parses custom MAX_CONCURRENT_QUERIES', () => {
      process.env.MAX_CONCURRENT_QUERIES = '5';
      const config = parseConfig();
      expect(config.maxConcurrentQueries).toBe(5);
    });

    it('throws for invalid MAX_CONCURRENT_QUERIES', () => {
      process.env.MAX_CONCURRENT_QUERIES = '0';
      expect(() => parseConfig()).toThrow(/MAX_CONCURRENT_QUERIES must be a positive number/);
    });

    it('defaults POOL_DRAIN_TIMEOUT_MS to 5000', () => {
      const config = parseConfig();
      expect(config.poolDrainTimeoutMs).toBe(5000);
    });

    it('parses custom POOL_DRAIN_TIMEOUT_MS', () => {
      process.env.POOL_DRAIN_TIMEOUT_MS = '10000';
      const config = parseConfig();
      expect(config.poolDrainTimeoutMs).toBe(10000);
    });

    it('throws for invalid POOL_DRAIN_TIMEOUT_MS', () => {
      process.env.POOL_DRAIN_TIMEOUT_MS = '0';
      expect(() => parseConfig()).toThrow(/POOL_DRAIN_TIMEOUT_MS must be a positive number/);
    });
  });
});

describe('parseHttpConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.MCP_HOST;
    delete process.env.MCP_AUTH_MODE;
    delete process.env.AUTH0_DOMAIN;
    delete process.env.AUTH0_AUDIENCE;
    delete process.env.MCP_SESSION_TTL_MINUTES;
    delete process.env.MCP_STATELESS;
    delete process.env.MCP_SERVER_POOL_SIZE;
    delete process.env.MCP_SESSION_CLEANUP_INTERVAL_MS;
    delete process.env.MCP_ALLOWED_ORIGINS;
    delete process.env.MCP_ALLOWED_HOSTS;
    delete process.env.MCP_RESOURCE_DOCUMENTATION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('port and host', () => {
    it('defaults PORT to 3000', () => {
      const config = parseHttpConfig();
      expect(config.port).toBe(3000);
    });

    it('parses custom PORT', () => {
      process.env.PORT = '8080';
      const config = parseHttpConfig();
      expect(config.port).toBe(8080);
    });

    it('throws for invalid PORT', () => {
      process.env.PORT = '99999';
      expect(() => parseHttpConfig()).toThrow(/PORT must be a number between 1 and 65535/);
    });

    it('throws for non-numeric PORT', () => {
      process.env.PORT = 'abc';
      expect(() => parseHttpConfig()).toThrow(/PORT must be a number between 1 and 65535/);
    });

    it('defaults MCP_HOST to 0.0.0.0', () => {
      const config = parseHttpConfig();
      expect(config.host).toBe('0.0.0.0');
    });

    it('parses custom MCP_HOST', () => {
      process.env.MCP_HOST = '127.0.0.1';
      const config = parseHttpConfig();
      expect(config.host).toBe('127.0.0.1');
    });
  });

  describe('auth mode', () => {
    it('defaults MCP_AUTH_MODE to none', () => {
      const config = parseHttpConfig();
      expect(config.authMode).toBe('none');
    });

    it('parses MCP_AUTH_MODE=oauth', () => {
      process.env.MCP_AUTH_MODE = 'oauth';
      process.env.AUTH0_DOMAIN = 'test.auth0.com';
      process.env.AUTH0_AUDIENCE = 'https://api.example.com';
      const config = parseHttpConfig();
      expect(config.authMode).toBe('oauth');
    });

    it('throws for invalid MCP_AUTH_MODE', () => {
      process.env.MCP_AUTH_MODE = 'invalid';
      expect(() => parseHttpConfig()).toThrow(/MCP_AUTH_MODE must be "none" or "oauth"/);
    });

    it('throws when oauth mode but AUTH0_DOMAIN missing', () => {
      process.env.MCP_AUTH_MODE = 'oauth';
      process.env.AUTH0_AUDIENCE = 'https://api.example.com';
      expect(() => parseHttpConfig()).toThrow(/AUTH0_DOMAIN is required when MCP_AUTH_MODE=oauth/);
    });

    it('throws when oauth mode but AUTH0_AUDIENCE missing', () => {
      process.env.MCP_AUTH_MODE = 'oauth';
      process.env.AUTH0_DOMAIN = 'test.auth0.com';
      expect(() => parseHttpConfig()).toThrow(/AUTH0_AUDIENCE is required when MCP_AUTH_MODE=oauth/);
    });

    it('parses AUTH0_DOMAIN and AUTH0_AUDIENCE in oauth mode', () => {
      process.env.MCP_AUTH_MODE = 'oauth';
      process.env.AUTH0_DOMAIN = 'mytenant.us.auth0.com';
      process.env.AUTH0_AUDIENCE = 'https://myapi.example.com/mcp';
      const config = parseHttpConfig();
      expect(config.auth0Domain).toBe('mytenant.us.auth0.com');
      expect(config.auth0Audience).toBe('https://myapi.example.com/mcp');
    });
  });

  describe('stateless mode', () => {
    it('defaults MCP_STATELESS to true', () => {
      const config = parseHttpConfig();
      expect(config.stateless).toBe(true);
    });

    it('parses MCP_STATELESS=false', () => {
      process.env.MCP_STATELESS = 'false';
      const config = parseHttpConfig();
      expect(config.stateless).toBe(false);
    });

    it('parses MCP_STATELESS=true', () => {
      process.env.MCP_STATELESS = 'true';
      const config = parseHttpConfig();
      expect(config.stateless).toBe(true);
    });
  });

  describe('server pool size', () => {
    it('defaults MCP_SERVER_POOL_SIZE to 4', () => {
      const config = parseHttpConfig();
      expect(config.serverPoolSize).toBe(4);
    });

    it('parses custom MCP_SERVER_POOL_SIZE', () => {
      process.env.MCP_SERVER_POOL_SIZE = '8';
      const config = parseHttpConfig();
      expect(config.serverPoolSize).toBe(8);
    });

    it('throws for invalid MCP_SERVER_POOL_SIZE', () => {
      process.env.MCP_SERVER_POOL_SIZE = '0';
      expect(() => parseHttpConfig()).toThrow(/MCP_SERVER_POOL_SIZE must be a positive number/);
    });
  });

  describe('session cleanup interval', () => {
    it('defaults MCP_SESSION_CLEANUP_INTERVAL_MS to 300000', () => {
      const config = parseHttpConfig();
      expect(config.sessionCleanupIntervalMs).toBe(300000);
    });

    it('parses custom MCP_SESSION_CLEANUP_INTERVAL_MS', () => {
      process.env.MCP_SESSION_CLEANUP_INTERVAL_MS = '120000';
      const config = parseHttpConfig();
      expect(config.sessionCleanupIntervalMs).toBe(120000);
    });

    it('throws for invalid MCP_SESSION_CLEANUP_INTERVAL_MS', () => {
      process.env.MCP_SESSION_CLEANUP_INTERVAL_MS = '0';
      expect(() => parseHttpConfig()).toThrow(/MCP_SESSION_CLEANUP_INTERVAL_MS must be a positive number/);
    });
  });

  describe('session TTL', () => {
    it('defaults MCP_SESSION_TTL_MINUTES to 30', () => {
      process.env.MCP_STATELESS = 'false';
      const config = parseHttpConfig();
      expect(config.sessionTtlMinutes).toBe(30);
    });

    it('parses custom MCP_SESSION_TTL_MINUTES', () => {
      process.env.MCP_STATELESS = 'false';
      process.env.MCP_SESSION_TTL_MINUTES = '60';
      const config = parseHttpConfig();
      expect(config.sessionTtlMinutes).toBe(60);
    });

    it('throws for invalid MCP_SESSION_TTL_MINUTES', () => {
      process.env.MCP_STATELESS = 'false';
      process.env.MCP_SESSION_TTL_MINUTES = '0';
      expect(() => parseHttpConfig()).toThrow(/MCP_SESSION_TTL_MINUTES must be a positive number/);
    });

    it('throws for negative MCP_SESSION_TTL_MINUTES', () => {
      process.env.MCP_STATELESS = 'false';
      process.env.MCP_SESSION_TTL_MINUTES = '-5';
      expect(() => parseHttpConfig()).toThrow(/MCP_SESSION_TTL_MINUTES must be a positive number/);
    });

    it('ignores invalid MCP_SESSION_TTL_MINUTES when stateless', () => {
      process.env.MCP_STATELESS = 'true';
      process.env.MCP_SESSION_TTL_MINUTES = '0';
      const config = parseHttpConfig();
      expect(config.sessionTtlMinutes).toBe(30);
    });
  });

  describe('origin and host allowlists', () => {
    it('defaults allowedOrigins to undefined (allow all)', () => {
      const config = parseHttpConfig();
      expect(config.allowedOrigins).toBeUndefined();
    });

    it('parses MCP_ALLOWED_ORIGINS with trimming and normalization', () => {
      process.env.MCP_ALLOWED_ORIGINS =
        'https://example.com, https://ChatGPT.com/ ,http://localhost:3000';
      const config = parseHttpConfig();
      expect(config.allowedOrigins).toEqual([
        'https://example.com',
        'https://chatgpt.com',
        'http://localhost:3000',
      ]);
    });

    it('treats MCP_ALLOWED_ORIGINS=* as allow all', () => {
      process.env.MCP_ALLOWED_ORIGINS = '*';
      const config = parseHttpConfig();
      expect(config.allowedOrigins).toBeUndefined();
    });

    it('parses MCP_ALLOWED_HOSTS into a unique allowlist', () => {
      process.env.MCP_ALLOWED_HOSTS = 'api.example.com:3000, API.EXAMPLE.com:3000, localhost:3000';
      const config = parseHttpConfig();
      expect(config.allowedHosts).toEqual([
        'api.example.com:3000',
        'localhost:3000',
      ]);
    });

    it('throws for invalid MCP_ALLOWED_HOSTS entries', () => {
      process.env.MCP_ALLOWED_HOSTS = 'http://';
      expect(() => parseHttpConfig()).toThrow(/MCP_ALLOWED_HOSTS contains invalid host/);
    });
  });

  describe('resource documentation', () => {
    it('parses MCP_RESOURCE_DOCUMENTATION', () => {
      process.env.MCP_RESOURCE_DOCUMENTATION = 'https://docs.example.com/mcp';
      const config = parseHttpConfig();
      expect(config.resourceDocumentation).toBe('https://docs.example.com/mcp');
    });

    it('throws for invalid MCP_RESOURCE_DOCUMENTATION', () => {
      process.env.MCP_RESOURCE_DOCUMENTATION = 'not-a-url';
      expect(() => parseHttpConfig()).toThrow(/MCP_RESOURCE_DOCUMENTATION must be a valid URL/);
    });
  });
});
