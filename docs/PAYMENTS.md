# Payment setup and verification

No real provider keys were available during implementation. The automated tests use local payment simulation and synthetic signed webhook/dispute fixtures. They do not establish country eligibility or sandbox/live provider approval.

## Configure payments in the app

Sign in as a **host administrator**, open **Host workspace > Payments**, and configure:

- **Marketplace payment policy:** default currency, Shopwize business country, allowed seller countries, merchandise tax rate, and live-policy/tax/integration confirmations. Commission rates remain under **Host workspace > Settings**.
- **Stripe Connect:** test/live mode, secret key, webhook signing secret, separate-charges-and-transfers model, optional Growth subscription price, checkout currencies and the new-checkout switch.
- **PayPal marketplace payments:** sandbox/live mode, client ID/secret, partner merchant ID, webhook ID, attribution code, fee-refund confirmation, checkout currencies and the new-checkout switch.

Save each section, then use **Test saved connection**. The test verifies account credentials only; it does not certify seller eligibility, webhook delivery, fee-refund approval or live readiness. Register the displayed webhook URL in the provider dashboard. The connection test uses the saved values, not unsaved text in the form.

Sign in as the **store owner**, open **Vendor workspace > Payments**, set the registered business country and connect Stripe or PayPal. **Continue verification** opens provider-hosted onboarding, **Refresh status** retrieves verified provider state, and **Manage payouts** opens the provider's account dashboard. Owners can pause or resume each provider for their store. Managers and finance staff can view status but cannot change payment settings. Other vendor roles cannot access this page. Bank details, payout schedules and provider-specific card/wallet options are managed with the provider; Shopwize does not collect bank account numbers.

Saved app configuration takes precedence over the corresponding environment defaults. Blank credential fields keep the existing value; an explicit Clear checkbox removes it. A provider with connected sellers, subscriptions or payment history cannot switch modes or have credentials cleared. Rotate credentials only within the same provider account so existing payment IDs remain usable. Use a separate staging environment/database for sandbox testing after going live.

Updates take effect on the next API request or worker tick, without restarting the app. Disabling a provider or a vendor's acceptance switch prevents new eligible checkouts; historical processing remains available. A running, supervised worker is still required for webhooks, refunds, transfers and reconciliation.

### Deployment and credential storage

Before deploying this version, run **migration 006** using the existing migration runner against the intended database. It adds PaymentConfiguration and VendorPaymentPreferences without changing order or ledger history. It has been applied locally; the hosted database needs this migration before the new API starts.

Credential values are encrypted with AES-256-GCM before SQL storage and are never returned to the browser or audit log. By default, the first credential save creates the private file **.local/payment-settings.key**. Keep the app's .local directory writable by its service identity, denied to web clients, and persistent across deployments. Back up this key securely alongside the database: the database alone cannot restore saved payment credentials. The API and worker must use the same key.

For managed secret storage or multiple instances, provision **PAYMENT_SETTINGS_KEY** with 32 random bytes encoded as base64 before saving the first credential. Do not replace an existing key, or switch from file storage to an unrelated environment key: existing ciphertext will no longer decrypt. A missing or incorrect key disables the affected provider until the original key is restored. Database/SMTP/origin/service configuration remains infrastructure configuration; provider credentials can be managed entirely through the app.

## Stripe Connect

The adapter implements **separate charges and transfers**: a platform Checkout Session produces a PaymentIntent, a verified capture funds vendor transfer records, and transfers reference the source charge. Bank payouts are independent provider-reported records. The platform must confirm liability and country eligibility for this model.

Set these fields in **Host workspace > Payments > Stripe Connect**, or use server-only environment defaults:

```dotenv
STRIPE_SECRET_KEY=<test secret from the approved platform account>
STRIPE_WEBHOOK_SECRET=<endpoint signing secret>
STRIPE_CONNECT_MODEL=separate_charges_and_transfers
STRIPE_SUBSCRIPTION_PRICE_ID=<optional recurring Growth price>
```

Send raw-body events to `POST /api/webhooks/stripe`. Subscribe to Checkout/payment-intent events, `account.updated`, `payout.*` for connected accounts, `customer.subscription.*`, and `charge.dispute.*`. Use the Stripe CLI or a temporary HTTPS tunnel for a real sandbox exercise; the app itself remains loopback-only while demo authentication is enabled. Do not expose development shortcuts through a public tunnel.

Seller onboarding uses hosted Express account links. A redirect does not enable selling. The worker fetches current account/subscription/payout state when processing events, which avoids using old event snapshots as current state. The host must also approve the seller.

Refunds reference the original PaymentIntent. A refund does not automatically reverse a Connect transfer; linked transfer reversals are queued durably. A refund that settles before an unattempted transfer reduces that transfer. Requests that remain uncertain beyond the conservative retry window require provider reconciliation before another creation attempt.

