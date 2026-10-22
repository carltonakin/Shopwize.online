import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {query,parse} from '../server/db.js';
import {loadPaymentSettings} from '../server/payments/settings.js';
import {withPaymentSettings,paymentValue,paymentPolicy} from '../server/payments/runtime.js';
import {providerInfo} from '../server/payments/providers.js';
type Client={call:(path:string,body?:any,method?:string,headers?:Record<string,string>)=>Promise<{status:number;data:any}>};
export async function testPaymentSettings(admin:Client,vendor:Client,otherVendor:Client,guest:Client){
 assert.match(process.env.SQL_DATABASE||'',/^ShopwizeTest_\d+$/);
 const originalControls=await query('SELECT * FROM ProviderSettings');
 const oldFetch=globalThis.fetch;
 const adminId=(await query("SELECT id FROM Users WHERE email='admin@shopwize.test'"))[0].id;
 const vendorId=(await vendor.call('/vendor/dashboard')).data.vendor.id;
 const otherId=(await otherVendor.call('/vendor/dashboard')).data.vendor.id;
 const secret='sk_test_AppConfiguration123',webhook='whsec_configuration_fixture';
 try{
  assert.equal((await guest.call('/admin/payment-settings')).status,401);
  assert.equal((await vendor.call('/admin/payment-settings')).status,403);
  assert.equal((await vendor.call('/admin/payment-settings/stripe',{version:0,values:{}},'PUT')).status,403);
  const initial=(await admin.call('/admin/payment-settings')).data;
  let stripe={version:initial.scopes.stripe.version,values:{...initial.scopes.stripe.values,STRIPE_CONNECT_MODEL:'separate_charges_and_transfers'},secrets:{STRIPE_SECRET_KEY:secret,STRIPE_WEBHOOK_SECRET:webhook},enabled:false,currencies:['USD']};
  let result=await admin.call('/admin/payment-settings/stripe',stripe,'PUT');assert.equal(result.status,200,JSON.stringify(result.data));
  let view=(await admin.call('/admin/payment-settings')).data;
  assert.equal(view.scopes.stripe.secretStatus.STRIPE_SECRET_KEY.configured,true);
  assert(!JSON.stringify(view).includes(secret));assert(!JSON.stringify(view).includes(webhook));
  const stored=(await query("SELECT * FROM PaymentConfiguration WHERE scope='stripe'"))[0];
  assert(!stored.secrets.includes(secret));assert(!stored.settings.includes(secret));
  assert(!JSON.stringify(await query("SELECT data FROM AuditEvents WHERE action='payment.configuration'")).includes(secret));
  assert.equal((await guest.call('/bootstrap')).data.providers.find((p:any)=>p.id==='stripe').available,false);
  assert.equal((await admin.call('/admin/payment-settings/stripe',stripe,'PUT')).status,409,'Stale forms must not overwrite credentials');
  stripe={...stripe,version:view.scopes.stripe.version,secrets:{STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},enabled:true};
  assert.equal((await admin.call('/admin/payment-settings/stripe',stripe,'PUT')).status,200);
  assert.equal(withPaymentSettings(await loadPaymentSettings(),()=>paymentValue('STRIPE_SECRET_KEY')),secret,'Blank credentials must preserve the saved secret');
  assert.equal((await guest.call('/bootstrap')).data.providers.find((p:any)=>p.id==='stripe').available,true);
  const fresh=await loadPaymentSettings();
  assert.equal(withPaymentSettings(fresh,()=>providerInfo().find(p=>p.id==='stripe')!.available),true,'A worker loading settings must see saved configuration');

  // Subscriptions need the original provider mode even without seller/order records.
  assert.equal((await query("SELECT (SELECT COUNT(*) FROM Orders WHERE provider='stripe')+(SELECT COUNT(*) FROM ProviderAccounts WHERE provider='stripe') AS n"))[0].n,0);
  const subscriptionId=randomUUID();
  await query("INSERT INTO Subscriptions(id,vendorId,providerId,[plan],state) VALUES(@id,@vendor,'sub_configuration_fixture','growth','active')",{id:subscriptionId,vendor:vendorId});
  try{
    const current=(await admin.call('/admin/payment-settings')).data.scopes.stripe;
    const switchMode={...stripe,version:current.version,values:{...current.values,STRIPE_MODE:'live'},secrets:{STRIPE_SECRET_KEY:'sk_live_configurationfixture'}};
    assert.equal((await admin.call('/admin/payment-settings/stripe',switchMode,'PUT')).status,409,'Existing subscriptions must block switching provider mode');
  }finally{await query('DELETE FROM Subscriptions WHERE id=@id',{id:subscriptionId});}

  const policy={...initial.scopes.marketplace.values,OPERATING_COUNTRY:'US',SELLER_COUNTRIES:'US,CA',TAX_RATE_BPS:'825',TAX_CONFIGURATION_CONFIRMED:'true',LIVE_INTEGRATION_VERIFIED:'false'};
  assert.equal((await admin.call('/admin/payment-settings/marketplace',{version:0,values:policy},'PUT')).status,200);
  assert.equal(withPaymentSettings(await loadPaymentSettings(),()=>paymentPolicy().taxBps),825);
  view=(await admin.call('/admin/payment-settings')).data;
  assert.equal(view.liveReady,false);
  assert.equal((await admin.call('/admin/payment-settings/marketplace',{version:view.scopes.marketplace.version,values:{...policy,TAX_RATE_BPS:'10001'}},'PUT')).status,400);
  await query("UPDATE Users SET role='host_finance' WHERE id=@id",{id:adminId});
  assert.equal((await admin.call('/admin/payment-settings')).status,403);
  assert.equal((await admin.call('/admin/payment-settings/stripe',stripe,'PUT')).status,403);
  await query("UPDATE Users SET role='host_admin' WHERE id=@id",{id:adminId});

  const paypalValues={...initial.scopes.paypal.values,PAYPAL_PARTNER_ID:'partner-fixture',PAYPAL_WEBHOOK_ID:'webhook-fixture',PAYPAL_FEE_REFUNDS_ENABLED:'true'};
  const payload={version:0,values:paypalValues,secrets:{PAYPAL_CLIENT_ID:'client-fixture',PAYPAL_CLIENT_SECRET:'paypal-secret-fixture'},enabled:true,currencies:['USD']};
  // The tax fixture already created PayPal payment history. Keep its existing
  // partner identity while configuring the credentials used by this fixture.
  payload.values.PAYPAL_PARTNER_ID=process.env.PAYPAL_PARTNER_ID||'';
  assert.equal((await admin.call('/admin/payment-settings/paypal',payload,'PUT')).status,200);
  view=(await admin.call('/admin/payment-settings')).data;
  assert.equal((await admin.call('/admin/payment-settings/paypal',{...payload,version:view.scopes.paypal.version,values:{...payload.values,PAYPAL_ENVIRONMENT:'live'}},'PUT')).status,409,'Mode changes must preserve access to existing payments');
  assert.equal((await admin.call('/admin/payment-settings/paypal',{...payload,version:view.scopes.paypal.version,secrets:{PAYPAL_CLIENT_SECRET:null}},'PUT')).status,409);
  let tokenRequests=0,merchantTracking=vendorId;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin==='https://api-m.sandbox.paypal.com'){
      if(url.pathname==='/v1/oauth2/token'){
        tokenRequests++;assert.equal((init?.headers as Record<string,string>).Authorization,'Basic '+Buffer.from('client-fixture:paypal-secret-fixture').toString('base64'));
        return new Response(JSON.stringify({access_token:'fixture-token'}),{status:200});
      }
      if(url.pathname.includes('/merchant-integrations'))return new Response(JSON.stringify({merchant_id:'preference-fixture',tracking_id:merchantTracking,payments_receivable:true,primary_email_confirmed:true}),{status:200});
      throw new Error('Unexpected provider request');
    }
    return oldFetch(input,init);
  };
  result=await admin.call('/admin/payment-settings/paypal/test',{});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(tokenRequests,1);

  const ownerView=await vendor.call('/vendor/payment-settings');assert.equal(ownerView.status,200);assert.equal(ownerView.data.canEdit,true);
  const otherBefore=(await otherVendor.call('/vendor/payment-settings')).data;
  assert.equal((await vendor.call('/vendor/payment-settings/paypal',{enabled:false},'PUT')).status,200);
  assert.equal((await vendor.call('/vendor/payment-settings')).data.accounts.find((p:any)=>p.provider==='paypal').enabled,false);
  assert.deepEqual((await otherVendor.call('/vendor/payment-settings')).data.accounts,otherBefore.accounts);
  assert.equal((await query('SELECT COUNT(*) AS n FROM VendorPaymentPreferences WHERE vendorId=@vendor',{vendor:otherId}))[0].n,0);
  assert.equal((await vendor.call('/vendor/payment-settings/paypal',{enabled:true,vendorId:otherId},'PUT')).status,400);
  await query("UPDATE VendorMembers SET role='finance' WHERE vendorId=@vendor AND userId=(SELECT ownerId FROM Vendors WHERE id=@vendor)",{vendor:vendorId});
  assert.equal((await vendor.call('/vendor/payment-settings')).data.canEdit,false);
  assert.equal((await vendor.call('/vendor/payment-settings/paypal',{enabled:true},'PUT')).status,403);
  assert.equal((await vendor.call('/vendor/payment-settings/paypal/manage',{})).status,403);
  await query("UPDATE VendorMembers SET role='owner' WHERE vendorId=@vendor AND userId=(SELECT ownerId FROM Vendors WHERE id=@vendor)",{vendor:vendorId});
  const account=(await query("SELECT id FROM ProviderAccounts WHERE vendorId=@vendor AND provider='paypal'",{vendor:vendorId}))[0];
  if(!account)await query("INSERT INTO ProviderAccounts(id,vendorId,provider,externalId,chargesEnabled,payoutsEnabled) VALUES(@id,@vendor,'paypal','preference-fixture',1,1)",{id:randomUUID(),vendor:vendorId});
  merchantTracking=otherId;
  assert.equal((await vendor.call('/vendor/payment-settings/paypal/refresh',{})).status,409,'A provider response for another store must not be accepted');
  merchantTracking=vendorId;
  result=await vendor.call('/vendor/payment-settings/paypal/refresh',{});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.chargesEnabled,true);assert.equal(result.data.payoutsEnabled,true);
  const refreshed=(await vendor.call('/vendor/payment-settings')).data.accounts.find((a:any)=>a.provider==='paypal');assert.equal(refreshed.enabled,false,"Refreshing verification must preserve the owner's acceptance preference");assert.equal(refreshed.connected,true);
  result=await vendor.call('/vendor/payment-settings/paypal/manage',{});assert.equal(result.status,200);assert.match(result.data.url,/^https://www.sandbox.paypal.com//);
  assert.equal((await vendor.call('/vendor/payment-settings',{country:'CA'},'PUT')).status,409);
  assert.equal((await vendor.call('/vendor/payment-settings/paypal',{enabled:true},'PUT')).status,200);

  // Corruption must disable payments without making the rest of the app fail.
  await query("UPDATE PaymentConfiguration SET secrets=@secrets WHERE scope='stripe'",{secrets:{STRIPE_SECRET_KEY:'corrupt'}});
  result=await guest.call('/bootstrap');assert.equal(result.status,200);assert.equal(result.data.providers.find((p:any)=>p.id==='stripe').available,false);
  assert((await admin.call('/admin/payment-settings')).data.errors.includes('stripe'));
  await query("UPDATE PaymentConfiguration SET secrets=@secrets WHERE scope='stripe'",{secrets:parse(stored.secrets)});
 }finally{
  globalThis.fetch=oldFetch;
  await query("UPDATE Users SET role='host_admin' WHERE id=@id",{id:adminId});
  await query("UPDATE VendorMembers SET role='owner' WHERE vendorId=@vendor AND userId=(SELECT ownerId FROM Vendors WHERE id=@vendor)",{vendor:vendorId});
  await query('DELETE FROM PaymentConfiguration');await query('DELETE FROM ProviderSettings');
  for(const row of originalControls)await query('INSERT INTO ProviderSettings(provider,enabled,currencies) VALUES(@provider,@enabled,@currencies)',{provider:row.provider,enabled:!!row.enabled,currencies:row.currencies});
 }
}
