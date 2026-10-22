import {useEffect,useState,type FormEvent} from 'react';
import {ArrowUpRight,RefreshCw,Save,ShieldCheck} from 'lucide-react';
import {api} from './api';
import {Field,ErrorBox,useShop} from './App';

type SettingField={key:string;label:string;type?:'boolean'|'percent'|'select';options?:[string,string][]};
const fields:Record<string,SettingField[]>={
 marketplace:[
  {key:'MARKETPLACE_CURRENCY',label:'Marketplace currency (for example USD)'},
  {key:'OPERATING_COUNTRY',label:'Shopwize business country (two-letter code)'},
  {key:'SELLER_COUNTRIES',label:'Allowed seller countries (comma separated)'},
  {key:'TAX_RATE_BPS',label:'Merchandise tax rate (%)',type:'percent'},
  {key:'TAX_CONFIGURATION_CONFIRMED',label:'I have confirmed the tax rate and Shopwize’s responsibility for collected tax.',type:'boolean'},
  {key:'LIVE_POLICY_CONFIRMED',label:'I have confirmed commission, refund, dispute and payment-provider policies.',type:'boolean'},
  {key:'LIVE_INTEGRATION_VERIFIED',label:'I have verified seller onboarding, payments, refunds and payouts with the provider.',type:'boolean'},
 ],
 stripe:[
  {key:'STRIPE_MODE',label:'Stripe mode',type:'select',options:[['test','Test'],['live','Live']]},
  {key:'STRIPE_CONNECT_MODEL',label:'Marketplace payment model',type:'select',options:[['','Choose a model'],['separate_charges_and_transfers','Separate charges and transfers']]},
  {key:'STRIPE_SUBSCRIPTION_PRICE_ID',label:'Growth subscription price ID (optional)'},
 ],
 paypal:[
  {key:'PAYPAL_ENVIRONMENT',label:'PayPal mode',type:'select',options:[['sandbox','Sandbox'],['live','Live']]},
  {key:'PAYPAL_PARTNER_ID',label:'Partner merchant ID'},
  {key:'PAYPAL_WEBHOOK_ID',label:'Webhook ID'},
  {key:'PAYPAL_BN_CODE',label:'Partner attribution code (optional)'},
  {key:'PAYPAL_FEE_REFUNDS_ENABLED',label:'PayPal has enabled platform-fee refunds and I have tested them.',type:'boolean'},
 ],
};
const secretLabels:Record<string,string>={STRIPE_SECRET_KEY:'Stripe secret key',STRIPE_WEBHOOK_SECRET:'Stripe webhook signing secret',PAYPAL_CLIENT_ID:'PayPal client ID',PAYPAL_CLIENT_SECRET:'PayPal client secret'};
const titles:Record<string,string>={marketplace:'Marketplace payment policy',stripe:'Stripe Connect',paypal:'PayPal marketplace payments'};