Read the official [Connect overview](https://docs.stripe.com/connect), [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), [webhook setup](https://docs.stripe.com/events/manage-webhook-endpoints), [idempotency behavior](https://docs.stripe.com/api/idempotent_requests), [cross-border constraints](https://docs.stripe.com/connect/cross-border-payouts), and [Dispute API](https://docs.stripe.com/api/disputes).

## PayPal multiparty

Requires approved PayPal partner access, seller onboarding and marketplace fee capability; a normal PayPal merchant account is insufficient. Configure the corresponding fields in **Host workspace > Payments > PayPal marketplace payments**, or use these environment defaults:

```dotenv
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=<approved sandbox app ID>
PAYPAL_CLIENT_SECRET=<server-only sandbox secret>
PAYPAL_PARTNER_ID=<partner merchant ID>
PAYPAL_BN_CODE=<approved attribution code>
PAYPAL_WEBHOOK_ID=<registered webhook ID>
PAYPAL_FEE_REFUNDS_ENABLED=false
```

Register `POST /api/webhooks/paypal` for checkout/capture/refund, merchant onboarding and customer dispute events. The adapter calls PayPal's authenticated signature-verification endpoint and only persists verified events. It does not download an arbitrary webhook certificate URL itself.

A checkout uses one purchase unit per seller (at most 10), explicit payees, per-seller platform fees and persisted capture IDs. The UI discloses separate merchant charges. Each successful seller capture is recorded independently. Partial success never marks the whole parent paid. Reconciliation retrieves the provider order; the app must not recreate paid purchase units to retry a failed seller. Unresolved partial transactions require reconciliation/refund policy review.

Shopwize retains tax on both payment providers. Each PayPal purchase unit allocates **commission + tax** to the platform through `platform_fees`. This does not increase the customer total. The internal ledger records only commission as revenue and records tax separately in `tax_payable`; vendor earnings exclude both. For example, a $100 item + $10 shipping + $8 tax produces a $118 charge, an $18 platform allocation ($10 commission + $8 tax), and $100 for the seller before PayPal processing fees. PayPal may label the combined allocation as a partner fee; it must not be booked entirely as commission revenue.

Verified capture responses must report a platform allocation matching the order's historical commission and tax before the app records the sale. Missing or mismatched allocations stop reconciliation for finance review. Refunds return the historical refunded commission **and tax** from the platform; customer refund amounts and vendor shares remain consistent with the ledger. Older taxed captures without proof of the tax allocation require manual reconciliation before automated refunds. This change does not recalculate old taxes, remit tax, or enable payment providers.

Validate the combined allocation and fee-refund capability with the approved PayPal account in sandbox before live use. See [partner fees](https://developer.paypal.com/platforms/overview) and [refund payment instructions](https://developer.paypal.com/serversdk/php/models/structures/refund-payment-instruction).

Set `PAYPAL_FEE_REFUNDS_ENABLED=true` only after the partner account is approved and sandbox-verified for platform-fee refunds. Refund status is subsequently retrieved by its provider refund ID. Merchant payout timing and detailed seller settlement reporting remain PayPal-controlled; no simulated payout is marked as a bank deposit.

Official references: [platform requirements](https://developer.paypal.com/platforms/), [multiseller checkout](https://developer.paypal.com/platforms/checkout/standard/customize/multiseller-payments), [seller onboarding](https://developer.paypal.com/platforms/seller-onboarding), [request idempotency](https://developer.paypal.com/api/rest/reference/idempotency/), [webhook verification](https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post), and [currency codes](https://developer.paypal.com/api/codes/currency/).

## WooPayments

Deliberately unavailable with an explicit explanation in provider settings. It requires a genuine WordPress/WooCommerce installation, an eligible business country and a compatible marketplace payout extension. No generic Node.js WooPayments gateway is fabricated. If that infrastructure is later supplied, decide order/refund ownership and build a supported WooCommerce API/webhook bridge first.

See the official [startup guide](https://woocommerce.com/document/woopayments/startup-guide/), [country compatibility](https://woocommerce.com/document/woopayments/compatibility/countries/), and [available currencies](https://woocommerce.com/document/woopayments/currencies/available-currencies/).

## Required real sandbox exercise

For each provider, use approved test sellers and test instruments: complete onboarding; create a two-store checkout; replay browser submission and provider events; capture all/part of the order; reconcile unknown outcomes; refund one unit; refund after transfer; check failed transfer/payout recovery; verify actual provider IDs, currency and fees; process a dispute; check subscription activation/cancellation; disable new checkout and confirm historical processing still runs.

Record provider dashboard references and webhook delivery IDs separately from `test-results/integration.json`. No live customer money is needed for this procedure.

## Live gate

Before live keys may enable checkout, set accurate `OPERATING_COUNTRY`, `SELLER_COUNTRIES`, and confirm `LIVE_POLICY_CONFIRMED`, `TAX_CONFIGURATION_CONFIRMED`, and `LIVE_INTEGRATION_VERIFIED`. These flags are operator attestations, not automatic regulatory or provider approval. New provider checkouts can be disabled in host settings without disabling historical refund/webhook/reconciliation routes. Keep provider credentials available while historical obligations exist.
