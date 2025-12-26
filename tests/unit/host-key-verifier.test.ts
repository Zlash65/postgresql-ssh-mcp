import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { HostKeyVerifier } from '../../src/connection/host-key-verifier.js';

function writeTempKnownHosts(contents: string): { filePath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-hosts-'));
  const filePath = path.join(dir, 'known_hosts');
  fs.writeFileSync(filePath, contents, 'utf8');
  return { filePath, dir };
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
  let tempDir: string;
  const keyType = 'ssh-ed25519';
  const keyBuffer = Buffer.from('test-host-key');
  const publicKey = keyBuffer.toString('base64');

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies plain hostname match', () => {
    const tmp = writeTempKnownHosts(`example.com ${keyType} ${publicKey}`);
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('verifies host with non-default port', () => {
    const tmp = writeTempKnownHosts(`[example.com]:2222 ${keyType} ${publicKey}`);
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('example.com', 2222, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('verifies hashed hostname entry', () => {
    const hashedEntry = makeHashedHostEntry('hashed.example.com', keyType, publicKey);
    const tmp = writeTempKnownHosts(hashedEntry);
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('hashed.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });

  it('accepts and saves unknown host by default (trust on first use)', () => {
    const tmp = writeTempKnownHosts('');
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('unknown.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);

    const updated = fs.readFileSync(tempPath, 'utf8');
    expect(updated).toMatch(/unknown\.example\.com/);
    expect(updated).toMatch(new RegExp(`${keyType}\\s+${publicKey}`));
  });

  it('rejects unknown host when trust on first use is disabled', () => {
    const tmp = writeTempKnownHosts('');
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath, false);
    const result = verifier.verifyHostKey('unknown.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/UNKNOWN HOST/);
  });

  it('fails trust on first use when known_hosts is not writable', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-hosts-'));
    tempPath = tempDir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('unknown.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/FAILED TO SAVE HOST KEY/);
  });

  it('rejects host key mismatch', () => {
    const tmp = writeTempKnownHosts(`example.com ${keyType} ${publicKey}`);
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
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
    const tmp = writeTempKnownHosts(content);
    tempPath = tmp.filePath;
    tempDir = tmp.dir;
    const verifier = new HostKeyVerifier(tempPath);
    const result = verifier.verifyHostKey('valid.example.com', 22, keyType, keyBuffer);
    expect(result.verified).toBe(true);
  });
});
