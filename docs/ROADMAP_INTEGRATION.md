# Kyrub — Canonical Integration Roadmap

Status base: 2026-08-29

## Final product objective

Kyrub is one operational platform, not a collection of disconnected apps. The target architecture is a common Kyrub Operation Engine that powers Storefront, ERP/PDV, CRM, loyalty, local service, pickup, delivery, payments, economy, communication, social experiences, integrations and Kyrubia.

The shared operational foundation is organized around:

- Identity & Relationships
- Catalog & Resources
- Commitments / Orders
- Fulfillment
- Payments & Settlements
- Domain Events & Receipts
- Policy & Permissions
- Communication & Social
- Kyrubia / trusted actions

Experiences must project these shared authorities instead of creating parallel truth.

## Non-negotiable invariants

1. A person authenticates with a personal Kyrub account. A store is an institutional principal represented by authorized people; it is not a second shared login.
2. Canonical store/order/payment/relationship facts live in canonical store-scoped domains. Legacy `/artifacts` paths are migration compatibility only.
3. CRM, dashboards and recommendations are projections of canonical facts, never editable parallel balances or history.
4. Store Points, KCoins and XP remain separate economies.
5. The delivery fee paid by the customer is economically destined 100% to the courier. Store subsidy, Kyrub incentive, partner subsidy, PSP cost and Kyrub margin remain separate facts.
6. Refund, cancellation and chargeback are distinct lifecycle facts and must not overwrite history.
7. Marketplaces and external channels are distribution channels; the Kyrub operational core owns the canonical catalog/order/relationship state.
8. Kyrubia and external agents must use the same authenticated, permissioned, idempotent and auditable action layer as the product itself.
9. No feature may invent an unavailable provider capability, settlement, wallet balance, split or external delivery state.
10. No roadmap item is considered production-complete only because a preview deploy exists; integration, regression and production validation are separate gates.

## Canonical feature ancestry already built

The current integration head contains this stacked ancestry:

`#378 -> #379 -> #380 -> #381 -> #383 -> #386 -> #387 -> #388 -> #389 -> #390 -> #391 -> #392 -> #394 -> #395 -> #397 -> #398`

Functional sequence:

1. Store Points + loyalty foundation — #378
2. Functional Challenges — #379
3. Functional Rewards — #380
4. Customer ↔ Store relationship projection — #381
5. Promotion vs personalized discovery — #383
6. Canonical CRM projection — #386
7. Institutional store identity — #387
8. Customer ↔ Store chat — #388
9. Canonical notification center — #389
10. Communication preferences / marketing consent — #390
11. CRM campaigns → notifications — #391
12. Canonical local attendance sessions — #392
13. Canonical economic ledger — #394
14. Admin Platform Economy — #395
15. Fees and subsidies facts — #397
16. Chargebacks and cancellations economics — #398

`integration/roadmap-v1` starts from the validated #398 head.

## Reconciliation queue

Two useful features were originally developed on parallel branches and are being reincorporated deliberately:

### R1 — Canonical-first customer orders

PR #399, branch `reconcile/canonical-customer-orders-v1`, targets `integration/roadmap-v1`.

Purpose:
- new customer orders canonical-first in `/stores/{storeId}/orders/{orderId}`;
- temporary legacy mirror preserved;
- legacy watcher cannot overwrite equal/newer canonical state;
- same stable order id across both representations.

This is foundational and must enter before the local-service projection.

### R2 — Local Service PDV projection

PR #400, branch `reconcile/local-service-pos-v1`, is stacked on R1.

Purpose:
- project `dine_in` + `pickup` from canonical customer orders;
- reuse table/pickup authorities;
- keep delivery out of this local-service view;
- preserve secure six-digit pickup handoff.

## Superseded PRs

These PRs are historical only and must not be merged:

- #370 — superseded by the ESM work that reached #371/#372
- #382 — superseded by #383
- #384 — superseded by #386
- #385 — superseded by #387
- #393 — reconciled as #400
- #396 — reconciled as #399

Their branches may remain as historical references/backups, but they are not part of the merge path.

## Independent work not part of this release train

- #377 — note-card presentation refinement. Treat independently unless explicitly selected for this release.

## Integration release strategy

Do not merge the long stack one PR at a time into `main`.

The intended release flow is:

1. Validate #399 completely.
2. Validate #400 completely.
3. With explicit authorization, integrate #399 into `integration/roadmap-v1`.
4. Rebase/retarget the reconciled local-service result onto the updated integration head and validate again.
5. With explicit authorization, integrate the local-service reconciliation.
6. Open/refresh a single release-candidate PR: `integration/roadmap-v1 -> main`.
7. Run the full integrated validation suite on that release candidate.
8. Run the old 67-point Phase 10 closure (items 63–67) against the integrated release candidate, not against old `main`.
9. Only after all gates are green, request explicit authorization to merge the release candidate into `main`.
10. Run production smoke/E2E on the resulting production commit.

## Phase 10 / 67-point final closure

The historical 67-point roadmap is not considered formally closed until these final cross-domain gates run against the integrated release candidate:

- integrated cross-domain validation;
- security regression;
- production/readiness verification;
- documentation/architecture drift check;
- final closure report with explicit unresolved exceptions, if any.

## Roadmap after integration

Only after the release candidate is coherent should development resume for the remaining product roadmap. Priority must follow architecture dependencies, not PR numbering.

The next economic layers must not jump directly to a consumer wallet. The safe dependency order is:

1. complete economic lifecycle facts and reconciliation;
2. define payable/receivable obligations and settlement eligibility;
3. provider-backed settlement execution and reconciliation;
4. only then expose wallet/balance experiences backed by authoritative obligations/settlements;
5. complete delivery economics/dispatch on the same order/fulfillment engine;
6. extend staff membership/roles so authorized humans can operate as the institutional store principal;
7. connect Kyrubia to these canonical actions through the same policy/audit layer.

## Definition of done

A feature is done only when all applicable layers agree:

`canonical model -> authorization -> server authority -> persistence -> projection/UI -> tests -> integration -> production validation`

A green isolated PR is implementation-ready, not production-complete.
