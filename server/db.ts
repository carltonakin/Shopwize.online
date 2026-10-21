import 'dotenv/config';
import sql from 'mssql';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const driver: typeof sql = process.env.SQL_TRUSTED_CONNECTION === 'true' ? require('mssql/msnodesqlv8') : sql;
export { sql };
export type Db = sql.ConnectionPool | sql.Transaction;
let pool: sql.ConnectionPool | undefined;
export function connectionConfig(database = process.env.SQL_DATABASE || 'ShopwizeDev'): sql.config {
  const trusted = process.env.SQL_TRUSTED_CONNECTION === 'true';
  return { server: process.env.SQL_SERVER || 'localhost', database,
    ...(trusted ? { driver: 'msnodesqlv8', connectionString: `Driver={${process.env.SQL_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server'}};Server=${process.env.SQL_SERVER || 'localhost'};Database=${database};Trusted_Connection=Yes;Encrypt=${process.env.SQL_ENCRYPT !== 'false' ? 'Yes' : 'No'};TrustServerCertificate=${process.env.SQL_TRUST_CERTIFICATE === 'true' ? 'Yes' : 'No'};` } : { user: process.env.SQL_USER, password: process.env.SQL_PASSWORD }),
    options: { encrypt: process.env.SQL_ENCRYPT !== 'false', trustServerCertificate: process.env.SQL_TRUST_CERTIFICATE === 'true', ...(trusted ? { trustedConnection: true } : {}) },
    pool: { max: 12, min: 0, idleTimeoutMillis: 30000 }, requestTimeout: 30000 } as sql.config;
}
export async function connect(database?: string) { const p = new driver.ConnectionPool(connectionConfig(database)); return p.connect(); }
export async function db() { if (!pool) pool = await connect(); return pool; }
export async function closeDb() { if (pool) await pool.close(); pool = undefined; }
export async function query<T = any>(text: string, values: Record<string, unknown> = {}, target?: Db): Promise<T[]> {
  const request = new driver.Request((target || await db()) as sql.ConnectionPool);
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'number') request.input(name, sql.Int, value);
    else if (typeof value === 'boolean') request.input(name, sql.Bit, value);
    else if (value instanceof Date) request.input(name, sql.DateTime2, value);
    else request.input(name, sql.NVarChar(sql.MAX), value == null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const rows = (await request.query<T>(target ? text : 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED; '+text)).recordset || [];
  return rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : value])) as T);
}
export async function transaction<T>(action: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = new driver.Transaction(await db());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try { const result = await action(tx); await tx.commit(); return result; }
    catch (error) {
      try { await tx.rollback(); } catch { /* SQL Server may already have rolled back. */ }
      if ((error as {number?:number}).number === 1205 && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.floor(Math.random() * 30)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Transaction retry limit reached.');
}
export function parse<T = any>(value: string | null | undefined, fallback: T = {} as T): T { return value ? JSON.parse(value) : fallback; }
