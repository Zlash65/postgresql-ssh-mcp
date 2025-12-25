import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConnectionManager } from '../../src/connection/postgres-pool.js';
import { parseConfig } from '../../src/config.js';
import { createServer } from '../../src/server.js';
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

function buildConfig(readOnly: boolean, maxRows = 100): ParsedConfig {
  const config = parseConfig();
  return {
    ...config,
    readOnly,
    maxRows,
  };
}

type ToolHandler = (args: Record<string, unknown>, context: unknown) => Promise<{
  content: Array<{ text: string }>;
}>;

describeIf('Tool integration', () => {
  let manager: ConnectionManager;
  let registeredTools: Record<string, { handler: ToolHandler }>;

  beforeAll(async () => {
    manager = new ConnectionManager(buildConfig(true));
    await manager.initialize();
    const { server } = createServer(manager);
    registeredTools = (
      server as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> }
    )._registeredTools;
  });

  afterAll(async () => {
    if (manager) {
      await manager.close();
    }
  });

  it('execute_query returns rows', async () => {
    const result = await registeredTools['execute_query'].handler(
      { sql: 'SELECT 1 as num' },
      {}
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.rows[0].num).toBe(1);
  });

  it('list_schemas returns schema list', async () => {
    const result = await registeredTools['list_schemas'].handler(
      { includeSystem: false },
      {}
    );
    const payload = JSON.parse(result.content[0].text);
    expect(Array.isArray(payload)).toBe(true);
  });

  it('get_connection_status returns status object', async () => {
    const result = await registeredTools['get_connection_status'].handler({}, {});
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toHaveProperty('database');
    expect(payload).toHaveProperty('pool');
  });

  it('get_database_version returns version string', async () => {
    const result = await registeredTools['get_database_version'].handler({}, {});
    expect(typeof result.content[0].text).toBe('string');
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });
});
