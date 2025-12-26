export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SSLPreference {
  /** 'true' enables, 'false' disables, null means default behavior */
  explicit: 'true' | 'false' | null;
  ca?: string;
  rejectUnauthorized: boolean;
}

export interface SSHTunnelConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  password?: string;
  strictHostKey: boolean;
  trustOnFirstUse: boolean;
  knownHostsPath?: string;
  keepaliveInterval: number;
  maxReconnectAttempts: number;
}

export interface TunnelTarget {
  host: string;
  port: number;
}

export type TunnelStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface TunnelState {
  status: TunnelStatus;
  localPort: number | null;
  uptime: number;
  reconnectAttempts: number;
  lastError?: string;
}

export interface ParsedConfig {
  database: DatabaseConfig;
  sslPreference: SSLPreference;
  ssh?: SSHTunnelConfig;
  readOnly: boolean;
  queryTimeout: number;
  maxRows: number;
  maxConcurrentQueries: number;
  poolDrainTimeoutMs: number;
}

export interface ConnectionStatus {
  initialized: boolean;
  reconnecting: boolean;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    ssl: boolean;
  };
  tunnel?: TunnelState;
  pool: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  mode: 'read-only' | 'read-write';
  maxRows: number;
  queryTimeout: number;
  maxConcurrentQueries: number;
  activeQueries: number;
}

export interface QueryField {
  name: string;
  dataTypeID: number;
}

export interface QueryResultWithMeta {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  fields?: QueryField[];
  command?: string;
}

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface KnownHost {
  hostname: string;
  keyType: string;
  publicKey: string;
}

export interface HostKeyVerificationResult {
  verified: boolean;
  reason: string;
}

export type AuthMode = 'none' | 'oauth';

export interface HttpConfig {
  port: number;
  host: string;
  authMode: AuthMode;
  auth0Domain?: string;
  auth0Audience?: string;
  sessionTtlMinutes: number;
  stateless: boolean;
  serverPoolSize: number;
  sessionCleanupIntervalMs: number;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  resourceDocumentation?: string;
}

export interface Auth0Config {
  domain: string;
  audience: string;
}
