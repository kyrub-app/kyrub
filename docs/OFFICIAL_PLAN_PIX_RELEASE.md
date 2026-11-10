# Official Pro/Business Pix release

## Current release checkpoint — 10 Nov 2026

**Do not treat this document's older rollout steps as proof that the release is ready.**
PR #1110 (`codex/official-plan-preactivation-contract`) is Draft and targets
`codex/official-plan-pix-one-buyer-pilot`, **not** `main`.
The current PR head is ahead of `main` by more than 100 commits, including its
parent pilot branch. Before a production merge, review the full combined diff,
required migrations and feature flags; retargeting #1110 alone is insufficient.

The no-store checkout remains **blocked for real providers** by
`OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY`. Only an explicitly enabled
localhost Firestore emulator with the isolated fake platform token may exercise
the no-store POST path. Do not configure
`KYRUB_OFFICIAL_PIX_EMULATOR_PRESTORE_TEST` in Vercel or any live environment.
The integration test covers issuance, provider confirmation, recovery, and
later store provisioning in isolation. Passing CI does **not** authorize
production charging or prove the deployed production configuration.

**Commercial rule:** confirmed Pix payment begins the prepaid term at the
provider's verified approval timestamp, even if the buyer creates their store
later. Delayed store creation must not restart or extend that term. The earlier
paragraph below stating that a buyer must activate a Free store before paying
is historical and is superseded by this rule, subject to completing the
real-provider pre-store checkout before release.

Integration review findings (10 Nov 2026):
- Comparing `main` with this branch currently yields **16 changed files**, not
  112 independent feature files. The commit count includes the stacked pilot
  history; review the actual file diff rather than treating each commit as a
  separate release feature.
- Production-sensitive changes include `api/plan-control.ts`,
  `server/payments/officialPlanPixCheckout.ts`,
  `server/actions/freeStoreProvisioningService.ts`,
  `server/actions/firstCanonicalStoreActivationService.ts`, and
  `src/components/tabs/RendaTab.tsx`. The remaining changes include
  tests, documentation, schedule helpers and test configuration.
- `recordFirstCanonicalStoreActivation` explicitly documents that its
  route is **not yet connected**. Its companion
  `activateCanonicalStoreAndReconcileOfficialPlan` still invokes
  `activatePendingOfficialPlanForStore`, which contains the older
  `paid_pending_activation` path. This is a migration/cleanup review
  item: the new Pix flow starts entitlement at `paidAt` and must never
  depend on this older store-activation path.
- Before calling the release complete, verify the actual authenticated
  `Ativar loja` transition and paid-entitlement inheritance against the
  deployed application; tests of isolated helpers alone are insufficient.

Before enabling a live pilot, require: reviewed combined integration to
`main`, exact-head CI and emulator checks, verified platform collector and
webhook configuration, pre-store charge path released from its deliberate
gate through a separately reviewed change, and an owner-approved one-buyer
one-shot test. Never use real money to bypass incomplete engineering checks.


This change is prepared for owner approval. Do not merge, deploy or enable real-money creation before that approval. Do not seed prices, discounts, published products or rewards on behalf of the owner.

## Integration

1. Merge reviewed #1076 at `862febfa359a57476b2bf3cfc4e700fa3d37b6f6` after owner approval. Its Application build and Validate Kyrub checks passed; it has no payment creation endpoint.
2. Review the official Pix PR on top of #1076. Require Application build and Validate Kyrub, including `official-plan-pix*.test.ts`, on the exact release head. Retarget to main after #1076 merges and rerun required checks if the diff changes.
3. Confirm Vercel team `kyrubapp-6434s-projects`, project `kyrub`, GitHub repository `kyrub-app/kyrub`, production domain `www.kyrub.com` and approved commit. The inspected production/main base is `41c84483fc6f193243994506488d5864f67da5c4`.
4. The existing `vercel.json` permits automatic deployment for main but excludes `codex/official-plan-pix`. Do not rename this branch to an enabled `preview-*` name before approval. See https://vercel.com/docs/project-configuration/git-configuration.
5. After explicit financial release approval, merge the reviewed Pix commit and monitor the resulting production build. The flag remains disabled until deliberately configured. No CLI deployment, promotion or production environment mutation was performed during development.

## Platform configuration

Set `KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID` to the exact numeric platform account ID approved by the owner. It is a non-secret identifier. The authenticated `/users/me` result must match before a charge or reconciliation; a missing or different receiver fails closed. No account ID is seeded by deployment.

