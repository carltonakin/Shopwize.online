# Payment setup and verification

No real provider keys were available during implementation. The automated tests use local payment simulation and synthetic signed webhook/dispute fixtures. They do not establish country eligibility or sandbox/live provider approval.

## Stripe Connect

The adapter implements **separate charges and transfers**: a platform Checkout Session produces a PaymentIntent, a verified capture funds vendor transfer records, and transfers reference the source charge. Bank payouts are independent provider-reported records. The platform must confirm liability and country eligibility for this model.

Configure server-only environment values:

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

Requires approved PayPal partner access, seller onboarding and marketplace fee capability; a normal PayPal merchant account is insufficient.

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
