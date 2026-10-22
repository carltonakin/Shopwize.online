import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {platformAllocation, verifyPayPalAllocation} from '../server/payments/allocation.js';
import {paypal, type CheckoutInput} from '../server/payments/providers.js';

vi.mock('../server/config.js', () => ({config: {checkoutOrigin: 'https://shopwize.example', liveReady: false}}));

const order: CheckoutInput = {
  id: 'order-test', currency: 'USD', total: '173.00', accessToken: 'test-access', email: 'buyer@example.test',
  groups: [
    {id: 'vendor-order-a', total: '118.00', commission: '10.00', tax: '8.00', account: 'seller-a'},
    {id: 'vendor-order-b', total: '55.00', commission: '5.00', tax: '0.00', account: 'seller-b'},
  ],
};
const refund = {captureId: 'capture-test', amount: '59.00', commission: '5.00', tax: '4.00', currency: 'USD', key: 'refund-test', account: 'seller-a'};
const fetchMock = vi.fn<typeof fetch>();
function respond(data: unknown) {return new Response(JSON.stringify(data), {status: 200});}
function mockPayPal(data: unknown) {
  fetchMock.mockResolvedValueOnce(respond({access_token: 'fixture-token'})).mockResolvedValueOnce(respond(data));
}
function requestBody() {return JSON.parse(fetchMock.mock.calls[1][1]?.body as string);}

beforeEach(() => {
  vi.stubEnv('PAYPAL_CLIENT_ID', 'fixture-client');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('PAYPAL_PARTNER_ID', 'fixture-platform');
  vi.stubEnv('PAYPAL_WEBHOOK_ID', 'fixture-webhook');
  vi.stubEnv('PAYPAL_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PAYPAL_FEE_REFUNDS_ENABLED', 'true');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe('PayPal tax retained by Shopwize', () => {
  it('allocates commission plus tax for each seller without increasing the customer total', async () => {
    mockPayPal({id: 'paypal-order', links: [{rel: 'approve', href: 'https://paypal.example/checkout'}]});
    await paypal.createCheckout(order);
    const units = requestBody().purchase_units;
    expect(units.map((u: any) => u.amount.value)).toEqual(['118.00', '55.00']);
    expect(units.map((u: any) => u.payment_instruction.platform_fees[0].amount.value)).toEqual(['18.00', '5.00']);
    expect(units[0].payment_instruction.platform_fees[0].payee.merchant_id).toBe('fixture-platform');
    expect(units.map((u: any) => u.payee.merchant_id)).toEqual(['seller-a', 'seller-b']);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({'PayPal-Request-Id': 'create:order-test'});
  });
  it.each([
    ['zero tax', 'USD', '10.00', '0.00', '10.00'],
    ['zero commission', 'USD', '0.00', '8.00', '8.00'],
    ['fractional amounts', 'USD', '0.10', '0.20', '0.30'],
    ['zero-decimal currency', 'JPY', '100', '80', '180'],
  ])('preserves exact allocation with %s', async (_label, currency, commission, tax, expected) => {
    mockPayPal({id: 'paypal-order'});
    await paypal.createCheckout({...order, currency, total: '1000', groups: [{...order.groups[0], total: '1000', commission, tax}]});
    expect(requestBody().purchase_units[0].payment_instruction.platform_fees[0].amount).toEqual({currency_code: currency, value: expected});
  });
  it('returns commission and tax from the platform on a partial refund', async () => {
    mockPayPal({id: 'refund-id', status: 'COMPLETED'});
    expect(await paypal.refund(refund)).toEqual({id: 'refund-id', state: 'succeeded'});
    expect(requestBody()).toEqual({amount: {currency_code: 'USD', value: '59.00'}, payment_instruction: {platform_fees: [{amount: {currency_code: 'USD', value: '9.00'}}]}});
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({'PayPal-Request-Id': 'refund-test'});
  });
  it('keeps zero-tax refunds unchanged', async () => {
    mockPayPal({id: 'refund-id', status: 'COMPLETED'});
    await paypal.refund({...refund, tax: '0.00'});
    expect(requestBody().payment_instruction.platform_fees[0].amount.value).toBe('5.00');
  });
  it('keeps platform-fee refund approval mandatory', async () => {
    vi.stubEnv('PAYPAL_FEE_REFUNDS_ENABLED', 'false');
    await expect(paypal.refund(refund)).rejects.toThrow('platform-fee refund approval');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['capture', 'reconcile'] as const)('preserves provider-reported platform fees during %s', async method => {
    mockPayPal({purchase_units: [{reference_id: 'vendor-order-a', payments: {captures: [{id: 'capture-id', status: 'COMPLETED', amount: {currency_code: 'USD', value: '118.00'}, seller_receivable_breakdown: {platform_fees: [{amount: {currency_code: 'USD', value: '18.00'}}]}}]}}]});
    expect((await paypal[method]('paypal-order'))[0]).toMatchObject({vendorOrderId: 'vendor-order-a', state: 'paid', platformFees: [{amount: '18.00', currency: 'USD'}]});
  });
  it('accepts the reported allocation that matches commission and tax', () => {
    expect(() => verifyPayPalAllocation([{amount: '18.00', currency: 'USD'}], order.groups[0], 'USD')).not.toThrow();
  });
  it.each([
    ['commission only', [{amount: '10.00', currency: 'USD'}]],
    ['missing allocation', undefined],
    ['over-allocation', [{amount: '19.00', currency: 'USD'}]],
    ['wrong currency', [{amount: '18.00', currency: 'EUR'}]],
    ['negative allocation', [{amount: '-18.00', currency: 'USD'}]],
  ])('rejects %s instead of recording an incorrect ledger', (_label, fees) => {
    expect(() => verifyPayPalAllocation(fees, order.groups[0], 'USD')).toThrow('PayPal platform allocation');
  });
  it('accepts a missing fee only when neither commission nor tax is retained', () => {
    expect(() => verifyPayPalAllocation(undefined, {total: '10.00', commission: '0.00', tax: '0.00'}, 'USD')).not.toThrow();
  });
  it('rejects allocations greater than the customer payment', () => {
    expect(() => platformAllocation({total: '10.00', commission: '9.00', tax: '2.00'}, 'USD')).toThrow('Invalid platform');
  });
});
