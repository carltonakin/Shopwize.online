import sql from 'mssql';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

export function selectSqlDriver(trusted: boolean, loadNative: () => typeof sql = () => require('mssql/msnodesqlv8')): typeof sql {
  if (!trusted) return sql;
  try { return loadNative(); }
  catch {
    throw new Error('SQL_TRUSTED_CONNECTION=true requires the optional msnodesqlv8 package and Microsoft ODBC driver. For a hosted Linux SQL login, set SQL_TRUSTED_CONNECTION=false and configure SQL_SERVER, SQL_DATABASE, SQL_USER and SQL_PASSWORD. For Windows trusted authentication, install the native driver prerequisites and run npm install --include=optional.');
  }
}
