import { describe, it, expect } from 'vitest';
import { obfuscateConnectionString } from '../../src/lib/obfuscate.js';

describe('obfuscateConnectionString', () => {
  describe('URI password obfuscation', () => {
    it('obfuscates password in postgresql URI', () => {
      const result = obfuscateConnectionString('postgresql://user:secretpass@localhost:5432/db');
      expect(result).toBe('postgresql://user:****@localhost:5432/db');
      expect(result).not.toContain('secretpass');
    });

    it('obfuscates password with special characters', () => {
      const result = obfuscateConnectionString('postgresql://user:p@ss!word@localhost/db');
      expect(result).not.toContain('p@ss!word');
      expect(result).toContain(':****@');
    });

    it('handles URI without password', () => {
      const result = obfuscateConnectionString('postgresql://localhost:5432/db');
      expect(result).toBe('postgresql://localhost:5432/db');
    });
  });

  describe('parameter password obfuscation', () => {
    it('obfuscates password= parameter', () => {
      const result = obfuscateConnectionString('host=localhost password=secret dbname=test');
      expect(result).toContain('password=****');
      expect(result).not.toContain('secret');
    });

    it('obfuscates password: format', () => {
      const result = obfuscateConnectionString('password: mysecret');
      expect(result).toBe('password=****');
    });

    it('is case insensitive', () => {
      expect(obfuscateConnectionString('PASSWORD=secret')).toContain('password=****');
      expect(obfuscateConnectionString('Password=secret')).toContain('password=****');
    });
  });

  describe('SSH key obfuscation', () => {
    it('obfuscates privateKey parameter', () => {
      const result = obfuscateConnectionString('privateKey=/path/to/key');
      expect(result).toBe('privateKey=****');
    });

    it('obfuscates privatekey (lowercase)', () => {
      const result = obfuscateConnectionString('privatekey=/home/user/.ssh/id_rsa');
      expect(result).toBe('privateKey=****');
    });
  });

  describe('passphrase obfuscation', () => {
    it('obfuscates passphrase parameter', () => {
      const result = obfuscateConnectionString('passphrase=mysecretphrase');
      expect(result).toBe('passphrase=****');
    });
  });

  describe('token and API key obfuscation', () => {
    it('obfuscates secret parameter', () => {
      const result = obfuscateConnectionString('secret=abc123');
      expect(result).toBe('secret=****');
    });

    it('obfuscates token parameter', () => {
      const result = obfuscateConnectionString('token=xyz789');
      expect(result).toBe('token=****');
    });

    it('obfuscates apiKey parameter', () => {
      const result = obfuscateConnectionString('apiKey=key123');
      expect(result).toBe('apiKey=****');
    });

    it('obfuscates api-key parameter', () => {
      const result = obfuscateConnectionString('api-key=key123');
      expect(result).toBe('apiKey=****');
    });

    it('obfuscates authorization header', () => {
      const result = obfuscateConnectionString('authorization=Bearer');
      expect(result).toBe('authorization=****');
    });
  });

  describe('multiple sensitive values', () => {
    it('obfuscates URI password and parameter password', () => {
      const input = 'postgresql://user:secret@host/db password=another';
      const result = obfuscateConnectionString(input);
      expect(result).not.toContain('secret');
      expect(result).not.toContain('another');
      expect(result).toContain(':****@');
      expect(result).toContain('password=****');
    });

    it('obfuscates token parameter', () => {
      const input = 'token=abc123';
      const result = obfuscateConnectionString(input);
      expect(result).not.toContain('abc123');
      expect(result).toContain('token=****');
    });
  });

  describe('non-sensitive content', () => {
    it('preserves non-sensitive content', () => {
      const result = obfuscateConnectionString('host=localhost port=5432 dbname=mydb');
      expect(result).toBe('host=localhost port=5432 dbname=mydb');
    });
  });
});
