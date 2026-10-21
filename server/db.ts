import 'dotenv/config';
import type mssql from 'mssql';
import {databaseConfig} from './database-config.js';
import {selectSqlDriver} from './sql-driver.js';
const driver = selectSqlDriver(process.env.SQL_TRUSTED_CONNECTION === 'true');
export const sql = driver;
export type Db = mssql.ConnectionPool | mssql.Transaction;
let pool: mssql.ConnectionPool | undefined;
export function connectionConfig(database = process.env.SQL_DATABASE || 'ShopwizeDev'): mssql.config {
  return databaseConfig(process.env, database);
}
export async function connect(database?: string) { const p = new driver.ConnectionPool(connectionConfig(database)); return p.connect(); }
export async function db() { if (!pool) pool = await connect(); return pool; }
export async function closeDb() { if (pool) await pool.close(); pool = undefined; }
export async function query<T = any>(text: string, values: Record<string, unknown> = {}, target?: Db): Promise<T[]> {
  const request = new driver.Request((target || await db()) as mssql.ConnectionPool);
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'number') request.input(name, sql.Int, value);
    else if (typeof value === 'boolean') request.input(name, sql.Bit, value);
    else if (value instanceof Date) request.input(name, sql.DateTime2, value);
    else request.input(name, sql.NVarChar(sql.MAX), value == null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const rows = (await request.query<T>(target ? text : 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED; '+text)).recordset || [];
  return rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : value])) as T);
}
export async function transaction<T>(action: (tx: mssql.Transaction) => Promise<T>): Promise<T> {
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
