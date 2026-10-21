import {readdir,readFile} from 'node:fs/promises';
import {connect,closeDb,query} from '../server/db.js';
const name=process.env.SQL_DATABASE||'ShopwizeDev';
if(!/^Shopwize[A-Za-z0-9_]+$/.test(name))throw new Error('Database name must start with Shopwize and contain only alphanumerics/underscore.');
const master=await connect('master');await query(`IF DB_ID(@name) IS NULL EXEC('CREATE DATABASE [${name}]')`,{name},master);await master.close();
const connection=await connect(name);
try{for(const file of (await readdir('database/migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort()){const source=(await readFile(`database/migrations/${file}`,'utf8')).replace(/^\uFEFF/,'');await connection.request().batch(source);}console.log(`Migrations applied to ${name}. No existing tables were dropped.`);}finally{await connection.close();await closeDb();}
