import {Decimal} from 'decimal.js';
const D = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'CLP', 'XAF', 'XOF', 'UGX', 'RWF', 'PYG', 'GNF', 'KMF', 'DJF', 'VUV', 'XPF', 'BIF', 'MGA']);
const threeDecimal = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
export function digits(currency: string) { return zeroDecimal.has(currency) ? 0 : threeDecimal.has(currency) ? 3 : 2; }
export function minor(value: string, currency = 'USD'): bigint { const n = new D(value); if (!n.isFinite()) throw new Error('Invalid monetary value'); return BigInt(n.mul(new D(10).pow(digits(currency))).toFixed(0)); }
export function amount(value: bigint, currency = 'USD') { return new D(value.toString()).div(new D(10).pow(digits(currency))).toFixed(digits(currency)); }
export function percent(value: bigint, bps: number) { return BigInt(new D(value.toString()).mul(bps).div(10000).toFixed(0)); }
export function allocate(total: bigint, weights: bigint[]) {
  const sum = weights.reduce((a,b) => a+b, 0n); if (sum === 0n) return weights.map(() => 0n);
  const result = weights.map(w => total*w/sum); let residual = total - result.reduce((a,b) => a+b, 0n);
  for (let i=0; residual > 0n; i=(i+1)%result.length, residual--) result[i]++;
  return result;
}
export type Rule = { id: string; version: number; vendorId: string | null; category: string | null; bps: number };
export function resolveRule(rules: Rule[], vendorId: string, category: string): Rule {
  const match = rules.filter(r => (!r.vendorId || r.vendorId === vendorId) && (!r.category || r.category === category));
  return match.sort((a,b) => (Number(!!b.vendorId)*2+Number(!!b.category)) - (Number(!!a.vendorId)*2+Number(!!a.category)) || b.version-a.version)[0] || { id: 'default-unconfirmed', version: 1, bps: 1000, vendorId: null, category: null };
}
export function csvCell(value: unknown) { const s = String(value ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`; }
