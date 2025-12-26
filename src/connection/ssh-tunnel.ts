import { Client, ConnectConfig } from 'ssh2';
import * as net from 'net';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { HostKeyVerifier } from './host-key-verifier.js';
import { obfuscateConnectionString } from '../lib/obfuscate.js';
import type {
  SSHTunnelConfig,
  TunnelTarget,
  TunnelStatus,
  TunnelState,
} from '../types.js';

export class SSHTunnelManager extends EventEmitter {
  private client: Client | null = null;
  private server: net.Server | null = null;
  private localPort: number = 0;
  private status: TunnelStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private startTime: number = 0;
  private lastError?: string;
  private hostKeyVerifier: HostKeyVerifier | null = null;
  private hostKeyVerified: boolean = false;
  private hostKeyError: string | null = null;
  private activeConnections: Set<net.Socket> = new Set();
  private isShuttingDown = false;

  constructor(
    private config: SSHTunnelConfig,
    private target: TunnelTarget
  ) {
    super();
    this.maxReconnectAttempts = config.maxReconnectAttempts;

    if (config.strictHostKey !== false) {
      this.hostKeyVerifier = new HostKeyVerifier(
        config.knownHostsPath,
        config.trustOnFirstUse
      );
    } else {
      console.error(
        '[SSH] WARNING: Host key verification DISABLED (strictHostKey=false)'
      );
      console.error('[SSH] This is INSECURE - only use for development/testing');
    }
  }

