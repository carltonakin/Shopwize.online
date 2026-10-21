import {describe,it,expect} from 'vitest';
import {minor,amount,percent,allocate,resolveRule,csvCell} from '../server/money.js';
describe('exact marketplace money',()=>{
 it('calculates the specified JMD commission without floating point',()=>{const subtotal=minor('10000.00','JMD');const commission=percent(subtotal,1000);expect(amount(commission,'JMD')).toBe('1000.00');expect(amount(subtotal-commission,'JMD')).toBe('9000.00');});
 it('handles zero and three-decimal currencies',()=>{expect(minor('1500','JPY')).toBe(1500n);expect(minor('1.234','KWD')).toBe(1234n);expect(amount(1234n,'KWD')).toBe('1.234');});
 it('keeps large amounts exact',()=>expect(amount(minor('999999999999.99'))).toBe('999999999999.99'));
 it('allocates every residual cent deterministically',()=>{expect(allocate(100n,[1n,1n,1n])).toEqual([34n,33n,33n]);expect(allocate(7n,[2n,3n])).toEqual([3n,4n]);});
 it('supports zero discounts',()=>expect(allocate(0n,[0n,0n])).toEqual([0n,0n]));
 it('uses precedence vendor-category > vendor > category > global',()=>{const base={version:1,bps:1000};const rules=[{...base,id:'global',vendorId:null,category:null},{...base,id:'category',vendorId:null,category:'home'},{...base,id:'vendor',vendorId:'v',category:null},{...base,id:'both',vendorId:'v',category:'home'}];expect(resolveRule(rules,'v','home').id).toBe('both');expect(resolveRule(rules,'v','other').id).toBe('vendor');expect(resolveRule(rules,'x','home').id).toBe('category');expect(resolveRule(rules,'x','other').id).toBe('global');});
 it('rounds half up in the currency minor unit',()=>expect(percent(105n,1000)).toBe(11n));
 it('neutralizes spreadsheet formulas and quotes',()=>{expect(csvCell('=SUM(A1:A5)')).toBe('"\'=SUM(A1:A5)"');expect(csvCell('a"b')).toBe('"a""b"');});
 it('reconciles independently allocated refunds to the original amount',()=>{const parts=allocate(1001n,[1n,1n,1n]);expect(parts.reduce((a,b)=>a+b,0n)).toBe(1001n);});
});
