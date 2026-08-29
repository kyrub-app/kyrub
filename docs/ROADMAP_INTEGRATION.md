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

## Canonical release-candidate ancestry

The current integration release candidate contains this functional ancestry:

`#378 -> #379 -> #380 -> #381 -> #383 -> #386 -> #387 -> #388 -> #389 -> #390 -> #391 -> #392 -> #394 -> #395 -> #397 -> #398 -> #399 -> #400`

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
17. Canonical-first customer orders — #399
18. Local Service PDV projection on the same customer-order authority — #400

The integrated head after #399/#400 is represented by `integration/roadmap-v1`; the umbrella release PR is #401 (`integration/roadmap-v1 -> main`).

## Reconciliation status — complete

Two useful features had originally been developed on parallel branches. Their old PRs were retired and their validated functionality was reincorporated into the canonical integration line.

### R1 — Canonical-first customer orders — ✅ integrated

Former parallel work #396 was ported and validated as #399, then merged into `integration/roadmap-v1`.

Preserved behavior:
- new customer orders canonical-first in `/stores/{storeId}/orders/{orderId}` when canonical mapping exists;
- temporary legacy mirror preserved;
- same stable order id across canonical and legacy representations;
- legacy fallback remains available during migration;
- legacy watcher cannot overwrite equal/newer canonical state.

### R2 — Local Service PDV — ✅ integrated

Former parallel work #393 was ported and validated as #400 after R1, then merged into `integration/roadmap-v1`.

Preserved behavior:
- `dine_in` + `pickup` projected from canonical customer orders;
- table/pickup authorities reused;
- delivery excluded from this local-service projection;
- secure six-digit pickup handoff preserved;
- no second local-order persistence introduced.

## Superseded PRs

These PRs are historical only and must not be merged:

- #370 — superseded by the ESM work that reached #371/#372
- #382 — superseded by #383
- #384 — superseded by #386
- #385 — superseded by #387
- #393 — reconciled as #400
- #396 — reconciled as #399

Their branches may remain as historical references/backups, but they are not part of the release path.

## Independent work not part of this release train

- #377 — note-card presentation refinement. Treat independently unless explicitly selected for this release.

## Integration release strategy

Do not merge the historical stack one PR at a time into `main`.

Current release flow:

1. ✅ #399 integrated into `integration/roadmap-v1`.
2. ✅ #400 integrated after #399.
3. ✅ Umbrella release candidate #401 exists as draft (`integration/roadmap-v1 -> main`).
4. ✅ Baseline integrated head after #400 passed Application Build, Validate Kyrub, Store Security Rules and Identity Security Rules.
5. 🟡 PR #403 executes the formal Phase 10 pre-release validation against this integrated candidate.
6. ⏳ When #403 is fully green, integrate its validation gates/fixes/docs into `integration/roadmap-v1`.
7. ⏳ Re-run #401 checks on the resulting final release-candidate head.
8. ⏸️ Merge #401 into `main` only after explicit owner authorization.
9. ⏳ After the authorized release, verify deployed SHA and run production smoke/E2E before declaring the old 67-point roadmap formally closed.

## Phase 10 / 67-point closure

The historical 67-point roadmap remains a **coverage checklist**, not the priority engine for new product work. Current architectural priority is tracked by issue #402 — Kyrub Operation Engine.

The final historical gates are:

### #63 — Cross-domain E2E

Pre-release evidence is now provided by an integrated contract that follows one authoritative paid purchase through payment/provider authority, CustomerOrder materialization, economic ledger, delivery allocation, Store Points, seller/KDS, delivery opportunity and inventory lineage.

This automated contract is not falsely labeled as a real Pix transaction in production. Production smoke/E2E remains coupled to #65.

### #64 — Security Regression

Current release gates include:
- Store Security Rules;
- Identity Security Rules;
- broad application/regression suite;
- serverless ESM graph validation;
- production dependency audit.

Safe dependency fixes removed all discovered HIGH/CRITICAL production advisories. A remaining moderate transitive `uuid` advisory in the Firebase Admin/Google Cloud Storage chain is tracked explicitly in issue #404 instead of forcing a breaking downgrade.

### #65 — Production Verification

Cannot be completed before the release exists.

Required after authorized #401 merge:
- expected release SHA equals deployed production SHA;
- production health/smoke checks;
- critical flow verification;
- production E2E where appropriate and explicitly authorized.

### #66 — Documentation Drift

Phase 10 compares code against architecture and product documentation. Material drift already found and corrected includes:
- canonical Operation Engine domains;
- institutional store identity vs human actor;
- canonical-first customer orders and legacy compatibility;
- provider-webhook payment authority;
- economic ledger vs settlement/wallet;
- Store Points separation;
- current Kyrubia Action/Policy/Receipt architecture.

### #67 — Phase Closeout

A pre-release closeout is generated by Phase 10. The final 67/67 closeout remains conditional on #65 because production verification cannot be inferred from CI or a merge.

## Product roadmap after this release

New work follows **architectural dependencies**, not historical item numbering. Issue #402 is the roadmap master.

Recommended dependency order:

1. Payments, obligations and settlements:
   `Payment -> Allocation -> Obligation -> Settlement -> Reconciliation`;
2. real staff memberships, roles and institutional capabilities;
3. omnichannel/store connections as adapters over canonical domains;
4. fulfillment/delivery on the same canonical order engine;
5. dispute/resolution domain with compensating facts;
6. remaining Loyalty/Gamification/Clubs gaps;
7. Governance/Legal/Trust completion;
8. Kyrubia and external agents over the same Policy/Action Engine;
9. expansion experiences such as Freelas, Agenda and additional income/financial services only when their underlying rails exist.

A wallet must not appear before authoritative obligations/settlements exist. A marketplace must not become a second catalog/order authority. A new AI action must not bypass the same authorization and audit layer used by the product.

## Definition of done

A feature is done only when all applicable layers agree:

`canonical model -> authorization -> server authority -> persistence -> projection/UI -> tests -> integration -> production validation`

A green isolated PR is implementation-ready, not production-complete. A green release candidate is release-ready, not production-verified.
