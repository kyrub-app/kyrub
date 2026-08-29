# Kyrub — Phase 10 Integrated Validation Closeout

Date: 2026-08-29

Scope: historical roadmap items #63–#67, evaluated against the integrated release candidate after #399 and #400.

This document is intentionally strict about the difference between **implementation**, **integration**, **release readiness** and **production verification**.

## Release-candidate baseline

The convergence phase produced one canonical integration line containing the feature ancestry through #400. The umbrella release candidate is PR #401 (`integration/roadmap-v1 -> main`).

After #399 and #400 were incorporated, the integrated head passed:

- Application Build — PASS;
- Validate Kyrub — PASS;
- Store Security Rules — PASS;
- Identity Security Rules — PASS.

PR #403 adds the explicit Phase 10 release gates, dependency-security fixes and documentation drift corrections. It must itself pass before these changes are incorporated into `integration/roadmap-v1`.

---

## #63 — Cross-domain E2E

**Pre-release status: PASS — integrated contract**

**Production status: PENDING #65**

Evidence now covers one coherent purchase lineage across domains rather than isolated module tests:

`storefront / checkout`
→ `server-side PaymentIntent`
→ `verified provider event`
→ `canonical payment`
→ `CustomerOrder materialization`
→ `economic capture/allocation`
→ `Store Points purchase entry`
→ `seller inbox / KDS`
→ `delivery opportunity when applicable`
→ `inventory reconciliation`

The Phase 10 contract validates that the same `storeId`, `orderId`, `paymentId`, `paymentIntentId` and provider authority remain correlated across economic and loyalty facts.

It also locks the invariant that:

- Store Points do not automatically create K-Coins, XP or vouchers;
- delivery fee allocation remains explicit and distinct from unrelated economic facts;
- seller UI does not create a second `paid` authority;
- delivery opportunities retain the source order lineage;
- configured product lines still reach inventory impact/reconciliation.

### Important limitation

This automated contract is **not** a claim that a new real Pix transaction was executed in production during Phase 10. Real production smoke/E2E belongs to #65 after an authorized release.

---

## #64 — Security Regression

**Status: PASS WITH TRACKED MODERATE RESIDUAL**

### Authorization and data-boundary evidence

Release candidate security validation includes:

- Store Security Rules emulator/workflow — PASS;
- Identity Security Rules emulator/workflow — PASS;
- authentication/tenant/migration contracts within the broader build suite — PASS;
- serverless ESM dependency graph normalization and validation — PASS.

### Dependency audit

Initial integrated `npm ci` exposed:

- 7 moderate advisories;
- 3 high advisories.

This was treated as a release blocker rather than ignored.

Safe lockfile remediation removed all HIGH/CRITICAL findings, including advisories in:

- `brace-expansion`;
- `ip-address`;
- `nanoid`.

The release gate now executes:

`npm audit --omit=dev --audit-level=high`

and fails on any production HIGH/CRITICAL advisory.

### Residual risk

Five moderate audit occurrences remain from the same transitive chain:

`firebase-admin -> @google-cloud/storage -> teeny-request/retry-request -> uuid < 11.1.1`

The npm forced remediation proposes a breaking downgrade to `firebase-admin@10.3.0`; this was deliberately rejected because a security process must not replace a moderate transitive advisory with an unreviewed platform regression.

Residual tracking: **issue #404**.

Release policy:

- HIGH/CRITICAL production advisory = blocking;
- moderate residual must be documented, scoped and tracked;
- severity increase or safe compatible upstream fix must trigger reassessment.

---

## #65 — Production Verification

**Status: BLOCKED CORRECTLY — OWNER/RELEASE GATE**

This item cannot be honestly completed while PR #401 remains unmerged and production remains on the previous release line.

Required sequence:

1. all pre-release Phase 10 gates green;
2. explicit owner authorization to merge #401 into `main`;
3. release/deployment completes;
4. compare expected release SHA with the SHA actually served in production;
5. execute production health/smoke checks;
6. execute the agreed critical-path E2E, including real external rails only when explicitly authorized and appropriate;
7. record any exception instead of inferring success from CI.

