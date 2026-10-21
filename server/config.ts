import 'dotenv/config';
import path from 'node:path';
export const config = {
  production: process.env.NODE_ENV === 'production',
  host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000),
  origin: process.env.PUBLIC_ORIGIN || 'http://localhost:5173',
  checkoutOrigin: process.env.CHECKOUT_ORIGIN || process.env.PUBLIC_ORIGIN || 'http://localhost:5173',
  currency: process.env.MARKETPLACE_CURRENCY || 'USD',
  demo: process.env.NODE_ENV !== 'production' && process.env.DEMO_AUTH_ENABLED === 'true',
  mock: process.env.NODE_ENV !== 'production' && process.env.MOCK_PAYMENTS_ENABLED === 'true',
  commissionBps: Number(process.env.COMMISSION_BPS || 1000),
  taxBps: Number(process.env.TAX_RATE_BPS || 0),
  dataDir: path.resolve('.local'),
  liveReady: process.env.LIVE_INTEGRATION_VERIFIED === 'true' && process.env.LIVE_POLICY_CONFIRMED === 'true' && process.env.TAX_CONFIGURATION_CONFIRMED === 'true' && !!process.env.OPERATING_COUNTRY && !!process.env.SELLER_COUNTRIES,
};
if ((config.demo||config.mock)&&!['127.0.0.1','localhost','::1'].includes(config.host))throw new Error('Demo authentication and mock payments require a loopback-only server.');
if (config.production && (!config.origin.startsWith('https://') || process.env.DEMO_AUTH_ENABLED === 'true' || process.env.MOCK_PAYMENTS_ENABLED === 'true')) throw new Error('Production requires HTTPS and disabled demo authentication/mock payments.');