  async connect(): Promise<number> {
    if (this.status === 'connected') {
      return this.localPort;
    }

    this.isShuttingDown = false;
    this.setStatus('connecting');

    let privateKey: Buffer | undefined;
    if (this.config.privateKeyPath) {
      const keyPath = this.expandKeyPath(this.config.privateKeyPath);
      await this.validateKeyPermissions(keyPath);
      privateKey = await fs.promises.readFile(keyPath);
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();
      this.hostKeyVerified = false;
      this.hostKeyError = null;

      const connectConfig = this.buildConnectConfig(privateKey);

      if (this.hostKeyVerifier) {
        connectConfig.hostVerifier = (key: Buffer) => {
          const parsed = this.parseHostKey(key);
          if (!parsed) {
            this.hostKeyError = 'Failed to parse server host key';
            return false;
          }

          const result = this.hostKeyVerifier!.verifyHostKey(
            this.config.host,
            this.config.port,
            parsed.keyType,
            parsed.keyData
          );

          if (!result.verified) {
            this.hostKeyError = result.reason;
            console.error(`[SSH] HOST KEY VERIFICATION FAILED: ${result.reason}`);
            return false;
          }

          this.hostKeyVerified = true;
          console.error('[SSH] Host key verified successfully');
          return true;
        };
      }

      this.client.on('ready', () => {
        if (this.hostKeyVerifier && !this.hostKeyVerified) {
          console.error('[SSH] BUG: Reached ready without host key verification');
          this.client?.end();
          reject(new Error('Internal error: host key not verified'));
          return;
        }

        console.error(
          `[SSH] Connected to ${this.config.host}:${this.config.port}`
        );
        this.startTime = Date.now();
        this.setupLocalServer(resolve, reject);
      });

      this.client.on('error', (err) => {
        const message = this.hostKeyError || err.message;
        const safeMessage = obfuscateConnectionString(message);
        console.error('[SSH] Connection error:', safeMessage);
        this.lastError = safeMessage;

        if (this.status === 'connecting') {
          this.setStatus('failed');
          reject(new Error(`SSH connection failed: ${safeMessage}`));
        } else {
          this.handleDisconnect();
        }
      });

      this.client.on('close', () => {
        console.error('[SSH] Connection closed');
        this.handleDisconnect();
      });

      this.client.on('end', () => {
        console.error('[SSH] Connection ended');
        this.handleDisconnect();
      });

      try {
        this.client.connect(connectConfig);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const safeMessage = obfuscateConnectionString(message);
        this.lastError = safeMessage;
        this.setStatus('failed');
        reject(new Error(`SSH connection failed: ${safeMessage}`));
      }
    });
  }

  private parseHostKey(
    key: Buffer
  ): { keyType: string; keyData: Buffer } | null {
    try {
      let offset = 0;

      const typeLen = key.readUInt32BE(offset);
      offset += 4;

      const keyType = key.subarray(offset, offset + typeLen).toString('utf8');

      return { keyType, keyData: key };
    } catch {
      return null;
    }
  }

  private async validateKeyPermissions(keyPath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(keyPath);
      const mode = stats.mode & 0o777;

      if (mode & 0o077) {
        throw new Error(
          `SSH key file has insecure permissions (${mode.toString(8)}). ` +
            `Required: 600 or 400. Fix with: chmod 600 ${keyPath}`
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        throw new Error(`SSH key file not found: ${keyPath}`);
      }
      throw err;
    }
  }

  private setupLocalServer(
    resolve: (port: number) => void,
    reject: (err: Error) => void
  ): void {
    this.server = net.createServer((socket) => {
      this.handleIncomingConnection(socket);
    });

    this.server.on('error', (err) => {
      console.error('[SSH] Local server error:', err.message);
      reject(err);
    });

    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server!.address() as net.AddressInfo;
      this.localPort = addr.port;
      this.reconnectAttempts = 0;
      this.setStatus('connected');

      console.error(
        `[SSH] Tunnel established: localhost:${this.localPort} -> ` +
          `${this.target.host}:${this.target.port}`
      );

      resolve(this.localPort);
    });
  }

  private handleIncomingConnection(socket: net.Socket): void {
    if (!this.client) {
      socket.end();
      return;
    }

    this.activeConnections.add(socket);

    this.client.forwardOut(
      '127.0.0.1',
      socket.localPort || 0,
      this.target.host,
      this.target.port,
      (err, stream) => {
        if (err) {
          console.error(
            '[SSH] Forward error:',
            obfuscateConnectionString(err.message)
          );
          socket.end();
          this.activeConnections.delete(socket);
          return;
        }

        socket.pipe(stream).pipe(socket);

        stream.on('close', () => {
          socket.end();
          this.activeConnections.delete(socket);
        });

        socket.on('close', () => {
          stream.end();
          this.activeConnections.delete(socket);
        });

        stream.on('error', (streamErr: Error) => {
          console.error('[SSH] Stream error:', streamErr.message);
          socket.end();
          this.activeConnections.delete(socket);
        });

        socket.on('error', (socketErr: Error) => {
          console.error('[SSH] Socket error:', socketErr.message);
          stream.end();
          this.activeConnections.delete(socket);
        });
      }
    );
  }

  private buildConnectConfig(privateKey?: Buffer): ConnectConfig {
    const config: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      keepaliveInterval: this.config.keepaliveInterval || 10000,
      keepaliveCountMax: 3,
      readyTimeout: 20000,
    };

    if (this.config.privateKeyPath) {
      if (!privateKey) {
        throw new Error('SSH private key missing');
      }
      config.privateKey = privateKey;

      if (this.config.privateKeyPassphrase) {
        config.passphrase = this.config.privateKeyPassphrase;
      }
    } else if (this.config.password) {
      config.password = this.config.password;
    }

    return config;
  }

  private expandKeyPath(keyPath: string): string {
    return keyPath.replace(/^~/, process.env.HOME || '');
  }

  private handleDisconnect(): void {
    if (
      this.status === 'disconnected' ||
      this.status === 'failed' ||
      this.isShuttingDown
    ) {
      return;
    }

    const oldPort = this.localPort;

    for (const socket of this.activeConnections) {
      socket.destroy();
    }
    this.activeConnections.clear();

    this.setStatus('disconnected');
    this.emit('disconnecting', { oldPort });
    this.scheduleReconnect();
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    if (
      this.maxReconnectAttempts >= 0 &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      console.error('[SSH] Max reconnection attempts reached. Giving up.');
      this.setStatus('failed');
      this.emit('failed', new Error('Max reconnection attempts reached'));
      return;
    }

    const backoff = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;
    const maxAttemptsLabel =
      this.maxReconnectAttempts >= 0
        ? this.maxReconnectAttempts.toString()
        : 'unlimited';

    this.setStatus('reconnecting');
    console.error(
      `[SSH] Reconnecting in ${backoff}ms ` +
        `(attempt ${this.reconnectAttempts}/${maxAttemptsLabel})`
    );

    await new Promise((r) => setTimeout(r, backoff));

    if (this.isShuttingDown) {
      return;
    }

    await this.cleanup();

    try {
      const oldPort = this.localPort;
      const newPort = await this.connect();
      this.emit('reconnected', { oldPort, newPort });
    } catch {
      console.error('[SSH] Reconnection failed');
    }
  }

  private async cleanup(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    if (this.client) {
      this.client.end();
      this.client = null;
    }

    this.localPort = 0;
    this.startTime = 0;
  }

  private setStatus(status: TunnelStatus): void {
    this.status = status;
    this.emit('statusChange', this.getState());
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  getState(): TunnelState {
    return {
      status: this.status,
      localPort: this.localPort || null,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  async close(): Promise<void> {
    this.isShuttingDown = true;

    for (const socket of this.activeConnections) {
      socket.destroy();
    }
    this.activeConnections.clear();

    await this.cleanup();
    this.setStatus('disconnected');
  }
}
