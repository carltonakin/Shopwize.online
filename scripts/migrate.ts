import {readdir,readFile} from 'node:fs/promises';
import {connect,closeDb,query} from '../server/db.js';
import {migrationDatabase} from '../server/database-config.js';
const {name,create,identifier}=migrationDatabase();
// Hosted database users commonly have rights only on their pre-created database.
if(create){
  const master=await connect('master');
  try{await query('IF DB_ID(@name) IS NULL EXEC(@statement)',{name,statement:`CREATE DATABASE ${identifier}`},master);}
  finally{await master.close();}
}
const connection=await connect(name);
try{for(const file of (await readdir('database/migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort()){const source=(await readFile(`database/migrations/${file}`,'utf8')).replace(/^\uFEFF/,'');await connection.request().batch(source);}console.log(`Migrations applied to ${name}. No existing tables were dropped.`);}finally{await connection.close();await closeDb();}
