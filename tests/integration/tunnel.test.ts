import { describe, it, expect, afterAll } from 'vitest';
import { parse as parseConnectionString } from 'pg-connection-string';
import { SSHTunnelManager } from '../../src/connection/ssh-tunnel.js';
import type { SSHTunnelConfig, TunnelTarget } from '../../src/types.js';

const EXAMPLE_DATABASE_URI = 'postgresql://postgres:postgres@db.example.com:5432/postgres';
const databaseUrl = process.env.DATABASE_URI;
const hasDatabaseUrl = !!databaseUrl && databaseUrl !== EXAMPLE_DATABASE_URI;
const hasDatabaseEnv =
  !!process.env.DATABASE_HOST &&
  !!process.env.DATABASE_NAME &&
  !!process.env.DATABASE_USER &&
  !!process.env.DATABASE_PASSWORD;

const targetFromUri =
  hasDatabaseUrl && databaseUrl ? parseConnectionString(databaseUrl) : null;

const targetHost = targetFromUri?.host ?? process.env.DATABASE_HOST;
const targetPort = targetFromUri?.port
  ? parseInt(targetFromUri.port, 10)
  : parseInt(process.env.DATABASE_PORT || '5432', 10);

const hasTarget = !!targetHost && !Number.isNaN(targetPort);
const hasSshEnv =
  process.env.SSH_ENABLED === 'true' &&
  (hasDatabaseUrl || hasDatabaseEnv) &&
  hasTarget &&
  !!process.env.SSH_HOST &&
  !!process.env.SSH_USER &&
  (!!process.env.SSH_PRIVATE_KEY_PATH || !!process.env.SSH_PASSWORD);

const describeIf = hasSshEnv ? describe : describe.skip;

describeIf('SSHTunnelManager integration', () => {
  let tunnel: SSHTunnelManager | null = null;

  afterAll(async () => {
    if (tunnel) {
      await tunnel.close();
    }
  });

  it('establishes tunnel and reports connected state', async () => {
    const config: SSHTunnelConfig = {
      host: process.env.SSH_HOST!,
      port: parseInt(process.env.SSH_PORT || '22', 10),
      username: process.env.SSH_USER!,
      privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH,
      privateKeyPassphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE,
      password: process.env.SSH_PASSWORD,
      strictHostKey: process.env.SSH_STRICT_HOST_KEY !== 'false',
      knownHostsPath: process.env.SSH_KNOWN_HOSTS_PATH,
      keepaliveInterval: parseInt(process.env.SSH_KEEPALIVE_INTERVAL || '10000', 10),
    };

    const target: TunnelTarget = {
      host: targetHost!,
      port: targetPort,
    };

    tunnel = new SSHTunnelManager(config, target);
    const localPort = await tunnel.connect();
    expect(localPort).toBeGreaterThan(0);
    expect(tunnel.isConnected()).toBe(true);

    const state = tunnel.getState();
    expect(state.status).toBe('connected');
    expect(state.localPort).toBe(localPort);
  });
});
