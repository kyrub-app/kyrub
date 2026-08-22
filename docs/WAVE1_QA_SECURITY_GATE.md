# Wave 1 — QA / Security Gate

This document is the independent merge gate for the first parallel Kyrub engineering wave. It does not own implementation code from Payments, Platform/Credentials or Gamification. Its job is to make cross-domain failure modes explicit before integration.

## Scope

Wave 1 reviews these sibling workstreams:

- Payments / Mercado Pago Pix E2E (`#275`)
- Platform / integration credential metadata boundary (`#276`)
- Gamification / reward ledger foundation (`#274`)

All three workstreams originated from the same validated Control Plane base. QA must review the resulting behavior independently rather than assuming that a green implementation test suite proves the cross-domain contract.

## Payment authority gate

A merge is blocked if any browser/UI state can mark a payment as paid, materialize an order, or act as provider authority.

Required properties:

- marketplace totals are reconstructed on the trusted server from the published catalog;
- checkout creation is idempotent;
- provider payment identifiers are attached to the existing canonical PaymentIntent/Payment rather than creating a parallel financial truth;
- Mercado Pago webhook signatures are verified before authoritative provider state is accepted;
- only the canonical verified-webhook path can materialize the paid order;
- Express and Vercel expose equivalent Mercado Pago intent/webhook behavior;
- absence of provider configuration leaves the canonical payment pending rather than simulating success.

Wave 1 QA finding already resolved in the Payments workstream: the first port connected Mercado Pago only through the Vercel transport. Express/local development still created the canonical intent without attaching Pix or exposing the webhook. The workstream was corrected to keep both transports equivalent.

## Credential boundary gate

A merge is blocked if a provider credential value can be stored in an ordinary application document, returned to the browser, logged by the metadata layer, or confused with an activation flag.

Required properties:

- application records contain only opaque server-resolved references and non-sensitive metadata;
- browser-safe projections remove the opaque reference itself;
- raw credential-like keys are rejected before metadata persistence;
- runtime validation does not rely on TypeScript casts for untrusted payloads;
- saving/configuring a credential does not automatically enable production behavior;
- the physical credential backend is a separate infrastructure decision and must not be represented as configured until its IAM/API prerequisites actually exist.

Wave 1 QA finding already resolved in the Platform workstream: the initial raw-field guard covered `api_key` but not the equally sensitive `api_secret` spelling. The guard and regression coverage were expanded before merge readiness.

## Gamification gate

A merge is blocked if K-Coins become a financial settlement balance, if XP and K-Coins share mutable balance state, or if a ledger aggregate can cross user boundaries.

Required properties:

- K-Coins derive from signed ledger deltas rather than a mutable balance field;
- XP uses a separate progression ledger;
- duplicate idempotency keys are rejected;
- K-Coin redemption cannot drive the ledger below zero;
- reward definitions represent benefits/vouchers/products/services/experiences rather than cash settlement;
- ledger entries carry audit correlation/source/time metadata;
- one aggregate never combines entries from different users.

Wave 1 QA finding already resolved in the Gamification workstream: the first aggregate accepted entries from different users in one balance calculation. User isolation and audit metadata checks were added before merge readiness.

## Integration order

Do not merge sibling branches merely because they were created in parallel. Before each merge:

1. both repository workflows must be green for the exact head being integrated;
2. the PR must be mergeable against the current `main`;
3. if another Wave 1 PR has already changed `main`, re-check the remaining sibling against the new base;
4. resolve shared test-harness conflicts explicitly rather than dropping either domain's regression coverage;
5. do not activate external provider credentials or real money movement as part of these foundation merges.

## Exit condition

Wave 1 is complete only when the three implementation PRs have passed their own CI plus this cross-domain review, and the resulting `main` still passes the full Kyrub validation/build gates after integration.
