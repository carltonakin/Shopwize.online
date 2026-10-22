import {z} from 'zod';
import {query,transaction,parse} from '../db.js';
import {assert} from '../util.js';
import {config} from '../config.js';
import {decryptPaymentSecret,encryptPaymentSecret,paymentEncryptionKey} from './secrets.js';
import {type PaymentContext} from './runtime.js';

const bool=z.enum(['true','false']);
const short=z.string().trim().max(200);
const countries=z.string().trim().transform(v=>v.toUpperCase().split(',').map(s=>s.trim()).filter(Boolean).join(',')).refine(v=>!v||v.split(',').every(c=>/^[A-Z]{2}$/.test(c)),'Use two-letter country codes separated by commas.');
export const settingSchemas={
  marketplace:z.object({MARKETPLACE_CURRENCY:z.string().regex(/^[A-Z]{3}$/),OPERATING_COUNTRY:z.string().regex(/^([A-Z]{2})?$/),SELLER_COUNTRIES:countries,TAX_RATE_BPS:z.string().regex(/^\d{1,5}$/).refine(v=>Number(v)<=10000),LIVE_POLICY_CONFIRMED:bool,TAX_CONFIGURATION_CONFIRMED:bool,LIVE_INTEGRATION_VERIFIED:bool}).strict(),
  stripe:z.object({STRIPE_MODE:z.enum(['test','live']),STRIPE_CONNECT_MODEL:z.enum(['','separate_charges_and_transfers']),STRIPE_SUBSCRIPTION_PRICE_ID:short.refine(v=>!v||/^price_[A-Za-z0-9]+$/.test(v),'Enter a Stripe price ID.')}).strict(),
  paypal:z.object({PAYPAL_ENVIRONMENT:z.enum(['sandbox','live']),PAYPAL_PARTNER_ID:short,PAYPAL_WEBHOOK_ID:short,PAYPAL_BN_CODE:short,PAYPAL_FEE_REFUNDS_ENABLED:bool}).strict(),
};
export type SettingScope=keyof typeof settingSchemas;
export const secretNames:Record<SettingScope,string[]>={marketplace:[],stripe:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],paypal:['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET']};
const defaults:Record<SettingScope,Record<string,string>>={
  marketplace:{MARKETPLACE_CURRENCY:config.currency,OPERATING_COUNTRY:'',SELLER_COUNTRIES:'',TAX_RATE_BPS:String(config.taxBps),LIVE_POLICY_CONFIRMED:'false',TAX_CONFIGURATION_CONFIRMED:'false',LIVE_INTEGRATION_VERIFIED:'false'},
  stripe:{STRIPE_MODE:'test',STRIPE_CONNECT_MODEL:'',STRIPE_SUBSCRIPTION_PRICE_ID:''},
  paypal:{PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_PARTNER_ID:'',PAYPAL_WEBHOOK_ID:'',PAYPAL_BN_CODE:'',PAYPAL_FEE_REFUNDS_ENABLED:'false'},
};
function publicValues(scope:SettingScope,saved:Record<string,string>={}) {
  const values=Object.fromEntries(Object.entries(defaults[scope]).map(([key,value])=>[key,process.env[key]??value]));
  if(scope==='stripe'&&!process.env.STRIPE_MODE)values.STRIPE_MODE=process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')?'live':'test';
  return {...values,...saved};
}
export async function loadPaymentSettings():Promise<PaymentContext> {
  const rows=await query('SELECT scope,settings,secrets FROM PaymentConfiguration');
  const controls=await query('SELECT provider,enabled,currencies FROM ProviderSettings');
  const values:Record<string,string>={},errors:string[]=[];
  for(const row of rows){
    Object.assign(values,parse(row.settings));
    const secrets=parse<Record<string,string>>(row.secrets);
    for(const [name,ciphertext] of Object.entries(secrets)){
      try{values[name]=decryptPaymentSecret(ciphertext,await paymentEncryptionKey(),row.scope+':'+name);}
      catch{values[name]='';if(!errors.includes(row.scope))errors.push(row.scope);}
    }
  }
  return {values,errors,controls:Object.fromEntries(controls.map(c=>[c.provider,{enabled:!!c.enabled,currencies:parse(c.currencies,[])}]))};
}
export async function paymentSettingsView(){
  const rows=await query('SELECT * FROM PaymentConfiguration');
  const runtime=await loadPaymentSettings();
  return {errors:runtime.errors,scopes:Object.fromEntries((Object.keys(defaults) as SettingScope[]).map(scope=>{
    const row=rows.find(r=>r.scope===scope),saved=parse(row?.settings);
    return [scope,{version:row?.version||0,values:publicValues(scope,saved),secretStatus:Object.fromEntries(secretNames[scope].map(key=>[key,{configured:!!(runtime.values[key]??process.env[key]),source:Object.hasOwn(runtime.values,key)?'app':'environment'}])),enabled:runtime.controls[scope]?.enabled??true,currencies:runtime.controls[scope]?.currencies||[],webhookUrl:scope==='marketplace'?null:config.origin+'/api/webhooks/'+scope}];
  }))};
}
const updateSchema=z.object({version:z.number().int().nonnegative(),values:z.record(z.string(),z.string()),secrets:z.record(z.string(),z.string().trim().max(4000).nullable()).default({}),enabled:z.boolean().optional(),currencies:z.array(z.string().regex(/^[A-Z]{3}$/)).max(100).optional()}).strict();
export async function savePaymentSettings(scope:SettingScope,body:unknown,actorId:string){
  const input=updateSchema.parse(body);
  const values=settingSchemas[scope].parse(input.values);
  assert(Object.keys(input.secrets).every(key=>secretNames[scope].includes(key)),'Unsupported secret setting.');
  if(scope==='marketplace')assert(input.enabled===undefined&&input.currencies===undefined,'Marketplace settings do not have provider controls.');
  await transaction(async tx=>{
    const row=(await query('SELECT * FROM PaymentConfiguration WITH(UPDLOCK,HOLDLOCK) WHERE scope=@scope',{scope},tx))[0];
    assert((row?.version||0)===input.version,'These payment settings changed. Reload before saving.',409);
    const stored=parse<Record<string,string>>(row?.secrets),current=publicValues(scope,parse(row?.settings));
    const effective:Record<string,string>={};
    for(const key of secretNames[scope]){
      const change=input.secrets[key];
      if(change===null)effective[key]='';
      else if(change)effective[key]=change;
      else if(stored[key])effective[key]=decryptPaymentSecret(stored[key],await paymentEncryptionKey(),scope+':'+key);
      else effective[key]=process.env[key]||'';
    }
    if(scope==='stripe'&&effective.STRIPE_SECRET_KEY){
      assert(/^sk_(test|live)_[A-Za-z0-9]+$/.test(effective.STRIPE_SECRET_KEY),'Enter a valid Stripe secret key.');
      assert(effective.STRIPE_SECRET_KEY.startsWith('sk_'+(values as any).STRIPE_MODE+'_'),'Stripe key must match the selected test/live mode.');
    }
    if(scope!=='marketplace'){
      const modeKey=scope==='stripe'?'STRIPE_MODE':'PAYPAL_ENVIRONMENT';
      const changedIdentity=current[modeKey]!==((values as Record<string,string>)[modeKey]) || (scope==='paypal'&&current.PAYPAL_PARTNER_ID!==(values as any).PAYPAL_PARTNER_ID);
      const clearing=Object.values(input.secrets).some(v=>v===null);
      if(changedIdentity||clearing){
        const used=(await query("SELECT (SELECT COUNT(*) FROM Orders WHERE provider=@provider)+(SELECT COUNT(*) FROM ProviderAccounts WHERE provider=@provider)+CASE WHEN @provider='stripe' THEN (SELECT COUNT(*) FROM Subscriptions WHERE providerId IS NOT NULL) ELSE 0 END AS n",{provider:scope},tx))[0];
        assert(!used.n,'This provider has connected sellers, subscriptions or payment history. Keep its account and mode for refunds; use a separate test environment.',409);
      }
    }
    const changes=Object.entries(input.secrets).filter(([,value])=>value===null||!!value);
    if(changes.length){
      const anyStored=(await query("SELECT COUNT(*) AS n FROM PaymentConfiguration WHERE secrets<>'{}'",{},tx))[0].n;
      const key=await paymentEncryptionKey(!anyStored);
      for(const [name,value] of changes)stored[name]=encryptPaymentSecret(value||'',key,scope+':'+name);
    }
    await query('IF EXISTS(SELECT 1 FROM PaymentConfiguration WHERE scope=@scope) UPDATE PaymentConfiguration SET settings=@settings,secrets=@secrets,version=version+1,updatedAt=SYSUTCDATETIME() WHERE scope=@scope ELSE INSERT INTO PaymentConfiguration(scope,settings,secrets,version) VALUES(@scope,@settings,@secrets,1)',{scope,settings:values,secrets:stored},tx);
    if(scope!=='marketplace')await query('IF EXISTS(SELECT 1 FROM ProviderSettings WHERE provider=@provider) UPDATE ProviderSettings SET enabled=@enabled,currencies=@currencies,updatedAt=SYSUTCDATETIME() WHERE provider=@provider ELSE INSERT INTO ProviderSettings(provider,enabled,currencies) VALUES(@provider,@enabled,@currencies)',{provider:scope,enabled:input.enabled??true,currencies:input.currencies||[]},tx);
    await query("INSERT INTO AuditEvents(id,actorId,action,resourceId,data) VALUES(NEWID(),@actor,'payment.configuration',@scope,@data)",{actor:actorId,scope,data:{fields:Object.keys(values),secretFields:changes.map(([key])=>key),version:input.version+1}},tx);
  });
}
