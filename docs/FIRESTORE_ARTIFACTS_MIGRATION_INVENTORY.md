# Firestore `/artifacts` migration inventory

Status: staging migration inventory. This document exists to remove the broad legacy `/artifacts/**` Firestore permission without breaking active Kyrub flows.

## Rule of classification

Every legacy artifact path must end in one of these states before the wildcard permission can be removed:

- **PUBLIC** — customer-facing data that may be read broadly, but may only be mutated by the responsible store/server.
- **STORE_PRIVATE** — operational or commercial data readable/writable only by the responsible store and explicitly authorized staff/backend.
- **BUYER_PRIVATE** — data readable by the affected customer, with narrowly scoped store/server writes.
- **LEGACY_ONLY** — historical/fallback data retained temporarily while canonical reconciliation and read cutover finish; no new business writes should depend on it.

A nested restrictive rule does not neutralize the current broad `allow` on `/artifacts/{tenantId}/{allData=**}`. Therefore sensitive data must be migrated out first, and the wildcard must ultimately be replaced rather than supplemented.

## Migrated loyalty / CRM surfaces

| Legacy purpose | Canonical location | Classification | New writes | Migration state |
| --- | --- | --- | --- | --- |
| Product base loyalty points | `storeLoyaltyConfigs/{storeId}` | PUBLIC configuration / store-write | Canonical | Legacy read fallback only |
| Loyalty challenges | `storeLoyaltyChallenges/{storeId}/items` | PUBLIC configuration / store-write | Canonical | Legacy read fallback only |
| Loyalty rewards | `storeLoyaltyRewards/{storeId}/items` | PUBLIC configuration / store-write | Canonical | Legacy read fallback only |
| Loyalty ledger | `storeLoyaltyLedgers/{storeId}/events` + `users/{buyerId}/loyaltyLedger` | STORE_PRIVATE + BUYER_PRIVATE | Canonical | Migrated |
| Challenge completions | `storeLoyaltyChallengeCompletions/{storeId}/completions` + buyer mirror | STORE_PRIVATE + BUYER_PRIVATE | Canonical | Migrated |
| Reward redemptions | `storeLoyaltyRewardRedemptions/{storeId}/redemptions` + buyer mirror | STORE_PRIVATE + BUYER_PRIVATE | Canonical | Migrated |
| Personalized benefits | `users/{buyerId}/personalizedBenefits` | BUYER_PRIVATE | Canonical | Migrated |
| Relationship notifications | `users/{buyerId}/notifications` | BUYER_PRIVATE | Canonical | Migrated |
| Relationship notification preferences | `users/{buyerId}/relationshipNotificationPreferences` | BUYER_PRIVATE | Canonical | Migrated |
| CRM segment campaign metadata | `storeCrmCampaigns/{storeId}/campaigns` | STORE_PRIVATE | Canonical backend transport | Migrated |

## Confirmed remaining sensitive legacy artifacts

### `artifacts/{legacyStoreId}/public/data/customerOrders`

**Classification:** STORE_PRIVATE + BUYER_PRIVATE projection required.

This is the highest-priority remaining artifact because the document contains customer identity and operational order data, including buyer id/name/e-mail, delivery/table context, notes, items, totals and payment state.

Canonical mirror already exists at `stores/{canonicalStoreId}/orders`. The repository already has migration reconciliation and preferred-read cutover logic. However, current legacy order persistence/dual-write paths still depend on the artifact collection, so the wildcard cannot be removed yet.

**Exit criteria:**

1. New order authority writes to the canonical store collection.
2. Merchant/KDS reads use the canonical source after reconciliation.
3. Customer order access receives a buyer-scoped projection or rules that prove buyer/store membership.
4. Legacy artifact becomes read-only migration fallback.
5. Reconciliation gate confirms no unmatched live records before artifact read dependency is retired.

### `artifacts/{legacyStoreId}/public/data/tablePayments`

**Classification:** STORE_PRIVATE financial/operational data.

The operational dual-write layer still observes this collection and mirrors payments into canonical store resources. Payment data must never remain covered by a global signed-in read/write wildcard.

**Exit criteria:**

1. New payments are created canonically under the responsible store.
2. Seller/finance permissions are enforced through canonical store roles.
3. Reconciliation confirms legacy/canonical parity.
4. Preferred reads switch to canonical payments.
5. Artifact collection becomes historical fallback only and then is retired.

## Public storefront data already outside `/artifacts`

Published product/storefront projections are primarily represented on `tenants/{storeId}` (`publicProducts`) and canonical store products. Marketplace promotions used by checkout are already canonical at `stores/{storeId}/promotions`, with authoritative coupon resolution performed server-side. These surfaces should not be re-migrated merely as part of the artifact cleanup.

## Cutover order

1. **Orders:** move remaining live order authority off `customerOrders` artifacts while preserving dual-write/reconciliation.
2. **Payments:** move remaining live payment authority off `tablePayments` artifacts.
3. Audit repository for any other runtime `/artifacts/` writes and classify them using this document.
4. Convert all remaining artifact use to explicit `LEGACY_ONLY` reads required for migration/backfill.
5. Replace the broad `/artifacts/**` signed-in allow with explicit path rules.
6. Run Firestore rule composition, canonical reconciliation, app tests and staging E2E before production approval.

## Non-goals during this cutover

- Do not delete historical operational records merely to remove a path.
- Do not bypass canonical reconciliation to make a security test pass.
- Do not expose customer/financial documents as public storefront data.
- Do not merge staging to production without explicit approval.
