import {deliveryMethods} from './shipping.js';
import { query, transaction, parse, type Db } from '../db.js';
import { config } from '../config.js';
import { amount, minor, percent, allocate, resolveRule, type Rule } from '../money.js';
import { id, token, hash, assert } from '../util.js';
import { provider, type Capture } from '../payments/providers.js';
export type Address={name:string;email:string;line1:string;line2?:string;city:string;region:string;postal:string;country:string};
export type QuoteInput={shipping?:Record<string,string>;coupon?:string;address?:Address};
export async function cartItems(cartId:string,target?:Db) {
 const rows=await query(`SELECT ci.quantity,p.id AS productId,p.vendorId,p.name,p.category,p.currency,p.status,p.image,p.data AS productData,pv.id AS variantId,pv.label,pv.sku,CAST(pv.price AS varchar(32)) AS price,CAST(pv.regularPrice AS varchar(32)) AS regularPrice,pv.stock-pv.reserved AS available,v.name AS vendorName,v.slug,v.status AS vendorStatus,v.paymentEligible,v.data AS vendorData FROM CartItems ci JOIN ProductVariants pv ON pv.id=ci.variantId JOIN Products p ON p.id=pv.productId JOIN Vendors v ON v.id=p.vendorId WHERE ci.cartId=@cart ORDER BY v.id,pv.id`,{cart:cartId},target);
 return rows;
}
export async function quote(cartId:string,input:QuoteInput,target?:Db){
 const items=await cartItems(cartId,target); assert(items.length,'Your bag is empty.');assert(items.length<=100,'Too many items in one checkout.');
 const currencies=new Set(items.map(i=>i.currency));assert(currencies.size===1,'These items use different currencies. Please check out one currency at a time.');const currency=items[0].currency;
 for(const item of items){assert(item.status==='published'&&item.vendorStatus==='approved'&&item.paymentEligible,`${item.name} is not currently available to buy.`);assert(item.available>=item.quantity,`Only ${item.available} ${item.name} available. Please update your bag.`,409);}
 let coupon:any;
 if(input.coupon){coupon=(await query('SELECT *,CAST(fixedAmount AS varchar(40)) AS fixedAmountValue FROM Coupons WHERE code=@code AND active=1 AND (startsAt IS NULL OR startsAt<=SYSUTCDATETIME()) AND (endsAt IS NULL OR endsAt>SYSUTCDATETIME()) AND (maxUses IS NULL OR used<maxUses)',{code:input.coupon.toUpperCase()},target))[0];assert(coupon,'That discount code is invalid, expired or fully used.');}
 const rules=await query<Rule>('SELECT id,vendorId,category,bps,version FROM CommissionRules WHERE active=1',{},target);
 const prices=items.map(i=>minor(i.price,currency)*BigInt(i.quantity));const eligible=items.map((i,index)=>!coupon?.vendorId||coupon.vendorId===i.vendorId?prices[index]:0n);
 if(coupon?.ownerId){const cart=(await query('SELECT userId FROM Carts WHERE id=@id',{id:cartId},target))[0];assert(cart?.userId===coupon.ownerId,'This reward belongs to another account.');}
 if(coupon?.fixedAmount)assert(coupon.currency===currency,'This reward uses a different currency.');
 const eligibleTotal=eligible.reduce((a,b)=>a+b,0n);const fixed=coupon?.fixedAmount?minor(coupon.fixedAmountValue,currency):0n;
 const discounts=coupon?allocate(coupon.fixedAmount?(fixed<eligibleTotal?fixed:eligibleTotal):percent(eligibleTotal,coupon.bps),eligible):items.map(()=>0n);
 const lines=items.map((item,index)=>{const rule=resolveRule(rules,item.vendorId,item.category);const net=prices[index]-discounts[index];const tax=percent(net,config.taxBps);const commission=percent(net,rule.bps);return {...item,vendorData:undefined,productData:undefined,subtotal:amount(prices[index],currency),discount:amount(discounts[index],currency),net:amount(net,currency),tax:amount(tax,currency),commission:amount(commission,currency),total:amount(net+tax,currency),rule,returnPolicy:parse(item.productData).returnPolicy||'Returns within 30 days of delivery. Contact the store before returning.',processingTime:parse(item.productData).processingTime||'1–3 business days'};});
 const groups=[...new Set(items.map(i=>i.vendorId))].map(vendorId=>{
   const original=items.find(i=>i.vendorId===vendorId)!;const vendorLines=lines.filter(l=>l.vendorId===vendorId);const settings=parse(original.vendorData).shipping||{};
   const net=vendorLines.reduce((s,l)=>s+minor(l.net,currency),0n);const tax=vendorLines.reduce((s,l)=>s+minor(l.tax,currency),0n);
   const methods=deliveryMethods(settings,input.address,net,currency,original.vendorName);
   const selected=input.shipping?.[vendorId]||'standard';const method=methods.find(m=>m.id===selected);assert(method,`Choose a valid delivery method for ${original.vendorName}.`);
   const shipping=minor(method.price,currency);const commission=vendorLines.reduce((s,l)=>s+minor(l.commission,currency),0n);
   return {vendorId,vendorName:original.vendorName,slug:original.slug,lines:vendorLines,methods:methods.map(m=>({...m,price:amount(minor(m.price,currency),currency)})),method:selected,subtotal:amount(net,currency),tax:amount(tax,currency),shipping:amount(shipping,currency),commission:amount(commission,currency),vendorAmount:amount(BigInt(net)+shipping-BigInt(commission),currency),total:amount(net+tax+shipping,currency)};
 });
 const sum=(key:string)=>amount(groups.reduce((s,g)=>s+minor((g as any)[key],currency),0n),currency);
 return {currency,groups,subtotal:amount(prices.reduce((a,b)=>a+b,0n),currency),discount:amount(discounts.reduce((a,b)=>a+b,0n),currency),shipping:sum('shipping'),tax:sum('tax'),total:sum('total'),coupon:coupon?.code||null,taxConfigured:process.env.TAX_CONFIGURATION_CONFIRMED==='true'};
}
export async function createCheckout(cartId:string,userId:string|null,input:QuoteInput&{address:Address;provider:string;accessToken:string;referral?:string},key:string){
 const adapter=provider(input.provider);assert(adapter.capabilities().available,adapter.capabilities().reason,503);const settings=(await query('SELECT * FROM ProviderSettings WHERE provider=@provider',{provider:input.provider}))[0];assert(!settings||settings.enabled,'This provider is disabled for new checkouts.',503);
 const requestHash=hash(JSON.stringify({...input,address:{...input.address,email:input.address.email.toLowerCase()}}));
 const result=await transaction(async tx=>{
  const existing=(await query('SELECT * FROM Orders WITH(UPDLOCK,HOLDLOCK) WHERE idempotencyKey=@key',{key},tx))[0];
  if(existing){assert(existing.cartId===cartId&&existing.requestHash===requestHash,'This checkout key was already used for different details.',409);assert(existing.accessHash===hash(input.accessToken),'Invalid order access.',403);return {order:existing,attempt:(await query('SELECT * FROM PaymentAttempts WHERE orderId=@id',{id:existing.id},tx))[0]};}
  const q=await quote(cartId,input,tx);const orderId=id();if(settings){const currencies=parse<string[]>(settings.currencies,[]);assert(!currencies.length||currencies.includes(q.currency),'This provider is not enabled for the order currency.');}
  if(input.provider!=='mock'){
   const accounts=await query('SELECT vendorId,externalId FROM ProviderAccounts WHERE provider=@provider AND chargesEnabled=1 AND payoutsEnabled=1',{provider:input.provider},tx);
   for(const g of q.groups)assert(accounts.some(a=>a.vendorId===g.vendorId),`${g.vendorName} has not completed ${input.provider} payment setup.`);
  }
  if(q.coupon){const updated=await query('UPDATE Coupons WITH(UPDLOCK) SET used=used+1 OUTPUT inserted.code WHERE code=@code AND (maxUses IS NULL OR used<maxUses)',{code:q.coupon},tx);assert(updated.length,'That discount code was just fully used.',409);}
  await query("INSERT INTO Orders(id,cartId,userId,idempotencyKey,requestHash,currency,total,provider,address,snapshot,accessHash,accessExpiresAt,expiresAt) VALUES(@id,@cart,@user,@key,@hash,@currency,@total,@provider,@address,@snapshot,@access,DATEADD(day,30,SYSUTCDATETIME()),DATEADD(minute,35,SYSUTCDATETIME()))",{id:orderId,cart:cartId,user:userId,key,hash:requestHash,currency:q.currency,total:q.total,provider:input.provider,address:input.address,snapshot:q,access:hash(input.accessToken)},tx);
  for(const g of q.groups){const vendorOrderId=id();await query('INSERT INTO VendorOrders(id,orderId,vendorId,currency,total,commission,snapshot) VALUES(@id,@order,@vendor,@currency,@total,@commission,@snapshot)',{id:vendorOrderId,order:orderId,vendor:g.vendorId,currency:q.currency,total:g.total,commission:g.commission,snapshot:g},tx);
   for(const l of g.lines){
    const updated=await query('UPDATE ProductVariants WITH(UPDLOCK) SET reserved=reserved+@qty OUTPUT inserted.id WHERE id=@id AND stock-reserved>=@qty',{id:l.variantId,qty:l.quantity},tx);assert(updated.length,`${l.name} just sold out.`,409);
    await query('INSERT INTO InventoryReservations(id,orderId,variantId,quantity,expiresAt) VALUES(@id,@order,@variant,@qty,DATEADD(minute,35,SYSUTCDATETIME()))',{id:id(),order:orderId,variant:l.variantId,qty:l.quantity},tx);
    await query('INSERT INTO OrderItems(id,orderId,vendorOrderId,variantId,quantity,unitPrice,discount,tax,commission,snapshot) VALUES(@id,@order,@vendorOrder,@variant,@qty,@price,@discount,@tax,@commission,@snapshot)',{id:id(),order:orderId,vendorOrder:vendorOrderId,variant:l.variantId,qty:l.quantity,price:l.price,discount:l.discount,tax:l.tax,commission:l.commission,snapshot:l},tx);
   }
  }
  const attemptId=id();await query('INSERT INTO PaymentAttempts(id,orderId,provider) VALUES(@id,@order,@provider)',{id:attemptId,order:orderId,provider:input.provider},tx);
  if(input.referral){const ref=(await query('SELECT r.*,u.email FROM Referrals r JOIN Users u ON u.id=r.userId WHERE r.code=@code',{code:input.referral},tx))[0];if(ref && ref.userId!==userId && ref.email.toLowerCase()!==input.address.email.toLowerCase()){const buyerHash=hash(input.address.email.toLowerCase());if(!(await query('SELECT orderId FROM ReferralAttributions WHERE buyerHash=@hash',{hash:buyerHash},tx)).length)await query('INSERT INTO ReferralAttributions(orderId,referralId,buyerHash) VALUES(@order,@ref,@hash)',{order:orderId,ref:ref.id,hash:buyerHash},tx);}}
  return {order:{id:orderId,...q,provider:input.provider,address:JSON.stringify(input.address),snapshot:JSON.stringify(q)},attempt:{id:attemptId,state:'created'}};
 });
 if(result.attempt.state==='uncertain'&&result.attempt.createdAt)assert(Date.now()-new Date(result.attempt.createdAt).getTime()<30*60*1000,'The payment request needs provider reconciliation before it can be retried.',409);
 if(result.attempt.providerId) return {orderId:result.order.id,accessToken:input.accessToken,...parse(result.attempt.data),provider:input.provider};
 const groups=await query('SELECT vo.id,vo.snapshot,pa.externalId FROM VendorOrders vo LEFT JOIN ProviderAccounts pa ON pa.vendorId=vo.vendorId AND pa.provider=@provider WHERE vo.orderId=@id',{id:result.order.id,provider:input.provider});
 const q=parse(result.order.snapshot);
 try{const checkout=await adapter.createCheckout({id:result.order.id,currency:q.currency,total:q.total,email:input.address.email,accessToken:input.accessToken,groups:groups.map(g=>({id:g.id,total:parse(g.snapshot).total,commission:parse(g.snapshot).commission,account:g.externalId}))});
 await query('UPDATE PaymentAttempts SET providerId=@providerId,state=@state,data=@data WHERE id=@id',{id:result.attempt.id,providerId:checkout.id,state:checkout.state,data:checkout});return {orderId:result.order.id,accessToken:input.accessToken,provider:input.provider,...checkout};}
 catch(error){await query("UPDATE PaymentAttempts SET state='uncertain' WHERE id=@id",{id:result.attempt.id});throw error;}
}
export async function requireOrderAccess(orderId:string,access:string|undefined,userId?:string){const o=(await query('SELECT * FROM Orders WHERE id=TRY_CONVERT(uniqueidentifier,@id)',{id:orderId}))[0];assert(o,'Order not found.',404);const issued=access?(await query("SELECT id FROM AccessTokens WHERE tokenHash=@hash AND resourceId=@id AND purpose='order_access' AND expiresAt>SYSUTCDATETIME()",{hash:hash(access),id:orderId}))[0]:null;assert((access&&hash(access)===o.accessHash&&new Date(o.accessExpiresAt)>new Date())||issued||(userId&&userId===o.userId),'This order link is invalid or expired.',403);return o;}
export async function orderDetails(order:any){const groups=await query('SELECT vo.*,s.carrier,s.tracking,s.state AS shipmentState FROM VendorOrders vo OUTER APPLY(SELECT TOP 1 * FROM Shipments WHERE vendorOrderId=vo.id ORDER BY createdAt DESC)s WHERE vo.orderId=@id',{id:order.id});const items=await query('SELECT id,vendorOrderId,quantity,refundedQuantity,snapshot FROM OrderItems WHERE orderId=@id',{id:order.id});return {id:order.id,createdAt:order.createdAt,currency:order.currency,paymentState:order.paymentState,state:order.state,provider:order.provider,address:parse(order.address),...parse(order.snapshot),groups:groups.map(g=>({id:g.id,...parse(g.snapshot),paymentState:g.paymentState,fulfillmentState:g.fulfillmentState,carrier:g.carrier,tracking:g.tracking,lines:items.filter(i=>i.vendorOrderId===g.id).map(i=>({id:i.id,refundedQuantity:i.refundedQuantity,...parse(i.snapshot)}))})),returns:await query('SELECT id,orderItemId,quantity,reason,state FROM Returns WHERE orderId=@id',{id:order.id})};}
export async function applyCaptures(orderId:string,providerName:string,captures:Capture[]){
 return transaction(async tx=>{
  const order=(await query('SELECT * FROM Orders WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id:orderId},tx))[0];assert(order&&order.provider===providerName,'Payment order mismatch.');
  for(const c of captures){if(c.state!=='paid')continue;
   const existing=await query("SELECT id FROM PaymentTransactions WHERE provider=@provider AND externalId=@external AND kind='capture'",{provider:providerName,external:c.externalId},tx);if(existing.length)continue;
   const groups=await query('SELECT * FROM VendorOrders WITH(UPDLOCK) WHERE orderId=@order AND (@vendorOrder IS NULL OR id=TRY_CONVERT(uniqueidentifier,@vendorOrder))',{order:orderId,vendorOrder:c.vendorOrderId||null},tx);assert(groups.length,'Unknown seller capture.');
   const expected=groups.reduce((s,g)=>s+minor(parse(g.snapshot).total,order.currency),0n);assert(c.currency===order.currency&&minor(c.amount,c.currency)===expected,'Provider amount or currency does not match the order.');
   await query("INSERT INTO PaymentTransactions(id,orderId,vendorOrderId,provider,externalId,kind,currency,amount,state,data) VALUES(@id,@order,@vo,@provider,@external,'capture',@currency,@amount,'succeeded',@data)",{id:id(),order:orderId,vo:c.vendorOrderId||null,provider:providerName,external:c.externalId,currency:c.currency,amount:c.amount,data:c},tx);
   for(const g of groups){if(g.paymentState==='paid')continue;
    const reservations=await query('SELECT r.* FROM InventoryReservations r JOIN OrderItems oi ON oi.variantId=r.variantId AND oi.orderId=r.orderId WHERE r.orderId=@order AND oi.vendorOrderId=@vo',{order:orderId,vo:g.id},tx);let needsAttention=false;
    for(const r of reservations){if(r.state==='consumed')continue;
      const changed=await query(r.state==='reserved'?'UPDATE ProductVariants SET stock=stock-@qty,reserved=reserved-@qty OUTPUT inserted.id WHERE id=@id AND reserved>=@qty AND stock>=@qty':'UPDATE ProductVariants SET stock=stock-@qty OUTPUT inserted.id WHERE id=@id AND stock-reserved>=@qty',{qty:r.quantity,id:r.variantId},tx);
      if(!changed.length){needsAttention=true;continue;}await query("UPDATE InventoryReservations SET state='consumed' WHERE id=@id",{id:r.id},tx);
      await query('INSERT INTO InventoryMovements(id,variantId,quantity,reason,source) VALUES(@id,@variant,@qty,@reason,@source)',{id:id(),variant:r.variantId,qty:-r.quantity,reason:'verified_capture',source:`capture:${g.id}:${r.variantId}`},tx);
    }
    await query("UPDATE VendorOrders SET paymentState='paid',fulfillmentState=@state WHERE id=@id",{id:g.id,state:needsAttention?'needs_attention':'unfulfilled'},tx);
    const s=parse(g.snapshot);const total=minor(s.total,c.currency),commission=minor(s.commission,c.currency),tax=minor(s.tax,c.currency);const journal=id();
    const entries:[string,bigint][]=[['processor',total],['vendor_pending',-(total-tax-commission)],['host_commission',-commission],['tax_payable',-tax]];
    assert(entries.reduce((sum,[,n])=>sum+n,0n)===0n,'Unbalanced capture journal.');
    for(const [account,n] of entries)await query('INSERT INTO LedgerEntries(id,journalId,vendorId,orderId,account,currency,amount,source) VALUES(@id,@journal,@vendor,@order,@account,@currency,@amount,@source)',{id:id(),journal,vendor:g.vendorId,order:orderId,account,currency:c.currency,amount:amount(n,c.currency),source:`capture:${g.id}`},tx);
    if(providerName==='stripe'&&!needsAttention){await query("INSERT INTO Transfers(id,vendorOrderId,provider,amount,currency,data) VALUES(@id,@vo,'stripe',@amount,@currency,@data)",{id:id(),vo:g.id,amount:s.vendorAmount,currency:c.currency,data:{sourceCharge:c.sourceCharge}},tx);}
    await query("INSERT INTO OutboxMessages(id,type,source,data) VALUES(@id,'vendor_order',@source,@data)",{id:id(),source:`vendor_order:${g.id}`,data:{vendorId:g.vendorId,orderId,vendorOrderId:g.id,needsAttention}},tx);
   }
  }
  const states=await query('SELECT paymentState,fulfillmentState FROM VendorOrders WHERE orderId=@id',{id:orderId},tx);const paid=states.filter(s=>s.paymentState==='paid').length;const state=paid===states.length?'paid':paid?'partially_paid':'pending';
  await query('UPDATE Orders SET paymentState=@payment,state=@state WHERE id=@id',{id:orderId,payment:state,state:states.some(s=>s.fulfillmentState==='needs_attention')?'needs_attention':state==='paid'?'confirmed':'pending'},tx);
  if(state==='paid'&&order.paymentState!=='paid'){
   await query('DELETE ci FROM CartItems ci JOIN OrderItems oi ON oi.variantId=ci.variantId WHERE ci.cartId=@cart AND oi.orderId=@order AND ci.quantity=oi.quantity',{cart:order.cartId,order:orderId},tx);
   const accessToken=token();await query("INSERT INTO AccessTokens(id,tokenHash,purpose,email,resourceId,expiresAt) VALUES(@id,@hash,'order_access',@email,@order,DATEADD(day,30,SYSUTCDATETIME()))",{id:id(),hash:hash(accessToken),email:parse(order.address).email,order:orderId},tx);
   await query("INSERT INTO OutboxMessages(id,type,source,data) VALUES(@id,'email',@source,@data)",{id:id(),source:`confirmation:${orderId}`,data:{to:parse(order.address).email,subject:'Your Shopwize order is confirmed',text:`Order ${orderId} is confirmed. Track your order: ${config.origin}/order/${orderId}?access=${accessToken} . Support: ${config.origin}/support`}},tx);
   if(order.userId&&order.currency===config.currency){const snapshot=parse(order.snapshot);const points=Number((minor(snapshot.subtotal,order.currency)-minor(snapshot.discount,order.currency))/100n);await query('INSERT INTO LoyaltyTransactions(id,userId,orderId,points,source) VALUES(@id,@user,@order,@points,@source)',{id:id(),user:order.userId,order:orderId,points,source:`earn:${orderId}`},tx);}
   await query("UPDATE ReferralAttributions SET state='qualified' WHERE orderId=@id AND EXISTS(SELECT 1 FROM Users WHERE id=@user AND verified=1)",{id:orderId,user:order.userId||null},tx);
  }
  return state;
 });
}
export async function releaseOrder(orderId:string,state='expired'){
 await transaction(async tx=>{
  const o=(await query('SELECT * FROM Orders WITH(UPDLOCK) WHERE id=@id',{id:orderId},tx))[0];if(!o)return;
  const rows=await query("SELECT r.* FROM InventoryReservations r JOIN OrderItems oi ON oi.orderId=r.orderId AND oi.variantId=r.variantId JOIN VendorOrders vo ON vo.id=oi.vendorOrderId WHERE r.orderId=@id AND r.state='reserved' AND vo.paymentState<>'paid'",{id:orderId},tx);
  for(const r of rows){await query('UPDATE ProductVariants SET reserved=reserved-@qty WHERE id=@id',{id:r.variantId,qty:r.quantity},tx);await query("UPDATE InventoryReservations SET state='released' WHERE id=@id",{id:r.id},tx);}
  if(o.paymentState!=='paid'&&o.paymentState!=='partially_paid'&&!['failed','expired'].includes(o.state)){await query('UPDATE Orders SET paymentState=@state,state=@state WHERE id=@id',{id:orderId,state},tx);if(parse(o.snapshot).coupon)await query('UPDATE Coupons SET used=CASE WHEN used>0 THEN used-1 ELSE 0 END WHERE code=@code',{code:parse(o.snapshot).coupon},tx);}
 });
}
