import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import { SSHTunnelManager } from './ssh-tunnel.js';
import {
  validateReadOnlyStatement,
  stripLeadingComments,
  cteContainsDML,
  extractFinalStatementAfterCTEs,
  getFirstKeyword,
} from '../lib/sql-validator.js';
import { obfuscateConnectionString } from '../lib/obfuscate.js';
import type {
  ParsedConfig,
  SSLPreference,
  ConnectionStatus,
  QueryResultWithMeta,
  TunnelTarget,
} from '../types.js';

export class ConnectionManager {
  private pool: Pool | null = null;
  private tunnelManager: SSHTunnelManager | null = null;
  private config: ParsedConfig;
  private isInitialized = false;
  private isReconnecting = false;
  private currentLocalPort: number | null = null;
  private sslEnabled = false;

  constructor(config: ParsedConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.config.ssh) {
      const target: TunnelTarget = {
        host: this.config.database.host,
        port: this.config.database.port,
      };

      this.tunnelManager = new SSHTunnelManager(this.config.ssh, target);

      this.tunnelManager.on('disconnecting', () => {
        console.error('[DB] Tunnel disconnecting, queries may fail...');
        this.isReconnecting = true;
      });

      this.tunnelManager.on(
        'reconnected',
        async (info: { oldPort: number; newPort: number }) => {
          console.error(
            `[DB] Tunnel reconnected: ${info.oldPort} -> ${info.newPort}`
          );
          await this.recreatePool(info.newPort);
          this.isReconnecting = false;
        }
      );

      this.tunnelManager.on('failed', (err: Error) => {
        console.error(`[DB] Tunnel failed permanently: ${err.message}`);
        this.isInitialized = false;
        this.isReconnecting = false;
      });

      this.currentLocalPort = await this.tunnelManager.connect();
    }

    await this.createPool();
    this.isInitialized = true;

