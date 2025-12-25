import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConnectionManager } from '../../src/connection/postgres-pool.js';
import { parseConfig } from '../../src/config.js';
import type { ParsedConfig } from '../../src/types.js';

const EXAMPLE_DATABASE_URI = 'postgresql://postgres:postgres@db.example.com:5432/postgres';
const databaseUrl = process.env.DATABASE_URI;
const hasDatabaseUrl = !!databaseUrl && databaseUrl !== EXAMPLE_DATABASE_URI;
const hasDatabaseEnv =
  !!process.env.DATABASE_HOST &&
  !!process.env.DATABASE_NAME &&
  !!process.env.DATABASE_USER &&
  !!process.env.DATABASE_PASSWORD;
const hasDb = hasDatabaseUrl || hasDatabaseEnv;
const describeIf = hasDb ? describe : describe.skip;

function buildConfig(readOnly: boolean, maxRows = 5): ParsedConfig {
  const config = parseConfig();
  return {
    ...config,
    readOnly,
    maxRows,
  };
}

describeIf('ConnectionManager integration', () => {
  let manager: ConnectionManager;

  beforeAll(async () => {
    manager = new ConnectionManager(buildConfig(true, 5));
    await manager.initialize();
  });

  afterAll(async () => {
    if (manager) {
      await manager.close();
    }
  });

  it('executes SELECT queries', async () => {
    const result = await manager.executeQuery('SELECT 1 as num');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].num).toBe(1);
  });

  it('truncates large result sets', async () => {
    const result = await manager.executeQuery(
      'SELECT generate_series(1, 100) as n'
    );
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('blocks write operations in read-only mode', async () => {
    await expect(
      manager.executeQuery('CREATE TABLE test_table (id int)')
    ).rejects.toThrow();
  });
});
