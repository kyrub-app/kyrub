# Initial prepaid subscription purchase (Pix)

Stacked on PR #1074 (`integration/renewal-1064-1073-main-20261104`).
No deployment, merge, production data migration or provider charge is part of this change.

## Canonical ownership and reuse

Searched before implementation:

- `api/plan-control.ts`, `src/utils/storeSubscription.ts`, `B2CCartDrawerApprovalBase.tsx`: extend the existing authenticated subscription API/client/cart; the recurring route continues rejecting prepaid terms.
- `persistedMerchantSubscriptionQuote.ts`, `subscriptionContractQuote.ts`, `shared/subscriptionContractOffers.ts`: reuse authoritative published-product pricing, configured discounts and 3/6/12-month calculations. Browser prices are never authoritative.
- `prepaidRenewalPixCheckout.ts`, `prepaidRenewalPaymentVerification.ts`, `mercadoPagoStoreOauthService.ts`, `commercialRecipientAuthorityService.ts`: reuse OAuth transport, current seller authority and approved/accredited Pix verification. An initial intent has no predecessor proposal, so it needs a separate bounded checkout coordinator, not a second subscription service.
- `persistedPrepaidRenewal.ts`, `prepaidSubscriptionContractLifecycle.ts`: reuse lifecycle/calendar arithmetic, contract format and the global `prepaidRenewalPaymentBindings` uniqueness namespace.
- `storeSubscriptionService.ts`, `storeSubscriptionBenefitService.ts`, `storeSubscriptionBenefitLedgerService.ts`, `storeSubscriberRegistryService.ts`: extend existing ERP/benefit consumers. There is no second entitlement registry.

The new `stores/{storeId}/prepaidSubscriptionCheckouts/{checkoutId}` stores quote, acceptance and provider recovery evidence only. It is not an active subscription. Its digest includes the authenticated buyer, canonical store, product, owner, modality and server quote. The shared `subscriptionCheckoutSlots` collection prevents concurrent initial attempts for the same buyer/product, including conflicting terms and recurring checkout.

Official platform plan routing remains governed by the existing official-plan checks. This merchant OAuth flow does not bypass those checks or publish draft official products.

## Payment and atomic activation

1. Quote a published canonical product using configured term discounts. Explicit buyer acceptance freezes the total and commercial snapshot.
2. Revalidate the product, current owner, official-plan boundary and OAuth recipient. Claim the existing checkout slot transactionally before a single idempotent Pix POST. The payload has no installments, recurring agreement or preapproval.
3. Bind the provider payment only after checking seller, reference, amount, BRL and Pix. Lost/ambiguous responses are recovered with seller-scoped GET/search, never by releasing the slot or creating another charge.
4. A signed webhook can reconcile only an already bound payment. Buyer reconciliation also fetches directly from the provider. Approval must be `approved` and `accredited` and must occur after acceptance.
5. One transaction creates the canonical subscription, first contract, paid period and global payment binding; it updates the checkout/slot. Deterministic IDs and the shared payment binding make replay/concurrent activation idempotent. Conflicts fail without consuming a payment or granting benefits.

The canonical subscription has `collectionMode: prepaid`, `autoRenew: false`, no provider preapproval ID, and explicit `initialContractId`. The contract identifies that same `subscriptionId`, buyer, product and payment; its paid period is stored under that subscription. The term starts at verified provider approval and ends using the existing UTC month arithmetic.

The existing benefit cycle reader verifies period, contract and global binding together. It grants only the currently paid period, preserves consumed credits on replay and does not grant a future renewal early. Existing configured units-per-cycle semantics are retained. Administrative suspension/cancellation is not overridden. ERP reads/reconciliation never call recurring provider endpoints for these records. The first contract is directly usable by the existing early-renewal workflow.

## Rollout and recovery

`KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED` defaults off and must equal `true` to create a payment. It is checked again immediately before POST. Turning it off blocks new charges while allowing reconciliation of existing payments.

Keep this flag off in production until sandbox/visual approval. Configure the existing OAuth connection and webhook secret through their existing administrative mechanisms; never put credentials in product documents. `KYRUB_STORE_SUBSCRIPTION_WEBHOOK_URL` supplies the HTTPS webhook origin; the initial flow always uses `/api/plan-control?op=merchant.prepaid-initial.webhook&storeId=...&checkoutId=...`.

The slot intentionally remains occupied for unknown/rejected/expired attempts. The UI offers reconciliation, not an unsafe second charge. A definitive replacement/cancellation workflow needs separate explicit financial policy; this PR does not cancel/refund payments or automatically unlock attempts. Unknown, non-unique or unverifiable provider results fail closed.

## Isolated and sandbox validation

Automated entry points:

- `npm run test:prepaid-initial`: checkout guards, UI callbacks/session isolation and ERP/benefit coverage readers.
- `npm run test:renewal`: existing renewal and actual HTTP handler regressions.
- `npm run test:rules`: composed security rules and real Firestore Emulator initial-purchase/renewal tests with a simulated OAuth provider. These tests require loopback emulator access and use `kyrub-security-test`, never the production Firebase project.
- `npm run prebuild`, `npm --ignore-scripts run build`; cross-domain contract test remains unchanged.

Visual/functional sandbox checklist (not a production activation instruction):

1. Use an isolated Firebase project, a published merchant test product with existing 3/6/12 discounts, test buyer, test seller OAuth and test webhook credentials. Enable the initial checkout flag only there.
2. In the existing cart, choose each term, request the server quote, verify its total/discount and explicitly accept. Verify one Pix, no recurring preapproval, disabled double-submit and pending status.
3. Simulate provider pending/rejected and approved/accredited events. Confirm one canonical subscription/contract/period, correct UTC vigency and existing ERP access/benefits. Replay the event and reconcile twice; IDs and remaining credits must remain unchanged.
4. Lose the creation response and reopen the cart. Confirm GET recovery of the same payment, not another POST. Switch users while requests are in flight: the former user's Pix and contract must disappear.
5. Exercise mismatched currency/value/collector/reference, cross-store locators and an already bound payment. All must fail without activation.
6. Propose and pay an early renewal using the existing flow. Confirm the same subscription, successor start at the paid expiry, previous credits preserved and future credits not granted early.

Mercado Pago sandbox network behavior and browser visual QA still require execution in that isolated environment; the local provider simulation does not certify live OAuth/webhook delivery or real settlement.
