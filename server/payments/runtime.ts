import {AsyncLocalStorage} from 'node:async_hooks';
import {config} from '../config.js';

export type PaymentContext = {values: Record<string,string>; controls: Record<string,{enabled:boolean;currencies:string[]}>; errors: string[]};
const context = new AsyncLocalStorage<PaymentContext>();
export function withPaymentSettings<T>(settings: PaymentContext, action: () => T): T {return context.run(settings, action);}
export function paymentValue(key: string): string | undefined {return context.getStore()?.values[key] ?? process.env[key];}
export function paymentControl(provider: string) {return context.getStore()?.controls[provider] || {enabled:true,currencies:[] as string[]};}
export function paymentConfigurationError(provider: string) {return context.getStore()?.errors.includes(provider) || false;}
export function paymentPolicy() {
  const values = context.getStore()?.values;
  return {
    currency: values?.MARKETPLACE_CURRENCY ?? config.currency,
    taxBps: values?.TAX_RATE_BPS === undefined ? config.taxBps : Number(values.TAX_RATE_BPS),
    liveReady: !context.getStore() ? config.liveReady : ['LIVE_INTEGRATION_VERIFIED','LIVE_POLICY_CONFIRMED','TAX_CONFIGURATION_CONFIRMED'].every(key=>paymentValue(key)==='true') && !!paymentValue('OPERATING_COUNTRY') && !!paymentValue('SELLER_COUNTRIES'),
  };
}
