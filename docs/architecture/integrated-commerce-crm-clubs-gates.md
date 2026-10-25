# Kyrub — Integrated Commerce, CRM and Clubs: implementation gates

Base: feat/profile-react-rebuild @ 424d01a8136b208f04891aa2dde5a2b9518ee369. This document is an audit contract, not a claim of deployed functionality.

## Authority and source-of-truth matrix

| Domain | Authority | Existing implementation | Integration requirement |
|---|---|---|---|
| Free/Pro/Business plan versions, catalog caps, marketplace commission policy | Global Admin | shared/kyrubPlanManagement.ts; server/admin/planManagementService.ts | Commercial presentation in Official Store ERP must reference the published version, never shadow-edit it |
| Official Store identity | Global Admin for designation; ERP for operation | server/admin/officialStoreService.ts | Resolve canonical store ID and owner ID; do not create synthetic merchant |
| Kyrub plan payment and entitlement | Platform billing | server/admin/paidPlanSubscriptionService.ts; kyrub_admin/control_plane/store_subscriptions and store_entitlements | Only verified provider evidence can activate entitlement; one subscription/provider reference |
| Ordinary merchant recurring sales | Merchant OAuth account | server/payments/storeSubscriptionService.ts; stores/{canonicalStoreId}/subscriptions | Never route Kyrub platform-plan charges through merchant OAuth subscription checkout |
| Merchant CRM | Store tenant | server/payments/storeSubscriberRegistryService.ts; stores/{canonicalStoreId}/crmCustomers | Merchant can only read own customers; no global counts |
| Ecosystem CRM | Global Admin | PR #968 draft, NOT integrated | Verify canonical user/store identities, eliminate double counting, do not write merchant CRM into legacy owner path |
| Kyrub Club / Kyrub Points | Global gamification | shared/gamification.ts and related ledger/economy contracts | Legacy KCoins identifiers require backward-compatible migration; global points are not money |
| Store Club / Store Points | Each store | shared/storePoints.ts; server/payments/storeRelationshipService.ts | Isolate balances by store; do not convert automatically |
| Marketplace My Clubs | User-facing marketplace | src/components/tabs/LegacyKyrubTab.tsx ('cliente'); KyrubTab.tsx ('Para você') | Evolve existing filter; global Club card is not a fake store |

## Critical incompatibilities verified

1. Platform-plan checkout currently calls assertStoreExists(ownerId), so a customer without a store cannot directly purchase a plan. Define legitimate store-onboarding path; never fabricate a store or grant entitlement to a different identity.
2. Store subscription checkout requires recipientKind === merchant_store and merchant OAuth identity. Reusing this endpoint for Kyrub platform plans would charge the wrong recipient. Reuse ERP presentation/catalog only; retain platform billing authority.
3. Plan contracts still include kyrubiaIntelligenceCredits and per-feature flags. Audit all enforcement before migrating to all-features-available commercial policy. Do not silently remove persisted fields.
4. Existing gamification contracts refer to KCoins; UI naming can be updated separately from stored ledger identifiers until migration tests prove compatibility.
5. PR #968 is a draft with partial ecosystem funnel changes. Do not merge blindly.

## Execution order and gates

- [x] A1. Inventory source-of-truth services and existing marketplace filters.
- [x] A2. Identify the conflicting platform/merchant payment paths and legacy names.
- [x] A3. Identify key plan feature and credit enforcement call sites; compatibility implementation still pending.
- [ ] A4. Audit global gamification UI wiring and ledger reads; current file inventory confirms contracts but not a mounted global UI.
- [ ] B1. Define explicit Official Store plan-product mapping and buyer/store onboarding states.
- [ ] B2. Add an idempotent platform-billing adapter to the ERP purchase flow; prove recipient and payment authority.
- [ ] B3. Reconcile commercial order, entitlement, and Official Store CRM from one verified event; no duplicate invoice.
- [ ] C1. Implement Admin ecosystem CRM with disjoint person counts and overlapping role segments.
- [ ] C2. Integrate Admin-managed Kyrub Club and user-facing balance.
- [ ] C3. Evolve marketplace Cliente to Meus Clubes with global card first, merchant club summaries after.
- [ ] D1. Prove refunds, reversals, reward redemption, tenant isolation, and commission settlement evidence.
- [ ] D2. Run TypeScript, tests, E2E and mobile/desktop visual verification before merge/deploy.

## Invariants

- Free plan has zero payment; no fabricated order.
- A payment approval does not imply fiscal authorization.
- Exceeding advisory turnover threshold never blocks checkout in initial rollout.
- No merchant sees platform-global customer counts.
- No automatic conversion between Kyrub Points and Store Points.
- No assumed automatic Mercado Pago split; shared/marketplaceSellerSplit.ts reports splitPlanMovesMoney() === false.
- Do not merge draft PR #968 into homologation without reviewing its nine changed files.

## Plan enforcement follow-up (2026-10-25)

- server/admin/executablePlanCatalogService.ts derives activeCatalogLimit from features.catalog and kyrubiaIntelligenceCredits from features.kyrubia_intelligence. Removing flags only from presentation is insufficient.
- shared/kyrubPlanManagement.ts models capabilities and credit_limit enforcement; shared/kyrubActivePlanCatalog.ts exposes credits and feature states.
- src/components/plans/PlanCenterApp.tsx advertises Kyrubia credits and selectively displays team, automation, integration features. Update only after authoritative enforcement is reconciled.
- src/ai/activePlanProductCapacity.ts enforces active catalog capacity and references the legacy Free five-product limit. Preserve catalog guard, but align with published plan version.
- server/admin/storeEntitlementService.ts and server/admin/storeEntitlementLifecycleService.ts also grant/reconcile plans via coupons, complimentary admin grants, and expiration. Payment is not the only valid entitlement source.
- CustomerStoreRelationshipPanel.tsx renders store points, redeemable rewards, vouchers, and coupons; route mounting needs verification.
- shared/gamification.ts still defines KCoin ledger, challenge and XP contracts; no global customer UI mounting was proven by this audit. Avoid claiming it is live.

### Required regression cases
1. Free, Pro, Business all receive enabled product features while active catalog caps remain enforced.
2. Existing entitlement from coupon or admin courtesy remains valid after migration; expiration still restores prior rights.
3. Existing KCoin ledger records remain readable and cannot be silently re-denominated.
4. Store points remain tenant-isolated; refunds/reversals cannot generate duplicate credits.
5. Marketplace Meus Clubes includes verified purchase relationships and eligible benefits, without turning global Club into a merchant record.