The Firestore concurrency proof runs with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node --test --import tsx tests/firestore-official-plan-pix.test.ts`. It refuses a non-local host and uses only `demo-kyrub-pix`, with a simulated provider. Four concurrent attempts must produce one provider POST; concurrent confirmations must preserve one contract, payment, financial capture, point entry, XP entry, achievement and benefit cycle.

Use existing server-only `KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN` and `KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET`, scoped to Production. Never copy merchant OAuth credentials into platform billing. `/users/me` identifies the platform collector; every payment GET independently checks that collector, BRL, Pix, external reference, exact cents and Production `live_mode=true`.

`KYRUB_PLAN_BILLING_WEBHOOK_URL` must identify the HTTPS production application. The adapter constructs `/api/plan-control?op=official.prepaid.webhook&checkoutId=...`; use the same platform application's webhook secret and enable Mercado Pago payment notifications. Missing/incorrect signatures cannot activate a contract. Confirm delivery on the first owner-executed purchase, not by creating a live payment from an engineering script.

Set `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=true` only after approval. It applies to every eligible authenticated buyer, without a UID allowlist. `KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED` continues to govern merchant prepaid subscriptions; enabling it does not enable official platform Pix. `GET /api/plan-control?op=plans.billing` adds `pixAvailable` without returning any secret. Vercel environment configuration must take effect in the released deployment.

## Owner catalog setup

In the Official Store ERP, create subscription products with a monthly interval and access benefit. Use the existing product editor for actual monthly price, publication status, points per purchase and optional 1/3/6/12-month contract discounts. Bind each eligible draft or published product to Pro or Business in the new official-plan panel. Configure optional purchase XP and an achievement/badge there; no reward is issued when unconfigured. Global XP configuration remains super-admin controlled. Publication remains an explicit owner action in the product editor.

Paid plans are prepaid for the explicitly accepted period, with a single Pix, no installments and no automatic renewal. An active entitlement or unresolved subscription prevents a competing plan purchase; upgrades/proration are not invented. Historical implementation note: the earlier flow required a Free store before purchase. PR #1110 changes the commercial rule to allow payment before store creation, but the real-provider no-store checkout is still gated pending release validation.

## Confirmation, logs and first purchase

No provider POST is made by status, reconciliation or webhook. A lost creation response retains the buyer-wide slot; recovery looks up the original reference and refuses ambiguous matches. Signed notifications can recover an early payment before the original POST returns. Definitive rejected/cancelled unpaid attempts close their slot; an expired QR alone never authorizes another charge.

Verified payment materialization uses one Firestore transaction for the shared global payment binding, prepaid contract/period, official-store subscription, canonical payment, finance capture, product points, plan mirrors, expiring entitlement and audit event. XP, achievement, CRM and benefit projections are retry-safe. `effectsStatus=pending` persists until all projections complete; retries reuse the same payment and deterministic identities. The existing prepaid coverage verifier checks contract/period/binding consistency before ERP or access-benefit use.

Follow structured `[official-plan-pix]` logs by checkout ID, stage and provider payment ID. Do not log tokens, payer data, QR payloads or raw PSP responses. Inspect `kyrub_admin/control_plane/plan_pix_checkouts/{checkoutId}` for `status`, `effectsStatus`, quote/acceptance digests and provider binding. Verify the linked canonical subscription, contract, period, official-store CRM, economicLedger, storePointLedger, user xpLedger/achievement and buyer entitlement. A receipt is shown as activated only after projections complete.

The owner performs the first live purchase. Check approved/accredited evidence from the PSP, collector and live mode; confirm expiry/access in a fresh session and replay the notification/status to confirm counts stay unchanged. Refunds/chargebacks and manual administrative conflicts are surfaced for review; this PR never initiates refunds or transfers. Post-payment non-approved statuses deliberately fail reconciliation and log an alert rather than silently restoring revoked benefits.

## Rollback

First disable new creation with `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=false` and ensure the serving deployment receives it. Keep status and signed webhook reconciliation running for in-flight payments. The kill switch does not prevent already paid contracts from materializing or retrying missing projections. Do not revert/remove the handler while unresolved provider payments exist. Preserve immutable contracts, global bindings, receipts and rewards; never delete ledger records to reset a test. Only roll back to the previous commit after reconciling in-flight payments and assessing any required compensating entries through the existing governed financial workflows.


## One-buyer, one-emission live pilot (pending approval)

Pilot code is restricted to one official Kyrub Pro, 1 month, BRL 197.00. The server refuses live creation unless **all** production deployment settings are explicit:
- `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=true`
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE=true`
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID=<verified Firebase Auth UID of the approved test buyer>`

Never set these until exact deployment, approval and security tests are confirmed. A missing or invalid buyer UID fails closed. Every issuing request authenticates its buyer and checks the offer before transaction reservation and again before provider POST. No buyer-controlled request field selects the pilot UID.

The Firestore document `kyrub_admin/control_plane/official_plan_pix_pilot/one_shot` is atomically **created once** alongside the buyer payment slot and the request snapshot, before a provider call. Once present, it is never deleted automatically, even if the provider rejects or the payment expires; this pilot does not authorize another charge. An in-flight checkout is recovered via the original provider reference, webhook and reconciliation, without creating a fresh payment.

Important: do not reset the one-shot document to retry a charge. If the single live attempt cannot prove settlement, separately investigate that precise transaction before deciding on a new controlled pilot. Turning the checkout gate off must not shut down existing payment status, webhooks or reconciliation. The pilot configuration must be removed or switched off and the change must reach the live deployment; Vercel variable changes alone may not alter a currently serving deployment.

Before any deployment, require CI and dedicated emulator concurrency checks on exact PR head. Verify one eligible buyer is allowed in the isolated test, another buyer fails before provider POST, other plan terms/amounts fail, missing config fails, repeated submissions yield only one provider POST, and webhooks still reconcile after the creation gate closes. Do not merge or deploy this PR without separate authorization. General commercial rollout requires a separate reviewed change to remove pilot-only restrictions.
