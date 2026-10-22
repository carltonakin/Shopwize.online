import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {encryptPaymentSecret,decryptPaymentSecret} from '../server/payments/secrets.js';
import {withPaymentSettings,paymentValue,paymentPolicy,paymentControl} from '../server/payments/runtime.js';
import {settingSchemas} from '../server/payments/settings.js';

// Configuration/schema tests never open a database connection or call a provider.
afterEach(()=>vi.unstubAllEnvs());
describe('encrypted payment settings',()=>{
 it('round trips without storing plaintext and uses a new IV for each write',()=>{
  const key=randomBytes(32),secret='fixture-secret-value';
  const first=encryptPaymentSecret(secret,key,'stripe:STRIPE_SECRET_KEY');
  expect(first).not.toContain(secret);
  expect(encryptPaymentSecret(secret,key,'stripe:STRIPE_SECRET_KEY')).not.toBe(first);
  expect(decryptPaymentSecret(first,key,'stripe:STRIPE_SECRET_KEY')).toBe(secret);
 });
 it('rejects another key, altered ciphertext and moving a secret to another setting',()=>{
  const key=randomBytes(32),value=encryptPaymentSecret('secret',key,'stripe:STRIPE_SECRET_KEY');
  expect(()=>decryptPaymentSecret(value,randomBytes(32),'stripe:STRIPE_SECRET_KEY')).toThrow();
  expect(()=>decryptPaymentSecret(value,key,'paypal:PAYPAL_CLIENT_SECRET')).toThrow();
  const parts=value.split('.');parts[3]=Buffer.from('tampered').toString('base64');
  expect(()=>decryptPaymentSecret(parts.join('.'),key,'stripe:STRIPE_SECRET_KEY')).toThrow();
 });
 it('can explicitly clear a saved secret without falling back to an environment credential',()=>{
  vi.stubEnv('STRIPE_SECRET_KEY','old-environment-secret');
  expect(withPaymentSettings({values:{STRIPE_SECRET_KEY:''},controls:{},errors:[]},()=>paymentValue('STRIPE_SECRET_KEY'))).toBe('');
 });
});
describe('payment configuration scope and policy',()=>{
 it('keeps simultaneous request credentials isolated and leaves process.env unchanged',async()=>{
  vi.stubEnv('PAYPAL_CLIENT_SECRET','environment-secret');
  const task=(secret:string,delay:number)=>withPaymentSettings({values:{PAYPAL_CLIENT_SECRET:secret},controls:{},errors:[]},async()=>{await new Promise(resolve=>setTimeout(resolve,delay));return paymentValue('PAYPAL_CLIENT_SECRET');});
  expect(await Promise.all([task('first',10),task('second',1)])).toEqual(['first','second']);
  expect(paymentValue('PAYPAL_CLIENT_SECRET')).toBe('environment-secret');
 });
 it('requires all live confirmations and country settings',()=>{
  const values={OPERATING_COUNTRY:'US',SELLER_COUNTRIES:'US,CA',LIVE_POLICY_CONFIRMED:'true',LIVE_INTEGRATION_VERIFIED:'true',TAX_CONFIGURATION_CONFIRMED:'true',TAX_RATE_BPS:'825',MARKETPLACE_CURRENCY:'USD'};
  expect(withPaymentSettings({values,controls:{},errors:[]},()=>paymentPolicy())).toEqual({liveReady:true,taxBps:825,currency:'USD'});
  expect(withPaymentSettings({values:{...values,LIVE_INTEGRATION_VERIFIED:'false'},controls:{},errors:[]},()=>paymentPolicy().liveReady)).toBe(false);
 });
 it('preserves disabled provider controls independently of credential availability',()=>{
  expect(withPaymentSettings({values:{},controls:{paypal:{enabled:false,currencies:['USD']}},errors:[]},()=>paymentControl('paypal'))).toEqual({enabled:false,currencies:['USD']});
 });
 it('normalizes country lists and rejects unknown or out-of-range policy values',()=>{
  const values={MARKETPLACE_CURRENCY:'USD',OPERATING_COUNTRY:'US',SELLER_COUNTRIES:'us, ca',TAX_RATE_BPS:'825',LIVE_POLICY_CONFIRMED:'false',LIVE_INTEGRATION_VERIFIED:'false',TAX_CONFIGURATION_CONFIRMED:'false'};
  expect(settingSchemas.marketplace.parse(values).SELLER_COUNTRIES).toBe('US,CA');
  expect(()=>settingSchemas.marketplace.parse({...values,TAX_RATE_BPS:'10001'})).toThrow();
  expect(()=>settingSchemas.marketplace.parse({...values,STRIPE_SECRET_KEY:'not-public'})).toThrow();
 });
});
