import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../config.js';
import {AppError,assert} from '../util.js';

export function encryptPaymentSecret(value:string,key:Buffer,context:string) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(context));
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
export function decryptPaymentSecret(value:string,key:Buffer,context:string) {
  const [version,iv,tag,data,...extra]=value.split('.');
  assert(version==='v1'&&iv&&tag&&data!==undefined&&!extra.length,'Invalid encrypted payment setting.',503);
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
  cipher.setAAD(Buffer.from(context));cipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8');
}
export async function paymentEncryptionKey(create=false) {
  if(process.env.PAYMENT_SETTINGS_KEY){
    const key=Buffer.from(process.env.PAYMENT_SETTINGS_KEY,'base64');
    assert(key.length===32,'PAYMENT_SETTINGS_KEY must contain 32 base64-encoded random bytes.',503);return key;
  }
  const file=path.join(config.dataDir,process.env.NODE_ENV==='test'?'test-payment-settings.key':'payment-settings.key');
  try {const key=Buffer.from((await readFile(file,'utf8')).trim(),'hex');assert(key.length===32,'Restore the private payment settings encryption key.',503);return key;}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    if(!create)throw new AppError(503,'Restore the private payment settings encryption key before using saved credentials.');
  }
  await mkdir(config.dataDir,{recursive:true,mode:0o700});
  try {const handle=await open(file,'wx',0o600);try{await handle.writeFile(randomBytes(32).toString('hex'));await handle.sync();}finally{await handle.close();}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  return paymentEncryptionKey(false);
}
