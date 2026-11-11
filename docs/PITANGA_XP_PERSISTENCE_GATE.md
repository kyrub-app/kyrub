# Pitangas → XP: persistence gate (PR #1128)

## Verified in main (11 November 2026)

- `shared/gamification.ts` defines `KyrubRewardLedgerEntry` with `deltaKCoins`, `type`, `idempotencyKey` and `kyrubKCoinBalance`; it does **not** establish a Firestore persistence path for the reward ledger.
- `server/gamification/xpLedgerRepository.ts` writes XP to `users/{uid}/xpLedger/xp_{idempotencyKey}` in a Firestore transaction and rejects conflicting replays. It is **not** a cross-ledger atomic conversion API.
- `shared/globalChallengeCatalog.ts` filters eligible published global challenges in memory. It is not a public HTTP endpoint.
- `server/gamification/globalChallengeAdminRepository.ts` handles admin challenge drafts and publication; it does not award Pitangas or XP.
- Existing `rewardXp` and `rewardKCoins` are separate fields in challenge definitions; awarding both must not silently trigger an additional automatic XP conversion.

## Gate before implementing a persisted conversion

1. Find and verify the **canonical persisted K-Coin/reward ledger** and any existing spend/reservation service. If none exists, propose one explicitly and verify Firestore security rules and data ownership; do not invent a parallel balance collection.
2. Define one trusted authenticated server action taking a client-provided *conversion request ID* and requested XP amount, never trusting a client balance or a client UID.
3. In one Firestore transaction, read authoritative spendable balance, verify sufficient Pitangas, create one debit entry with deterministic ID, and create one XP credit entry in the existing XP ledger. Firestore requires all reads before writes. Enforce a stable request receipt and compare immutable request parameters on retries.
4. For concurrent requests, ensure the spendable balance is serialized via a transactionally updated balance/lock document or equivalent authoritative mechanism; simply summing a collection without a shared concurrency control is insufficient. Reject negatives, duplicate debits, overflow and cross-user access.
5. Preserve historic XP independently from Pitanga redemption and reversals. Conversion is **never** triggered automatically when balance reaches 100.
6. Validate emulator scenarios: 99/100/275 Pitangas; duplicate request ID with same/different payload; two simultaneous conversions against 100 Pitangas; cancellation/reversal; unauthenticated/other UID; partial failure; retry after ambiguous response; integer overflow.
7. Keep Pix disabled and do not merge or deploy before independent review.

The current pure planner in `shared/pitangaXpConversion.ts` is intentionally **not** a persistence implementation or a publicly callable conversion endpoint. The tests in this PR are source tests, not proof of emulator transaction safety.