export function HostPaymentSettings({action}:{action:any}){
 const shop=useShop(),[data,setData]=useState<any>(null),[error,setError]=useState('');
 async function reload(){setData(await api('/admin/payment-settings'));}
 useEffect(()=>{if(shop.user?.role==='host_admin')reload().catch(e=>setError(e.message));},[shop.user?.id]);
 if(shop.user?.role!=='host_admin')return <div className="notice">A host administrator manages payment credentials and marketplace policy.</div>;
 return <section className="payment-settings"><ErrorBox error={error}/>{!data?<p>Loading payment settings…</p>:<>
  <div className="notice"><ShieldCheck size={18}/> Configure checkout here. Credentials are encrypted and never displayed after saving. Commission rates remain in Settings. <strong>{data.liveReady?'Live policy confirmations complete.':'Live payments require the confirmations below.'}</strong></div>
  {!!data.errors.length&&<ErrorBox error="Saved credentials could not be unlocked. Restore the site’s private payment encryption key before enabling payments."/>}
  {['marketplace','stripe','paypal'].map(scope=><PaymentSettingForm key={scope+data.scopes[scope].version} scope={scope} setting={data.scopes[scope]} provider={data.providers.find((p:any)=>p.id===scope)} onSave={async(body:any)=>{await action('/admin/payment-settings/'+scope,body,'PUT');await reload();await shop.refresh();}}/>)}
  <div className="panel"><h3>Other payment options</h3><p>WooPayments requires a separate WooCommerce integration and cannot be enabled for this app. The local payment simulator is for development only.</p><p className="small muted">Payment methods such as eligible cards and wallets, bank details, payout schedules and account verification are managed in the provider dashboard. Your provider’s country and account requirements still apply.</p></div>
 </>}</section>;
}
function PaymentSettingForm({scope,setting,provider,onSave}:{scope:string;setting:any;provider:any;onSave:(body:any)=>Promise<void>}){
 const [values,setValues]=useState<Record<string,string>>(setting.values),[secrets,setSecrets]=useState<Record<string,string|null>>({}),[enabled,setEnabled]=useState(setting.enabled),[currencies,setCurrencies]=useState(setting.currencies.join(', ')),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 const set=(key:string,value:string)=>setValues(current=>({...current,[key]:value}));
 async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');setResult('');try{await onSave({version:setting.version,values,secrets,...(scope==='marketplace'?{}:{enabled,currencies:currencies.toUpperCase().split(',').map((v:string)=>v.trim()).filter(Boolean)})});setSecrets({});}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 async function test(){setBusy(true);setError('');setResult('');try{const r=await api('/admin/payment-settings/'+scope+'/test',{});setResult(r.message+(r.accountId?' Account: '+r.accountId:''));}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 return <form className="panel" onSubmit={save}><div className="section-head"><h2>{titles[scope]}</h2>{provider&&<span className={`status ${provider.available?'approved':''}`}>{provider.available?'Available · '+provider.mode:provider.enabled===false?'Checkout disabled':'Setup needed · '+provider.mode}</span>}</div>
  <ErrorBox error={error}/>{result&&<p className="notice" role="status">{result}</p>}
  <fieldset disabled={busy} className="payment-fieldset">
   <div className="payment-fields">{fields[scope].map(field=>field.type==='boolean'?<label className="checkbox payment-wide" key={field.key}><input type="checkbox" checked={values[field.key]==='true'} onChange={e=>set(field.key,String(e.target.checked))}/>{field.label}</label>:field.type==='select'?<label className="field" key={field.key}><span>{field.label}</span><select value={values[field.key]} onChange={e=>set(field.key,e.target.value)}>{field.options!.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>:<Field key={field.key} label={field.label} type={field.type==='percent'?'number':'text'} min={field.type==='percent'?0:undefined} max={field.type==='percent'?100:undefined} step={field.type==='percent'?'0.01':undefined} value={field.type==='percent'?Number(values[field.key])/100:values[field.key]} onChange={(e:any)=>set(field.key,field.type==='percent'?String(Math.round(Number(e.target.value)*100)):['MARKETPLACE_CURRENCY','OPERATING_COUNTRY','SELLER_COUNTRIES'].includes(field.key)?e.target.value.toUpperCase():e.target.value)}/>)}</div>
   {scope==='marketplace'&&<p className="small muted">The tax rate applies to merchandise after discounts. Tax is held separately from commission. Changing rates affects new orders; saved order amounts stay unchanged.</p>}
   {Object.entries(setting.secretStatus).map(([key,status]:[string,any])=><div className="payment-secret" key={key}><Field label={secretLabels[key]} type="password" autoComplete="new-password" spellCheck={false} disabled={secrets[key]===null} value={secrets[key]||''} placeholder={status.configured?'Configured — leave blank to keep':'Enter credential'} onChange={(e:any)=>setSecrets(current=>({...current,[key]:e.target.value}))}/>{status.configured&&<label className="checkbox small"><input type="checkbox" checked={secrets[key]===null} onChange={e=>setSecrets(current=>({...current,[key]:e.target.checked?null:''}))}/>Clear this credential</label>}</div>)}
   {scope!=='marketplace'&&<>
    <Field label="Webhook endpoint — register this URL with the provider" value={setting.webhookUrl} readOnly/>
    <Field label="Accepted checkout currencies (blank means all supported currencies)" value={currencies} onChange={(e:any)=>setCurrencies(e.target.value)}/>
    <label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Allow new checkouts with this provider</label>
    <p className="small muted">Disabling checkout preserves refunds and existing payment processing. Use a separate test environment once sellers or payment history are connected; switching accounts or modes could interrupt those payments.</p>
   </>}
   <div className="button-row"><button className="btn" type="submit"><Save size={16}/>{busy?'Working…':'Save '+(scope==='marketplace'?'payment policy':scope+' settings')}</button>{scope!=='marketplace'&&<button className="btn secondary" type="button" onClick={test}>Test saved connection</button>}</div>
   {scope!=='marketplace'&&<p><a href={scope==='stripe'?'https://dashboard.stripe.com/settings':'https://www.paypal.com/businessmanage/account/aboutBusiness'} target="_blank" rel="noreferrer">Open {scope==='stripe'?'Stripe':'PayPal'} account settings <ArrowUpRight size={14}/></a></p>}
  </fieldset>
 </form>;
}

export function VendorPaymentSettings({action}:{action:any}){
 const [data,setData]=useState<any>(null),[country,setCountry]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 async function reload(){const r=await api('/vendor/payment-settings');setData(r);setCountry(r.country||'');}
 useEffect(()=>{reload().catch(e=>setError(e.message));},[]);
 async function change(path:string,body:any={},method='POST',redirect=false){setError('');setNotice('');setBusy(path);try{const result=await action(path,body,method);await reload();if(redirect&&result.url)window.location.assign(result.url);else setNotice('Payment settings updated.');}catch(e:any){setError(e.message);}finally{setBusy('');}}
 return <section className="payment-settings"><ErrorBox error={error}/>{notice&&<p className="notice" role="status">{notice}</p>}{!data?<p>Loading your payment accounts…</p>:<>
  <div className="notice">Connect a payment account to receive your share after Shopwize’s commission and tax allocation. Bank details and verification are completed securely with the provider. {!data.canEdit&&'Only the store owner can change payment settings.'}</div>
  <form className="panel" onSubmit={e=>{e.preventDefault();change('/vendor/payment-settings',{country},'PUT');}}><h3>Business country</h3><Field label="Registered business country (two-letter code)" value={country} maxLength={2} pattern="[A-Z]{2}" required disabled={!data.canEdit||data.accounts.some((a:any)=>a.connected)||!!busy} onChange={(e:any)=>setCountry(e.target.value.toUpperCase())}/><button className="btn secondary" disabled={!data.canEdit||data.accounts.some((a:any)=>a.connected)||!!busy}>Save business country</button></form>
  {data.accounts.map((account:any)=>{const provider=data.providers.find((p:any)=>p.id===account.provider),ready=account.chargesEnabled&&account.payoutsEnabled;return <div className="panel" key={account.provider}>
   <div className="section-head"><h2>{account.provider==='stripe'?'Stripe Connect':'PayPal'}</h2><span className={`status ${ready?'approved':''}`}>{ready?'Verified':account.connected?'Verification needed':'Not connected'}</span></div>
   <p>Mode: {provider.mode}. {account.accountId&&'Account: '+account.accountId}</p>
   <p>{provider.enabled===false?'Shopwize has paused new checkouts with this provider.':!provider.available?'Shopwize still needs to complete provider setup.':'Available for eligible checkouts.'}</p>
   <p className="small">Payments: {account.chargesEnabled?'enabled':'not yet enabled'} · Payouts: {account.payoutsEnabled?'enabled':'not yet enabled'}</p>
   {!!account.requirements.length&&<p className="notice">Finish these details with Stripe: {account.requirements.map((r:string)=>r.replaceAll('_',' ')).join(', ')}.</p>}
   <label className="checkbox"><input type="checkbox" checked={account.enabled} disabled={!data.canEdit||!!busy} onChange={e=>change('/vendor/payment-settings/'+account.provider,{enabled:e.target.checked},'PUT')}/>Accept new payments through {account.provider==='stripe'?'Stripe':'PayPal'}</label>
   <div className="button-row payment-actions"><button className="btn" disabled={!data.canEdit||!!busy||!provider.canOnboard} onClick={()=>change('/vendor/onboarding/'+account.provider,{},'POST',true)}>{account.connected?'Continue verification':'Connect account'} <ArrowUpRight size={15}/></button><button className="btn secondary" disabled={!data.canEdit||!!busy||!provider.canOnboard} onClick={()=>change('/vendor/payment-settings/'+account.provider+'/refresh')}><RefreshCw size={15}/>Refresh status</button>{account.connected&&<button className="btn secondary" disabled={!data.canEdit||!!busy} onClick={()=>change('/vendor/payment-settings/'+account.provider+'/manage',{},'POST',true)}>Manage payouts <ArrowUpRight size={15}/></button>}</div>
  </div>;})}
 </>}</section>;
}
