/**
 * Configuration Tests
 * Tests for environment variable parsing and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all relevant env vars
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
    delete process.env.READ_ONLY;
    delete process.env.QUERY_TIMEOUT;
    delete process.env.MAX_ROWS;
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
  });
});
