import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../server/config.js';
import {query, parse} from '../server/db.js';
import {minor} from '../server/money.js';
import {paypal} from '../server/payments/providers.js';
import {createCheckout, applyCaptures} from '../server/services/checkout.js';
import {requestReturn, prepareRefund, processRefund} from '../server/services/returns.js';

// Runs only in the disposable SQL database created by integration-test.ts.
// PayPal HTTP is intercepted; no provider credentials or money are used.
export async function testPayPalTax() {
  assert.match(process.env.SQL_DATABASE || '', /^ShopwizeTest_\d+$/);
  assert.equal(process.env.NODE_ENV, 'test');
  const oldTax = config.taxBps;
  const oldFetch = globalThis.fetch;
  const env = {PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'tax-fixture', PAYPAL_CLIENT_SECRET: 'fixture-only', PAYPAL_PARTNER_ID: 'platform-fixture', PAYPAL_WEBHOOK_ID: 'webhook-fixture', PAYPAL_FEE_REFUNDS_ENABLED: 'true'};
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  let checkoutBody: any;
  let checkoutRequests = 0;
  const refundBodies: any[] = [];
  const response = (body: unknown) => new Response(JSON.stringify(body), {status: 200});
  Object.assign(process.env, env);
  config.taxBps = 750;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api-m.sandbox.paypal.com', 'Unexpected network call in PayPal fixture');
    if (url.pathname === '/v1/oauth2/token') return response({access_token: 'fixture-token'});
    if (url.pathname === '/v2/checkout/orders' && init?.method === 'POST') {
      checkoutBody = JSON.parse(init.body as string);
      checkoutRequests++;
      return response({id: 'tax-fixture-order'});
    }
    if (['/v2/checkout/orders/tax-fixture-order', '/v2/checkout/orders/tax-fixture-order/capture'].includes(url.pathname)) {
      return response({purchase_units: checkoutBody.purchase_units.map((unit: any) => ({reference_id: unit.reference_id, payments: {captures: [{id: 'tax-capture-' + unit.reference_id, status: 'COMPLETED', amount: unit.amount, seller_receivable_breakdown: {platform_fees: unit.payment_instruction.platform_fees}}]}}))});
    }
    if (url.pathname.startsWith('/v2/payments/captures/') && url.pathname.endsWith('/refund')) {
      refundBodies.push(JSON.parse(init?.body as string));
      return response({id: 'tax-refund-' + refundBodies.length, status: 'COMPLETED'});
    }
    throw new Error('Unexpected PayPal fixture path: ' + url.pathname);
  };
  try {
    const vendors = await query("SELECT TOP 2 id FROM Vendors WHERE status='approved' AND paymentEligible=1 ORDER BY id");
    assert.equal(vendors.length, 2);
    const cartId = randomUUID();
    await query('INSERT INTO Carts(id) VALUES(@id)', {id: cartId});
    for (const [index, vendor] of vendors.entries()) {
      const product = randomUUID(), variant = randomUUID();
      await query("INSERT INTO Products(id,vendorId,name,category,currency,status) VALUES(@id,@vendor,'PayPal tax fixture','home','USD','published')", {id: product, vendor: vendor.id});
      await query("INSERT INTO ProductVariants(id,productId,sku,price,stock) VALUES(@id,@product,@sku,@price,10)", {id: variant, product, sku: 'tax-' + variant, price: index === 0 ? '19.99' : '10.01'});
      await query('INSERT INTO CartItems(cartId,variantId,quantity) VALUES(@cart,@variant,@quantity)', {cart: cartId, variant, quantity: index === 0 ? 3 : 2});
      await query("INSERT INTO ProviderAccounts(id,vendorId,provider,externalId,chargesEnabled,payoutsEnabled) VALUES(@id,@vendor,'paypal',@external,1,1)", {id: randomUUID(), vendor: vendor.id, external: 'seller-' + vendor.id});
    }
    const input = {provider: 'paypal', accessToken: randomUUID() + randomUUID(), coupon: 'WELCOME10', address: {name: 'PayPal Test', email: 'paypal-tax@example.test', line1: '123 Test Road', city: 'Test City', region: 'CA', postal: '90210', country: 'US'}};
    const key = randomUUID();
    const checkout = await createCheckout(cartId, null, input, key);
    await createCheckout(cartId, null, input, key);
    assert.equal(checkoutRequests, 1, 'Checkout replay must not create another provider order');
    const groups = await query('SELECT * FROM VendorOrders WHERE orderId=@id', {id: checkout.orderId});
    for (const group of groups) {
      const snapshot = parse(group.snapshot);
      const unit = checkoutBody.purchase_units.find((u: any) => u.reference_id === group.id);
      const platform = minor(unit.payment_instruction.platform_fees[0].amount.value);
      assert(minor(snapshot.tax) > 0n);
      assert.equal(platform, minor(snapshot.commission) + minor(snapshot.tax));
      assert.equal(minor(unit.amount.value) - platform, minor(snapshot.vendorAmount));
    }
    const captures = await paypal.capture('tax-fixture-order');
    assert.deepEqual(await paypal.reconcile('tax-fixture-order'), captures);
    const badCaptures = structuredClone(captures);
    const bad = badCaptures[1];
    bad.platformFees = [{amount: parse(groups.find(g => g.id === bad.vendorOrderId)!.snapshot).commission, currency: 'USD'}];
    await assert.rejects(applyCaptures(checkout.orderId, 'paypal', badCaptures), /does not match commission and tax/);
    assert.equal((await query('SELECT COUNT(*) AS n FROM PaymentTransactions WHERE orderId=@id', {id: checkout.orderId}))[0].n, 0, 'Mismatched allocation must roll back every capture');
    assert.equal((await query('SELECT COUNT(*) AS n FROM LedgerEntries WHERE orderId=@id', {id: checkout.orderId}))[0].n, 0);
    assert.equal(await applyCaptures(checkout.orderId, 'paypal', captures), 'paid');
    const count = (await query('SELECT COUNT(*) AS n FROM LedgerEntries WHERE orderId=@id', {id: checkout.orderId}))[0].n;
    await applyCaptures(checkout.orderId, 'paypal', captures);
    assert.equal((await query('SELECT COUNT(*) AS n FROM LedgerEntries WHERE orderId=@id', {id: checkout.orderId}))[0].n, count);
    const ledger = await query('SELECT account,CAST(amount AS varchar(40)) AS value FROM LedgerEntries WHERE orderId=@id', {id: checkout.orderId});
    assert.equal(ledger.reduce((sum, row) => sum + minor(row.value), 0n), 0n);
    assert.equal(ledger.filter(r => r.account === 'tax_payable').reduce((sum, r) => sum - minor(r.value), 0n), groups.reduce((sum, g) => sum + minor(parse(g.snapshot).tax), 0n));

    // Three separate unit refunds must reverse historical cents exactly, even
    // after the configured rate changes. Shipping is not part of item returns.
    const group = groups.find(g => g.vendorId === vendors[0].id)!;
    const item = (await query('SELECT * FROM OrderItems WHERE vendorOrderId=@id', {id: group.id}))[0];
    const itemSnapshot = parse(item.snapshot);
    const captured = (await query('SELECT id,data FROM PaymentTransactions WHERE vendorOrderId=@id', {id: group.id}))[0];
    config.taxBps = 2000;
    for (let index = 0; index < 3; index++) {
      const returned = await requestReturn(checkout.orderId, {itemId: item.id, quantity: 1, reason: 'Tax allocation regression fixture'});
      await query("UPDATE Returns SET state='received' WHERE id=@id", {id: returned.id});
      const refundId = await prepareRefund(returned.id);
      assert.equal(await prepareRefund(returned.id), refundId);
      if (index === 0) {
        await query("UPDATE PaymentTransactions SET data='{}' WHERE id=@id", {id: captured.id});
        await assert.rejects(processRefund(refundId), /does not match commission and tax/);
        assert.equal(refundBodies.length, 0, 'Unverified legacy tax allocation must not initiate a refund');
        assert.equal((await query('SELECT state FROM Refunds WHERE id=@id', {id: refundId}))[0].state, 'reconcile_required');
        await query('UPDATE PaymentTransactions SET data=@data WHERE id=@id', {id: captured.id, data: captured.data});
        await query("UPDATE Refunds SET state='pending' WHERE id=@id", {id: refundId});
      }
      await processRefund(refundId);
      await processRefund(refundId);
      assert.equal(refundBodies.length, index + 1, 'Refund replay must not submit a second refund');
    }
    assert.equal(refundBodies.reduce((sum, r) => sum + minor(r.amount.value), 0n), minor(itemSnapshot.total));
    assert.equal(refundBodies.reduce((sum, r) => sum + minor(r.payment_instruction.platform_fees[0].amount.value), 0n), minor(itemSnapshot.commission) + minor(itemSnapshot.tax));
    const remaining = await query('SELECT account,CAST(SUM(amount) AS varchar(40)) AS value FROM LedgerEntries WHERE orderId=@order AND vendorId=@vendor GROUP BY account', {order: checkout.orderId, vendor: group.vendorId});
    assert.equal(minor(remaining.find(r => r.account === 'tax_payable')!.value), 0n);
    assert.equal(minor(remaining.find(r => r.account === 'host_commission')!.value), 0n);
    assert.equal(-minor(remaining.find(r => r.account === 'vendor_pending')!.value), minor(parse(group.snapshot).shipping));
    assert.equal(remaining.reduce((sum, r) => sum + minor(r.value), 0n), 0n);
  } finally {
    config.taxBps = oldTax;
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
