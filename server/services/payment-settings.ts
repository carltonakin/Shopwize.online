import {Router} from 'express';
import {z} from 'zod';
import {admin,vendorScope,audit} from '../auth.js';
import {query} from '../db.js';
import {assert,AppError} from '../util.js';
import {paymentSettingsView,savePaymentSettings} from '../payments/settings.js';
import {providerInfo,stripeClient,paypalAccess} from '../payments/providers.js';
import {paymentPolicy,paymentValue} from '../payments/runtime.js';
import {refreshVendorPaymentAccount,syncVendorPaymentEligibility,vendorPaymentView} from '../payments/vendors.js';
export const paymentSettings=Router();
const providerName=z.enum(['stripe','paypal']);
paymentSettings.get('/admin/payment-settings',async(req,res)=>{
  admin(req);res.set('Cache-Control','no-store');res.json({...await paymentSettingsView(),providers:providerInfo(),liveReady:paymentPolicy().liveReady});
});
paymentSettings.put('/admin/payment-settings/:scope',async(req,res)=>{
  const actor=admin(req),scope=z.enum(['marketplace','stripe','paypal']).parse(req.params.scope);
  await savePaymentSettings(scope,req.body,actor.id);res.json({ok:true});
});
paymentSettings.post('/admin/payment-settings/:provider/test',async(req,res)=>{
  const actor=admin(req),name=providerName.parse(req.params.provider);
  let result;
  try{
    if(name==='stripe'){const account=await stripeClient().accounts.retrieve();result={accountId:account.id,message:'Stripe credentials verified. Webhook delivery and seller onboarding still require testing.'};}
    else{await paypalAccess();result={message:'PayPal credentials verified. Partner approval, webhook delivery and fee refunds still require testing.'};}
  }catch{throw new AppError(502,'Could not verify '+name+' credentials. Check the saved account and mode, then try again.');}
  await audit(actor.id,'payment.connection_test',name);res.json(result);
});
paymentSettings.get('/vendor/payment-settings',async(req,res)=>{
  const vendor=await vendorScope(req);assert(['owner','manager','finance'].includes(vendor.memberRole),'Your role cannot view payment settings.',403);
  res.set('Cache-Control','no-store');res.json({canEdit:vendor.memberRole==='owner',country:vendor.country,accounts:await vendorPaymentView(vendor.id),providers:providerInfo().filter(p=>['stripe','paypal'].includes(p.id))});
});
paymentSettings.put('/vendor/payment-settings',async(req,res)=>{
 const vendor=await vendorScope(req);assert(vendor.memberRole==='owner','Only the store owner can manage payments.',403);
 const {country}=z.object({country:z.string().regex(/^[A-Z]{2}$/)}).strict().parse(req.body);
 const accounts=await query('SELECT id FROM ProviderAccounts WHERE vendorId=@vendor',{vendor:vendor.id});
 assert(!accounts.length||country===vendor.country,'Business country cannot change after connecting a payment account.',409);
 const allowed=(paymentValue('SELLER_COUNTRIES')||'').split(',').map(c=>c.trim()).filter(Boolean);
 assert(!allowed.length||allowed.includes(country),'Shopwize does not currently support sellers in that country.');
 await query('UPDATE Vendors SET country=@country WHERE id=@id',{id:vendor.id,country});
 await audit(req.user!.id,'vendor.payment_country',vendor.id,{country},vendor.id);res.json({ok:true});
});
paymentSettings.put('/vendor/payment-settings/:provider',async(req,res)=>{
  const vendor=await vendorScope(req);assert(vendor.memberRole==='owner','Only the store owner can manage payments.',403);
  const provider=providerName.parse(req.params.provider),input=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await query('IF EXISTS(SELECT 1 FROM VendorPaymentPreferences WHERE vendorId=@vendor AND provider=@provider) UPDATE VendorPaymentPreferences SET enabled=@enabled,updatedAt=SYSUTCDATETIME() WHERE vendorId=@vendor AND provider=@provider ELSE INSERT INTO VendorPaymentPreferences(vendorId,provider,enabled) VALUES(@vendor,@provider,@enabled)',{vendor:vendor.id,provider,enabled:input.enabled});
  await syncVendorPaymentEligibility(vendor.id);await audit(req.user!.id,'vendor.payment_preference',provider,input,vendor.id);res.json({ok:true});
});
paymentSettings.post('/vendor/payment-settings/:provider/refresh',async(req,res)=>{
  const vendor=await vendorScope(req);assert(vendor.memberRole==='owner','Only the store owner can manage payments.',403);
  const provider=providerName.parse(req.params.provider);res.json(await refreshVendorPaymentAccount(vendor.id,provider));
});
paymentSettings.post('/vendor/payment-settings/:provider/manage',async(req,res)=>{
  const vendor=await vendorScope(req);assert(vendor.memberRole==='owner','Only the store owner can manage payouts.',403);
  const provider=providerName.parse(req.params.provider);
  const account=(await query('SELECT externalId FROM ProviderAccounts WHERE vendorId=@vendor AND provider=@provider',{vendor:vendor.id,provider}))[0];assert(account,'Connect this payment account first.',409);
  if(provider==='stripe')res.json({url:(await stripeClient().accounts.createLoginLink(account.externalId)).url});
  else res.json({url:paymentValue('PAYPAL_ENVIRONMENT')==='live'?'https://www.paypal.com/businessmanage/account/aboutBusiness':'https://www.sandbox.paypal.com/businessmanage/account/aboutBusiness'});
});
