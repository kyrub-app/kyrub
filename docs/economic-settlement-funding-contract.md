# Economic settlement funding contract

## Boundary

An eligible obligation is not proof that its payer has already funded settlement.

For `delivery_paid_waiting`, the obligation records who must fund the courier payable (`payer` / `payerPrincipalId`). It intentionally does not reuse the customer's original payment because paid waiting is born after the delivery starts and has `paymentId: ''` and `sourceEconomicEntryId: ''`.

Therefore paid waiting remains blocked from the legacy settlement persistence path until explicit funding evidence exists.

## Canonical funding requirement

`deriveEconomicSettlementFundingRequirement()` returns `evidence_required` only for an eligible `delivery_paid_waiting` obligation. Payment-allocation obligations remain on their existing settlement path and are not retrofitted into this contract.

The payer is frozen by the obligation:

- `payer=store` requires `payerPrincipalId=store:{canonicalStoreId}`;
- `payer=kyrub` requires `payerPrincipalId=kyrub:platform`.

## Accepted evidence classes

The first contract recognizes only explicit authoritative funding evidence:

- store payer → `store_external_funds`;
- Kyrub payer → `kyrub_operating_funds`.

Evidence must match the obligation amount and currency, occur no earlier than eligibility, be observed no earlier than occurrence, and come from either `funding_provider_webhook` or `funding_provider_statement`.

These names describe the source of funding evidence. They do not create a bank debit, transfer, payout, wallet balance or custody relationship by themselves.

## What this PR does not do

This contract does not:

- persist funding records;
- enable paid-waiting settlement in `economicSettlementsService`;
- change an obligation to `settled`;
- reconcile paid waiting;
- debit a store;
- spend Kyrub funds;
- send a payout to a courier;
- create wallet/custodial balances;
- infer funding from `storeFundedDiscountMinor` or from the customer's payment.

A later integration may persist a validated `EconomicSettlementFundingRecord` and only then allow the paid-waiting settlement path to consume that evidence atomically.

## Audit finding

The legacy settlement persistence service currently requires a non-empty `paymentId`, a non-empty `sourceEconomicEntryId`, and `sourceAuthority=economic_allocation_snapshot`. The legacy reconciliation builder also requires a non-empty `paymentId`.

Those constraints are correct for the existing payment-derived path and intentionally keep paid waiting out of it. They must not be weakened until settlement and reconciliation can reference the explicit funding record without inventing payment attribution.
