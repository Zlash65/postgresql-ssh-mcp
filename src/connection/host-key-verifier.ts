import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { KnownHost, HostKeyVerificationResult } from '../types.js';

export class HostKeyVerifier {
  private knownHosts: Map<string, KnownHost[]> = new Map();
  private knownHostsPath: string;

  constructor(knownHostsPath?: string) {
    this.knownHostsPath =
      knownHostsPath || path.join(os.homedir(), '.ssh', 'known_hosts');
    this.loadKnownHosts();
  }

  private loadKnownHosts(): void {
    try {
      if (!fs.existsSync(this.knownHostsPath)) {
        console.error(
          `[SSH] Warning: known_hosts file not found at ${this.knownHostsPath}`
        );
        return;
      }

      const content = fs.readFileSync(this.knownHostsPath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (trimmed.startsWith('@')) {
          console.error(`[SSH] Skipping known_hosts marker line: ${trimmed.slice(0, 50)}...`);
          continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 3) continue;

        const [hostnames, keyType, publicKey] = parts;

        const hosts = hostnames.split(',');
        for (const host of hosts) {
          const normalizedHost = this.normalizeHostname(host);

          if (!this.knownHosts.has(normalizedHost)) {
            this.knownHosts.set(normalizedHost, []);
          }

          this.knownHosts.get(normalizedHost)!.push({
            hostname: normalizedHost,
            keyType,
            publicKey,
          });
        }
      }

      console.error(
        `[SSH] Loaded ${this.knownHosts.size} known hosts from ${this.knownHostsPath}`
      );
    } catch (error) {
      console.error(`[SSH] Error loading known_hosts: ${error}`);
    }
  }

  private normalizeHostname(hostname: string): string {
    const match = hostname.match(/^\[([^\]]+)\]:(\d+)$/);
    if (match) {
      const port = parseInt(match[2], 10);
      if (port === 22) return match[1];
      return hostname;
    }
    return hostname;
  }

  private hashHostname(hostname: string, salt: Buffer): string {
    const hmac = crypto.createHmac('sha1', salt);
    hmac.update(hostname);
    return hmac.digest('base64');
  }

  private hostnameMatches(entry: string, hostname: string): boolean {
    if (!entry.startsWith('|1|')) {
      return entry === hostname;
    }

    const parts = entry.split('|');
    if (parts.length !== 4) return false;

    const salt = Buffer.from(parts[2], 'base64');
    const storedHash = parts[3];
    const computedHash = this.hashHostname(hostname, salt);

    return computedHash === storedHash;
  }

  private findKnownKeys(hostname: string): KnownHost[] {
    const results: KnownHost[] = [];

    for (const [entryHostname, keys] of this.knownHosts.entries()) {
      if (this.hostnameMatches(entryHostname, hostname)) {
        results.push(...keys);
      }
    }

    return results;
  }

  verifyHostKey(
    hostname: string,
    port: number,
    keyType: string,
    publicKey: Buffer
  ): HostKeyVerificationResult {
    const lookupKeys =
      port === 22 ? [hostname] : [`[${hostname}]:${port}`, hostname];

    let knownKeys: KnownHost[] = [];
    for (const lookupKey of lookupKeys) {
      knownKeys = this.findKnownKeys(lookupKey);
      if (knownKeys.length > 0) break;
    }

    if (knownKeys.length === 0) {
      const displayHost = port === 22 ? hostname : `[${hostname}]:${port}`;
      return {
        verified: false,
        reason:
          `UNKNOWN HOST: '${displayHost}' not found in known_hosts.\n` +
          `To add it, run: ssh-keyscan -H ${hostname} >> ~/.ssh/known_hosts\n` +
          `Then restart the MCP server.`,
      };
    }

    const serverKeyBase64 = publicKey.toString('base64');

    for (const known of knownKeys) {
      if (known.keyType === keyType && known.publicKey === serverKeyBase64) {
        return {
          verified: true,
          reason: 'Host key verified against known_hosts',
        };
      }
    }

    const displayHost = port === 22 ? hostname : `[${hostname}]:${port}`;
    return {
      verified: false,
      reason:
        `HOST KEY MISMATCH for '${displayHost}'!\n` +
        `Server presented: ${keyType}\n` +
        `This could indicate a man-in-the-middle attack.\n` +
        `If the server was legitimately re-keyed, remove the old entry:\n` +
        `  ssh-keygen -R ${hostname}\n` +
        `Then add the new key:\n` +
        `  ssh-keyscan -H ${hostname} >> ~/.ssh/known_hosts`,
    };
  }
}
