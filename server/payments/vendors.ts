import {query,transaction,parse} from '../db.js';
import {id,assert} from '../util.js';
import {paypalApi,stripeClient} from './providers.js';
import {paymentValue} from './runtime.js';

export async function syncVendorPaymentEligibility(vendorId:string){
  await query("UPDATE Vendors SET paymentEligible=CASE WHEN EXISTS(SELECT 1 FROM ProviderAccounts a LEFT JOIN VendorPaymentPreferences p ON p.vendorId=a.vendorId AND p.provider=a.provider WHERE a.vendorId=@vendor AND a.chargesEnabled=1 AND a.payoutsEnabled=1 AND COALESCE(p.enabled,1)=1) THEN 1 ELSE 0 END WHERE id=@vendor",{vendor:vendorId});
}
export async function refreshVendorPaymentAccount(vendorId:string,provider:string){
  const account=(await query('SELECT * FROM ProviderAccounts WHERE vendorId=@vendor AND provider=@provider',{vendor:vendorId,provider}))[0];
  let external:string,charges:boolean,payouts:boolean,data:any;
  if(provider==='stripe'){
    assert(account,'Start Stripe setup first.',409);
    const current=await stripeClient().accounts.retrieve(account.externalId);
    external=current.id;charges=!!current.charges_enabled;payouts=!!current.payouts_enabled;data={requirements:current.requirements};
  }else{
    const partner=paymentValue('PAYPAL_PARTNER_ID');assert(partner,'The host must configure PayPal first.',503);
    const path='/v1/customer/partners/'+encodeURIComponent(partner)+'/merchant-integrations';
    const current=await paypalApi(account?path+'/'+encodeURIComponent(account.externalId):path+'?tracking_id='+encodeURIComponent(vendorId));
    assert(current.merchant_id&&current.tracking_id?.toLowerCase()===vendorId.toLowerCase(),'PayPal has not confirmed this store connection yet.',409);
    external=current.merchant_id;charges=!!current.payments_receivable&&!!current.primary_email_confirmed;payouts=charges;data={products:current.products,primaryEmailConfirmed:!!current.primary_email_confirmed};
  }
  await transaction(async tx=>{
    await query('IF EXISTS(SELECT 1 FROM ProviderAccounts WITH(UPDLOCK,HOLDLOCK) WHERE vendorId=@vendor AND provider=@provider) UPDATE ProviderAccounts SET externalId=@external,chargesEnabled=@charges,payoutsEnabled=@payouts,data=@data WHERE vendorId=@vendor AND provider=@provider ELSE INSERT INTO ProviderAccounts(id,vendorId,provider,externalId,chargesEnabled,payoutsEnabled,data) VALUES(@id,@vendor,@provider,@external,@charges,@payouts,@data)',{id:id(),vendor:vendorId,provider,external,charges,payouts,data},tx);
  });
  await syncVendorPaymentEligibility(vendorId);
  return {chargesEnabled:charges,payoutsEnabled:payouts};
}
export async function vendorPaymentView(vendorId:string){
  const accounts=await query('SELECT provider,externalId,chargesEnabled,payoutsEnabled,data FROM ProviderAccounts WHERE vendorId=@vendor',{vendor:vendorId});
  const preferences=await query('SELECT provider,enabled FROM VendorPaymentPreferences WHERE vendorId=@vendor',{vendor:vendorId});
  return ['stripe','paypal'].map(provider=>{
    const account=accounts.find(a=>a.provider===provider),details=parse(account?.data);
    return {provider,connected:!!account,accountId:account?.externalId||null,chargesEnabled:!!account?.chargesEnabled,payoutsEnabled:!!account?.payoutsEnabled,enabled:preferences.find(p=>p.provider===provider)?.enabled??true,requirements:provider==='stripe'?(details.requirements?.currently_due||[]):[]};
  });
}
