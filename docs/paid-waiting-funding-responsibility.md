# Paid waiting funding responsibility

Paid waiting creates a courier economic obligation whose beneficiary is the courier and whose declared funding responsibility is frozen by the delivery waiting policy snapshot.

## Separate economic dimensions

`beneficiaryPrincipalId` answers who is entitled to the obligation.

`payerPrincipalId` answers who the frozen waiting policy declares as responsible for funding that obligation.

These fields are not interchangeable and must never be netted or inferred from each other.

## Supported payer authorities

For `sourceAuthority = delivery_paid_waiting`:

- `payer = store` requires `payerPrincipalId = store:{canonicalStoreId}`;
- `payer = kyrub` requires `payerPrincipalId = kyrub:platform`.

Any mismatch fails closed.

## Read projection semantics

The funding-responsibility projection is derived from canonical `economicObligations`; it is not persisted as a second monetary authority.

Its lifecycle buckets describe the state of the courier obligation:

- `pendingMinor`: obligation still pending;
- `eligibleMinor`: courier obligation eligible;
- `settledObligationMinor`: courier obligation has reached settled status;
- `reversedMinor`: obligation reversed.

`settledObligationMinor` does **not** claim that a store bank account was debited, that Kyrub moved funds, or that a payer-side financial rail settled. It only describes the lifecycle of the underlying courier obligation.

## Deliberate exclusions

This projection does not:

- charge or debit a store;
- debit Kyrub;
- create a payment instruction;
- execute settlement or payout;
- create wallet or custodial balance;
- merge paid waiting into the original delivery-fee obligation;
- mutate `adminPlatformEconomy` payment-ledger semantics.
