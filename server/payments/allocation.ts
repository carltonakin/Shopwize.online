import {amount, minor} from '../money.js';
import {assert} from '../util.js';

export type PlatformFee = {amount: string; currency: string};
type Allocation = {total: string; commission: string; tax: string};

// Tax is a platform liability, not commission revenue or vendor earnings.
export function platformAllocation(value: Allocation, currency: string): string {
  const commission = minor(value.commission, currency);
  const tax = minor(value.tax, currency);
  const total = minor(value.total, currency);
  assert(commission >= 0n && tax >= 0n && total >= commission + tax,
    'Invalid platform commission and tax allocation.');
  return amount(commission + tax, currency);
}

export function verifyPayPalAllocation(fees: PlatformFee[] | undefined, value: Allocation, currency: string) {
  const expected = minor(platformAllocation(value, currency), currency);
  assert((fees || []).every(fee => fee.currency === currency && minor(fee.amount, currency) >= 0n),
    'PayPal platform allocation currency or amount is invalid; reconcile the payment.', 409);
  const actual = (fees || []).reduce((sum, fee) => sum + minor(fee.amount, currency), 0n);
  assert(actual === expected,
    'PayPal platform allocation does not match commission and tax; reconcile the payment.', 409);
}
