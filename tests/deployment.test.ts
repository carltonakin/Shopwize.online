import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import mssql from 'mssql';
import {databaseConfig,migrationDatabase} from '../server/database-config.js';
import {selectSqlDriver} from '../server/sql-driver.js';

describe('hosted SQL Server deployment',()=>{
  it('uses TCP without trying to load the missing native driver',()=>{
    const native=vi.fn(()=>{throw new Error('sql.h / native addon unavailable');});
    expect(selectSqlDriver(false,native)).toBe(mssql);
    expect(native).not.toHaveBeenCalled();
  });
  it('keeps trusted authentication explicit and reports missing prerequisites',()=>{
    const native=vi.fn(()=>mssql);
    expect(selectSqlDriver(true,native)).toBe(mssql);
    expect(native).toHaveBeenCalledOnce();
    expect(()=>selectSqlDriver(true,()=>{throw new Error('MODULE_NOT_FOUND');})).toThrow('SQL_TRUSTED_CONNECTION=false');
  });
  it('builds an encrypted SQL login connection with a provider-supplied database name and port',()=>{
    const config=databaseConfig({NODE_ENV:'production',SQL_SERVER:'sql.example.test',SQL_DATABASE:'db_customer-marketplace',SQL_USER:'app-user',SQL_PASSWORD:'test-only-secret',SQL_PORT:'14333',SQL_TRUSTED_CONNECTION:'false'});
    expect(config).toMatchObject({server:'sql.example.test',database:'db_customer-marketplace',port:14333,user:'app-user',password:'test-only-secret',options:{encrypt:true,trustServerCertificate:false}});
    expect(config).not.toHaveProperty('connectionString');
  });
  it('reports configuration names without exposing credentials',()=>{
    expect(()=>databaseConfig({NODE_ENV:'production',SQL_SERVER:'sql.example.test',SQL_DATABASE:'db_customer',SQL_PASSWORD:'secret-that-must-not-be-logged'})).toThrow('SQL_USER');
    expect(()=>databaseConfig({SQL_PORT:'NaN'})).toThrow('SQL_PORT');
    expect(()=>databaseConfig({SQL_PORT:'70000'})).toThrow('SQL_PORT');
  });
  it('preserves the local ODBC trusted connection and explicit certificate options',()=>{
    const config=databaseConfig({SQL_TRUSTED_CONNECTION:'true',SQL_ENCRYPT:'false',SQL_TRUST_CERTIFICATE:'true',SQL_DATABASE:'ShopwizeDev'});
    expect(config.connectionString).toContain('Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;');
    expect(config.connectionString).toContain('Database={ShopwizeDev}');
  });
  it('migrates a hosted existing database without requiring master/create-database access',()=>{
    expect(migrationDatabase({NODE_ENV:'production',SQL_DATABASE:'db_customer-marketplace'})).toEqual({name:'db_customer-marketplace',identifier:'[db_customer-marketplace]',create:false});
    expect(migrationDatabase({SQL_CREATE_DATABASE:'false'}).create).toBe(false);
    expect(migrationDatabase({}).create).toBe(true);
    expect(migrationDatabase({NODE_ENV:'production',SQL_CREATE_DATABASE:'true'}).create).toBe(true);
    expect(migrationDatabase({SQL_DATABASE:'name]with-bracket'}).identifier).toBe('[name]]with-bracket]');
  });
  it('does not make native ODBC installation a required dependency',()=>{
    const manifest=JSON.parse(readFileSync('package.json','utf8'));
    const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
    expect(manifest.dependencies).not.toHaveProperty('msnodesqlv8');
    expect(manifest.optionalDependencies.msnodesqlv8).toBeTruthy();
    expect(lock.packages['node_modules/msnodesqlv8'].optional).toBe(true);
    expect(manifest.dependencies.mssql).toBeTruthy();
  });
});
