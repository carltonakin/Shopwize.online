import type sql from 'mssql';

export type DatabaseConfig = sql.config & {driver?: string; connectionString?: string};

export function databaseConfig(env: NodeJS.ProcessEnv = process.env, database = env.SQL_DATABASE || 'ShopwizeDev'): DatabaseConfig {
  const trusted = env.SQL_TRUSTED_CONNECTION === 'true';
  const port = env.SQL_PORT ? Number(env.SQL_PORT) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('SQL_PORT must be an integer between 1 and 65535.');
  }
  if (env.NODE_ENV === 'production') {
    const required = ['SQL_SERVER', 'SQL_DATABASE', ...(!trusted ? ['SQL_USER', 'SQL_PASSWORD'] : [])];
    const missing = required.filter(key => !env[key]?.trim());
    if (missing.length) throw new Error(`Missing production database configuration: ${missing.join(', ')}. Set these in the hosting environment.`);
  }
  const server = env.SQL_SERVER || 'localhost';
  const encrypt = env.SQL_ENCRYPT !== 'false';
  const trustServerCertificate = env.SQL_TRUST_CERTIFICATE === 'true';
  return {
    server, database, ...(port !== undefined ? {port} : {}),
    ...(trusted ? {
      driver: 'msnodesqlv8',
      connectionString: `Driver={${env.SQL_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server'}};Server=${server}${port === undefined ? '' : `,${port}`};Database={${database.replaceAll('}', '}}')}};Trusted_Connection=Yes;Encrypt=${encrypt ? 'Yes' : 'No'};TrustServerCertificate=${trustServerCertificate ? 'Yes' : 'No'};`,
    } : {user: env.SQL_USER, password: env.SQL_PASSWORD}),
    options: {encrypt, trustServerCertificate, ...(trusted ? {trustedConnection: true} : {})},
    pool: {max: 12, min: 0, idleTimeoutMillis: 30000}, requestTimeout: 30000,
  };
}

export function migrationDatabase(env: NodeJS.ProcessEnv = process.env) {
  const name = env.SQL_DATABASE || 'ShopwizeDev';
  if (!name.trim() || name.length > 128 || [...name].some(char => char.charCodeAt(0) < 32)) {
    throw new Error('SQL_DATABASE must be a nonempty database name of at most 128 characters.');
  }
  const create = env.SQL_CREATE_DATABASE === 'true' || (env.SQL_CREATE_DATABASE === undefined && env.NODE_ENV !== 'production');
  return {name, create, identifier: `[${name.replaceAll(']', ']]')}]`};
}
