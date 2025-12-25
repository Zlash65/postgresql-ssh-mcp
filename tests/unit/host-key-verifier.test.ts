/**
 * Host Key Verifier Tests
 * Tests known_hosts parsing and verification behavior
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { HostKeyVerifier } from '../../src/connection/host-key-verifier.js';

function writeTempKnownHosts(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-hosts-'));
  const filePath = path.join(dir, 'known_hosts');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function makeHashedHostEntry(
  hostname: string,
  keyType: string,
  publicKey: string
): string {
  const salt = crypto.randomBytes(20);
  const hmac = crypto.createHmac('sha1', salt);
  hmac.update(hostname);
  const hash = hmac.digest('base64');
  const saltB64 = salt.toString('base64');
  return `|1|${saltB64}|${hash} ${keyType} ${publicKey}`;
}

describe('HostKeyVerifier', () => {
  let tempPath: string;
  const keyType = 'ssh-ed25519';
  const keyBuffer = Buffer.from('test-host-key');
  const publicKey = keyBuffer.toString('base64');

  afterEach(() => {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.rmSync(path.dirname(tempPath), { recursive: true, force: true });
    }
  });

  it('verifies plain hostname match', () => {
    tempPath = writeTempKnownHosts(`example.com ${keyType} ${publicKey}`);
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('verifies host with non-default port', () => {
    tempPath = writeTempKnownHosts(`[example.com]:2222 ${keyType} ${publicKey}`);
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('example.com', 2222, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('verifies hashed hostname entry', () => {
    const hashedEntry = makeHashedHostEntry('hashed.example.com', keyType, publicKey);
    tempPath = writeTempKnownHosts(hashedEntry);
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('hashed.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('rejects unknown host', () => {
    tempPath = writeTempKnownHosts(`known.example.com ${keyType} ${publicKey}`);
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('unknown.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/UNKNOWN HOST/);
  });

  it('rejects host key mismatch', () => {
    tempPath = writeTempKnownHosts(`example.com ${keyType} ${publicKey}`);
    const verifier = new HostKeyVerifier(tempPath);
    const otherKey = Buffer.from('different-key');
    const result = verifier.verifyHostKey('example.com', 22, keyType, otherKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/HOST KEY MISMATCH/);
  });

  it('ignores marker lines and still parses valid entries', () => {
    const content = [
      '@cert-authority *.example.com ssh-ed25519 AAAA',
      'valid.example.com ssh-ed25519 ' + publicKey,
    ].join('\n');
    tempPath = writeTempKnownHosts(content);
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('valid.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });
});