Until these steps occur, the historical 67-point roadmap is **not formally 67/67 closed**.

---

## #66 — Documentation Drift

**Status: PASS — material drift corrected in Phase 10 branch**

The audit found genuine architecture drift, not only wording differences.

### `docs/ARCHITECTURE.md`

It previously underrepresented the current system and omitted important canonical boundaries. It now documents:

- Kyrub Operation Engine domains;
- human actor vs institutional store principal;
- canonical store-scoped orders;
- temporary `/artifacts` migration compatibility;
- local service / pickup authority;
- provider-webhook financial authority;
- economic ledger facts vs wallet/settlement;
- Store Points isolation from K-Coins/XP;
- CRM as projection;
- delivery as fulfillment of the canonical order;
- Action/Policy/Receipt model for Kyrubia;
- release/security gates.

### `docs/KYRUBIA.md`

It previously said that `create_note` was still the only enabled action. It now reflects the broader official action foundation: deterministic reads, notes/tasks, product/catalog actions, private drafts, multimodal context and authoritative receipt verification.

### `docs/ROADMAP_INTEGRATION.md`

It now records #399/#400 as integrated, points to #401 as the sole release candidate and treats issue #402 as the current architecture-priority roadmap.

### MCP review

`docs/KYRUBIA_EXTERNAL_MCP.md` was checked during drift review. Its pending OAuth/write limitations remain explicitly documented and consistent with the rule that MCP must reuse Kyrub policy/confirmation/receipt authority rather than write directly to Firestore.

---

## #67 — Phase Closeout

**Pre-release status: PASS — closeout generated**

**Final historical status: PENDING #65**

### Implemented / integrated

The current release candidate consolidates the post-#376 wave through #400, including:

- Store Points / Challenges / Rewards / relationship;
- personalized vs promotional discovery;
- CRM projection;
- institutional store identity;
- customer ↔ store chat;
- notifications, communication preferences and campaigns;
- local attendance and Local Service PDV projection;
- canonical-first customer orders;
- canonical economic ledger;
- Admin Platform Economy;
- economic fees/subsidies;
- chargebacks/cancellations lifecycle economics.

### Validated pre-release

- baseline integrated build — PASS;
- Validate Kyrub — PASS;
- Store Security Rules — PASS;
- Identity Security Rules — PASS;
- cross-domain release contract — PASS after correcting the test expectation to the existing canonical Store Points idempotency contract;
- production HIGH/CRITICAL dependency audit — PASS after safe lockfile remediation;
- documentation drift — corrected;
- residual moderate dependency advisory — tracked in #404.

### Correctly still pending

- production verification / expected SHA === served SHA;
- post-release production smoke/E2E;
- any external-money action requiring an explicit owner gate;
- final declaration that the historical 67-point roadmap is fully closed.

### Next roadmap

New development should no longer be prioritized by the smallest open number in an old list.

The master architecture backlog is issue **#402 — Kyrub Operation Engine**, with the next dependency-oriented gates:

1. Payments, Obligations & Settlements;
2. Identity, Staff & Institutional Authorization;
3. Omnichannel / Store Connections;
4. Fulfillment & Delivery Engine;
5. Disputes / Resolution;
6. Loyalty / Gamification / Clubs completion;
7. Governance / Legal / Trust;
8. Kyrubia as the shared operating layer;
9. expansion experiences only when the underlying engine domains support them.

---

## Current release decision

**Phase 10 pre-release conclusion:** the integrated candidate is eligible to continue toward release once PR #403 is green and incorporated into `integration/roadmap-v1`.

**Not authorized by this document:** merging PR #401 into `main` or declaring production verified.

Final production closeout must append the actual release SHA, deployed SHA, smoke/E2E results and any production exceptions after the explicit release authorization.