    console.error('[DB] Connection manager initialized');
  }

  private resolveSSLConfig(
    preference: SSLPreference,
    originalHost: string
  ): false | { rejectUnauthorized: boolean; ca?: string } {
    if (preference.explicit === 'false') {
      console.error('[DB] SSL disabled (explicit configuration)');
      return false;
    }

    if (preference.explicit === 'true') {
      console.error('[DB] SSL enabled (explicit configuration)');
      return {
        rejectUnauthorized: preference.rejectUnauthorized,
        ca: preference.ca
          ? fs.readFileSync(preference.ca, 'utf8')
          : undefined,
      };
    }

    const isLocalhost =
      originalHost === 'localhost' ||
      originalHost === '127.0.0.1' ||
      originalHost === '::1';

    if (isLocalhost) {
      console.error('[DB] SSL disabled (localhost database)');
      return false;
    }

    console.error('[DB] SSL enabled by default (non-localhost database)');
    return {
      rejectUnauthorized: preference.rejectUnauthorized,
      ca: preference.ca ? fs.readFileSync(preference.ca, 'utf8') : undefined,
    };
  }

  private async createPool(): Promise<void> {
    const host = this.tunnelManager ? '127.0.0.1' : this.config.database.host;
    const port = this.currentLocalPort || this.config.database.port;

    const sslConfig = this.resolveSSLConfig(
      this.config.sslPreference,
      this.config.database.host
    );

    this.sslEnabled = sslConfig !== false;

    this.pool = new Pool({
      host,
      port,
      database: this.config.database.database,
      user: this.config.database.user,
      password: this.config.database.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: this.config.queryTimeout,
      ssl: sslConfig,
    });

    this.pool.on('error', (err) => {
      console.error(
        '[DB] Pool background error:',
        obfuscateConnectionString(err.message)
      );
    });

    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    console.error(`[DB] Pool created on ${host}:${port}`);
  }

  private async recreatePool(newLocalPort: number): Promise<void> {
    const oldPool = this.pool;
    this.pool = null;
    this.currentLocalPort = newLocalPort;

    if (oldPool) {
      console.error('[DB] Draining old pool...');
      try {
        await Promise.race([
          oldPool.end(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Pool drain timeout')), 5000)
          ),
        ]);
        console.error('[DB] Old pool drained');
      } catch {
        console.error('[DB] Pool drain timeout, forcing close');
        oldPool.end().catch(() => {});
      }
    }

    await this.createPool();
    console.error('[DB] Pool recreated successfully');
  }

  async executeQuery(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResultWithMeta> {
    if (!this.pool) {
      if (this.isReconnecting) {
        throw new Error('Database connection lost, reconnecting...');
      }
      throw new Error('Connection not initialized');
    }

    if (this.config.readOnly) {
      validateReadOnlyStatement(sql);
      return this.executeReadOnlyQuery(sql, params || []);
    }

    return this.executeWriteQuery(sql, params || []);
  }

  private async executeReadOnlyQuery(
    sql: string,
    params: unknown[]
  ): Promise<QueryResultWithMeta> {
    const client = await this.pool!.connect();

    try {
      await client.query('BEGIN TRANSACTION READ ONLY');

      try {
        let result: QueryResultWithMeta;

        if (this.shouldUseCursorLimiting(sql)) {
          result = await this.executeQueryWithLimit(
            client,
            sql,
            params,
            this.config.maxRows,
            true
          );
        } else {
          const pgResult = await client.query(sql, params);
          result = {
            rows: pgResult.rows,
            rowCount: pgResult.rowCount || 0,
            truncated: false,
            fields: pgResult.fields?.map((f) => ({
              name: f.name,
              dataTypeID: f.dataTypeID,
            })),
            command: pgResult.command,
          };
        }

        await client.query('ROLLBACK');

        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    } finally {
      client.release();
    }
  }

  private async executeWriteQuery(
    sql: string,
    params: unknown[]
  ): Promise<QueryResultWithMeta> {
    const client = await this.pool!.connect();

    try {
      if (this.shouldUseCursorLimiting(sql)) {
        return await this.executeQueryWithLimit(
          client,
          sql,
          params,
          this.config.maxRows,
          false
        );
      }

      const pgResult = await client.query(sql, params);

      const truncated =
        pgResult.rows && pgResult.rows.length > this.config.maxRows;
      const rows = truncated
        ? pgResult.rows.slice(0, this.config.maxRows)
        : pgResult.rows || [];

      return {
        rows,
        rowCount: pgResult.rowCount || 0,
        truncated,
        fields: pgResult.fields?.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        command: pgResult.command,
      };
    } finally {
      client.release();
    }
  }

  private async executeQueryWithLimit(
    client: PoolClient,
    sql: string,
    params: unknown[],
    maxRows: number,
    isReadOnlyMode: boolean
  ): Promise<QueryResultWithMeta> {
    const cursorName = `mcp_cursor_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const needsTransaction = !isReadOnlyMode;

    try {
      if (needsTransaction) {
        await client.query('BEGIN');
      }

      await client.query(`DECLARE ${cursorName} CURSOR FOR ${sql}`, params);

      const result = await client.query(
        `FETCH ${maxRows + 1} FROM ${cursorName}`
      );

      const truncated = result.rows.length > maxRows;
      const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

      await client.query(`CLOSE ${cursorName}`);

      if (needsTransaction) {
        await client.query('COMMIT');
      }

      return {
        rows,
        rowCount: rows.length,
        truncated,
        fields: result.fields?.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        command: result.command,
      };
    } catch (err) {
      await client.query(`CLOSE ${cursorName}`).catch(() => {});
      if (needsTransaction) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    }
  }

  private shouldUseCursorLimiting(sql: string): boolean {
    const firstKeyword = getFirstKeyword(sql);
    if (!firstKeyword) {
      return false;
    }

    if (firstKeyword === 'WITH') {
      if (cteContainsDML(sql)) {
        return false;
      }

      const finalStatement = extractFinalStatementAfterCTEs(sql);
      if (finalStatement) {
        const normalizedFinal = stripLeadingComments(finalStatement).trim().toUpperCase();
        if (
          normalizedFinal.startsWith('INSERT ') ||
          normalizedFinal.startsWith('UPDATE ') ||
          normalizedFinal.startsWith('DELETE ') ||
          normalizedFinal.startsWith('MERGE ')
        ) {
          return false;
        }
      }

      return true;
    }

    if (
      firstKeyword === 'SELECT' ||
      firstKeyword === 'TABLE' ||
      firstKeyword === 'VALUES'
    ) {
      return true;
    }

    return false;
  }

  getStatus(): ConnectionStatus {
    return {
      initialized: this.isInitialized,
      reconnecting: this.isReconnecting,
      database: {
        host: this.config.database.host,
        port: this.config.database.port,
        database: this.config.database.database,
        user: this.config.database.user,
        ssl: this.sslEnabled,
      },
      tunnel: this.tunnelManager?.getState(),
      pool: {
        totalCount: this.pool?.totalCount || 0,
        idleCount: this.pool?.idleCount || 0,
        waitingCount: this.pool?.waitingCount || 0,
      },
      mode: this.config.readOnly ? 'read-only' : 'read-write',
      maxRows: this.config.maxRows,
      queryTimeout: this.config.queryTimeout,
    };
  }

  async close(): Promise<void> {
    console.error('[DB] Closing connection manager...');

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }

    if (this.tunnelManager) {
      await this.tunnelManager.close();
      this.tunnelManager = null;
    }

    this.isInitialized = false;
    console.error('[DB] Connection manager closed');
  }
}
