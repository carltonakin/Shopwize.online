import Stripe from 'stripe';
import { config } from '../config.js';
import { assert,AppError } from '../util.js';
import { minor } from '../money.js';
export type Capture = { externalId:string; vendorOrderId?:string; amount:string; currency:string; state:'paid'|'pending'|'failed'; sourceCharge?:string };
export type CheckoutInput = { id:string; currency:string; total:string; accessToken:string; email:string; groups:{id:string;total:string;commission:string;account:string}[] };
export interface PaymentAdapter {
  name:string; capabilities():{available:boolean;mode:string;reason:string;multiSeller:boolean};
  createCheckout(input:CheckoutInput):Promise<{id:string;url?:string;state:string}>;
  reconcile(providerId:string):Promise<Capture[]>;
  capture(providerId:string):Promise<Capture[]>;
  refund(input:{captureId:string;amount:string;currency:string;key:string;account?:string;commission?:string}):Promise<{id:string;state:string}>;
  verifyWebhook(body:Buffer,headers:Record<string,any>):Promise<{id:string;type:string;data:any}>;
}
function stripeClient() { assert(process.env.STRIPE_SECRET_KEY,'Stripe is not configured.',503);return new Stripe(process.env.STRIPE_SECRET_KEY!); }
function stripeCapabilities() { const key=process.env.STRIPE_SECRET_KEY; const mode=key?.startsWith('sk_live_')?'live':'test'; return {available:!!key && !!process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_CONNECT_MODEL==='separate_charges_and_transfers' && (mode!=='live'||config.liveReady),mode,reason:'Requires Connect credentials, webhook secret, confirmed charge model and eligible seller accounts. Live sales also require country, fee and tax confirmation.',multiSeller:true}; }
export const stripe:PaymentAdapter={
  name:'stripe', capabilities:stripeCapabilities,
  async createCheckout(o) {
    assert(stripeCapabilities().available,'Stripe checkout is not configured.',503);
    const s=await stripeClient().checkout.sessions.create({mode:'payment',customer_email:o.email,client_reference_id:o.id,
      line_items:[{price_data:{currency:o.currency.toLowerCase(),unit_amount:Number(minor(o.total,o.currency)),product_data:{name:'Shopwize order',description:`${o.groups.length} store${o.groups.length===1?'':'s'}`}},quantity:1}],
      payment_intent_data:{transfer_group:o.id,metadata:{orderId:o.id}},metadata:{orderId:o.id},
      success_url:`${config.checkoutOrigin}/order/${o.id}?access=${o.accessToken}`,cancel_url:`${config.checkoutOrigin}/checkout?cancelled=1`,expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:`checkout:${o.id}`});
    return {id:s.id,url:s.url!,state:'requires_action'};
  },
  async reconcile(providerId) {
    const s=await stripeClient().checkout.sessions.retrieve(providerId,{expand:['payment_intent']});const p=s.payment_intent as Stripe.PaymentIntent|null;
    if(!p)return []; return [{externalId:p.id,amount:(await import('../money.js')).amount(BigInt(p.amount_received),p.currency.toUpperCase()),currency:p.currency.toUpperCase(),state:p.status==='succeeded'?'paid':p.status==='canceled'?'failed':'pending',sourceCharge:typeof p.latest_charge==='string'?p.latest_charge:p.latest_charge?.id}];
  },
  async capture(providerId){return this.reconcile(providerId);},
  async refund(i){const r=await stripeClient().refunds.create({payment_intent:i.captureId,amount:Number(minor(i.amount,i.currency))},{idempotencyKey:i.key});return {id:r.id,state:r.status==='succeeded'?'succeeded':r.status==='failed'?'failed':'pending'};},
  async verifyWebhook(body,headers){assert(process.env.STRIPE_WEBHOOK_SECRET,'Webhook secret is not configured.',503);let e;try{e=stripeClient().webhooks.constructEvent(body,headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET!);}catch{throw new AppError(400,'Invalid Stripe webhook signature.');}return {id:e.id,type:e.type,data:{...e.data.object,_account:e.account}};}
};
const paypalBase=()=>process.env.PAYPAL_ENVIRONMENT==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
async function paypalAccess(){assert(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET,'PayPal is not configured.',503);const r=await fetch(`${paypalBase()}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(15000)});assert(r.ok,'PayPal authentication failed.',502);return (await r.json()).access_token;}
export async function paypalApi(path:string,method='GET',body?:unknown,key?:string,account?:string){
  const assertion=account?`${Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')}.${Buffer.from(JSON.stringify({iss:process.env.PAYPAL_CLIENT_ID,payer_id:account})).toString('base64url')}.`:undefined;
  const r=await fetch(paypalBase()+path,{method,headers:{Authorization:`Bearer ${await paypalAccess()}`,'Content-Type':'application/json',...(key?{'PayPal-Request-Id':key}:{}),...(process.env.PAYPAL_BN_CODE?{'PayPal-Partner-Attribution-Id':process.env.PAYPAL_BN_CODE}:{}),...(assertion?{'PayPal-Auth-Assertion':assertion}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  assert(r.ok,`PayPal request failed (${r.status}); reconcile before retrying.`,502);return r.status===204?{}:r.json();
}
function paypalCaptures(o:any):Capture[]{return (o.purchase_units||[]).flatMap((u:any)=>(u.payments?.captures||[]).map((c:any)=>({externalId:c.id,vendorOrderId:u.reference_id,amount:c.amount.value,currency:c.amount.currency_code,state:c.status==='COMPLETED'?'paid':c.status==='DECLINED'?'failed':'pending'})));}
export const paypal:PaymentAdapter={name:'paypal',capabilities(){const mode=process.env.PAYPAL_ENVIRONMENT==='live'?'live':'sandbox';return {available:!!process.env.PAYPAL_CLIENT_ID&&!!process.env.PAYPAL_CLIENT_SECRET&&!!process.env.PAYPAL_PARTNER_ID&&!!process.env.PAYPAL_WEBHOOK_ID&&(mode!=='live'||config.liveReady),mode,reason:'Requires approved multiparty partner credentials, seller onboarding and signed webhooks. Buyers may see separate merchant charges.',multiSeller:true};},
 async createCheckout(o){assert(this.capabilities().available,'PayPal multiparty is not configured.',503);assert(o.groups.length<=10,'PayPal supports at most 10 sellers per order.');const result=await paypalApi('/v2/checkout/orders','POST',{intent:'CAPTURE',purchase_units:o.groups.map(g=>({reference_id:g.id,custom_id:o.id,payee:{merchant_id:g.account},amount:{currency_code:o.currency,value:g.total},payment_instruction:{disbursement_mode:'INSTANT',platform_fees:[{amount:{currency_code:o.currency,value:g.commission},payee:{merchant_id:process.env.PAYPAL_PARTNER_ID}}]}})),payment_source:{paypal:{experience_context:{return_url:`${config.checkoutOrigin}/order/${o.id}?access=${o.accessToken}&paypalReturn=1`,cancel_url:`${config.checkoutOrigin}/checkout?cancelled=1`,user_action:'PAY_NOW'}}}},`create:${o.id}`);return {id:result.id,url:result.links?.find((l:any)=>['payer-action','approve'].includes(l.rel))?.href,state:'requires_action'};},
 async capture(id){return paypalCaptures(await paypalApi(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`,'POST',{},`capture:${id}`));},
 async reconcile(id){return paypalCaptures(await paypalApi(`/v2/checkout/orders/${encodeURIComponent(id)}`));},
 async refund(i){assert(process.env.PAYPAL_FEE_REFUNDS_ENABLED==='true','PayPal platform-fee refund approval must be configured before issuing marketplace refunds.',503);const r=await paypalApi(`/v2/payments/captures/${encodeURIComponent(i.captureId)}/refund`,'POST',{amount:{currency_code:i.currency,value:i.amount},payment_instruction:{platform_fees:[{amount:{currency_code:i.currency,value:i.commission||'0.00'}}]}},i.key,i.account);return {id:r.id,state:r.status==='COMPLETED'?'succeeded':'pending'};},
 async verifyWebhook(body,headers){const event=JSON.parse(body.toString('utf8'));const r=await paypalApi('/v1/notifications/verify-webhook-signature','POST',{auth_algo:headers['paypal-auth-algo'],cert_url:headers['paypal-cert-url'],transmission_id:headers['paypal-transmission-id'],transmission_sig:headers['paypal-transmission-sig'],transmission_time:headers['paypal-transmission-time'],webhook_id:process.env.PAYPAL_WEBHOOK_ID,webhook_event:event});assert(r.verification_status==='SUCCESS','Invalid PayPal signature.',400);return {id:event.id,type:event.event_type,data:event.resource};}
};
export const mock:PaymentAdapter={name:'mock',capabilities:()=>({available:config.mock,mode:'mock',reason:'Local simulation only. No payment provider or real money is involved.',multiSeller:true}),async createCheckout(o){assert(config.mock,'Simulation is disabled.',403);return {id:`mock_${o.id}`,state:'requires_action'};},async reconcile(){return [];},async capture(){return [];},async refund(i){assert(config.mock,'Simulation is disabled.',403);return {id:`mock_refund_${i.key}`,state:'succeeded'};},async verifyWebhook(){throw new Error('Mock has no public webhook.');}};
export const adapters:Record<string,PaymentAdapter>={stripe,paypal,mock};
export function provider(name:string){assert(adapters[name],'Unsupported payment provider.');return adapters[name];}
export function providerInfo(){return [...Object.values(adapters).map(a=>({id:a.name,...a.capabilities()})),{id:'woopayments',available:false,mode:'unavailable',multiSeller:false,reason:'Requires a WooCommerce installation in an eligible country and a verified marketplace payout extension; not a generic Node.js gateway.'}];}
export async function stripeOnboarding(vendorId:string,email:string,country:string,externalId?:string){const s=stripeClient();const a=externalId?await s.accounts.retrieve(externalId):await s.accounts.create({type:'express',country,email,capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata:{vendorId}},{idempotencyKey:`seller:${vendorId}`});const link=await s.accountLinks.create({account:a.id,refresh_url:`${config.origin}/vendor?onboarding=refresh`,return_url:`${config.origin}/vendor?onboarding=returned`,type:'account_onboarding'});return {id:a.id,url:link.url};}
export async function stripeTransfer(input:{id:string;amount:string;currency:string;account:string;sourceCharge:string;orderId:string}){return stripeClient().transfers.create({amount:Number(minor(input.amount,input.currency)),currency:input.currency.toLowerCase(),destination:input.account,source_transaction:input.sourceCharge,transfer_group:input.orderId},{idempotencyKey:`transfer:${input.id}`});}
export async function stripeReverse(transferId:string,value:string,currency:string,key:string){return stripeClient().transfers.createReversal(transferId,{amount:Number(minor(value,currency))},{idempotencyKey:key});}
export { stripeClient };
