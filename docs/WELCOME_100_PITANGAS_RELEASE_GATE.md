# KYRUB — 100 Pitangas welcome: writer cutover gate

Status: **BLOCKED for production activation**. This inventory is a code-level review, not evidence that every deployed writer has been fenced.

## Verified canonical primitives (main)

| Module | Canonical balance | Behavior | Fence coverage |
| --- | --- | --- | --- |
| `pitangaEarnTransaction.ts` | `users/{uid}/pitangaBalance/balance` | Requires existing balance; writes earn ledger | No fence read in primitive |
| `pitangaSpendTransaction.ts` | same | Requires existing balance; writes debit ledger | No fence read in primitive |
| `pitangaMigrationBootstrapTransaction.ts` | same | Creates balance from independently verified historical checkpoint | Explicitly validates fenced epoch |
| `cleanBaselineWelcomeTransaction.ts` (PR #1135) | same | Creates balance only when balance and reward ledger are empty | Called through guarded signed-session service |
| `signedSessionWelcomeService.ts` (PR #1135) | same | Requires `writersVerified: true` and matching epoch | Explicit transaction read |
| `pitangaLegacyWriterFence.ts` | control document | Helper for legacy writers; missing fence allows legacy operation | Helper does not install itself |

## Mandatory release conditions

1. Inventory every deployed server/client/admin writer of `pitangaBalance`, `rewardLedger`, and legacy Pitanga state, including indirect writes, jobs and old deployments.
2. Prove all historical balances and ledger entries are reconciled; new-account clean-baseline grant must not overwrite existing state.
3. Ensure every conflicting legacy writer observes a compatible transaction fence or is retired. A `writersVerified` document alone is insufficient.
4. Prove authenticated Firebase session source and idempotency with Auth + Firestore Emulator, including account creation, retries and concurrency.
5. Review the campaign effective timestamp and feature flags. The feature flag must remain OFF until explicit release authorization.
6. Test a real deployed staging path without payments or production users before production rollout.

**Not authorized:** enabling welcome feature flags, writing a production fence, modifying production balances, merging PR #1135 or deploying.

## Current validation

The isolated Firestore Emulator tests exercise atomic welcome credit, concurrent replay, and refusal to overwrite existing balances or historical ledgers. They do **not** prove all legacy writers are fenced, nor do they exercise the actual Firebase Auth registration callback.

## Additional compatibility finding — spending of welcome credits

The verified XP conversion and voucher issuance wrappers (`pitangaVerifiedXpConversion.ts` and `pitangaVerifiedVoucherIssuance.ts`) require a historical migration receipt and `migrationEpoch` on the balance. The new-account welcome transaction intentionally creates neither. Therefore, a user granted 100 welcome Pitangas **cannot yet spend or convert them through these verified wrappers**. Do not represent the welcome balance as fully redeemable until a separately audited clean-baseline eligibility path is implemented and tested; do not fabricate a migration receipt.

The server-side conversion and voucher adapters currently expose no public routes. This is a **release blocker for usable rewards**, separate from one-time credit correctness.
