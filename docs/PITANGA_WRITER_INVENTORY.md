# Pitanga writer inventory — scoped source inspection (11 November 2026)

This inventory records **inspected files only**, not a repository-wide proof that all writers have been found. It is a release gate for PR #1128, not permission to migrate or deploy.

| Source | Observed responsibility | Global `users/{uid}/rewardLedger` writer? | Cutover status |
| --- | --- | --- | --- |
| `api/health.ts` (`selos-kairubi-balance`) | Reads complete per-user reward ledger and computes balance | No; reader | Must be reconciled with canonical projection |
| `server/gamification/redemptionRepository.ts` | Reads redemption, voucher, debit and audit in transaction; currently rejects new voucher issuance without balance authority | Existing-issuance replay only | Integrate atomic shared balance debit before enabling new issuance |
| `server/gamification/pitangaEarnTransaction.ts` | Isolated earning primitive writes reward ledger and updates supplied balance | Yes, only when invoked; not wired to live trigger | Requires canonical reference and verified caller |
| `server/gamification/pitangaSpendTransaction.ts` | Isolated spending primitive writes reward ledger and updates supplied balance | Yes, only when invoked; not wired to voucher issuer | Requires canonical reference and verified caller |
| `server/gamification/pitangaXpConversionTransaction.ts` | Isolated conversion primitive debits reward ledger, credits XP ledger and updates supplied balance | Yes, only when invoked; no public endpoint | Requires canonical reference and verified caller |
| `server/gamification/globalChallengeAdminRepository.ts` | Creates/updates/publishes administrative global challenge records under `global_challenges` | No global reward ledger write observed in this file | Challenge completion and award trigger still unverified |
| `server/gamification/globalChallengeAdminService.ts` | Admin challenge service logic | No global reward ledger write observed in this file | Challenge completion and award trigger still unverified |
| `server/payments/storeRewardService.ts` | Store reward redemption using store points ledger and `STORE_POINTS_CURRENCY` | Separate store points economy, not evidence of global Pitanga writer | Keep separate; do not redirect to global balance |
| `shared/gamificationLedger.ts` | Pure ledger entry builder/validation | No persistence | No cutover writer |

## Unresolved evidence

- Enumerate **all** global reward ledger writes across API routes, server modules, scheduled jobs, scripts, migration tools and administrative operations, including dynamic Firestore path construction and imported helpers.
- Establish whether challenge completions currently grant global Pitangas at all. A published challenge definition does not prove an award writer exists.
- Confirm whether existing global reward ledgers contain historical entries, and whether older data obeys the new schema. Do not infer a zero starting balance from a missing projection.
- Choose one canonical balance path and a real write fence enforced by every legacy writer, then prove historical bootstrap and writer handover under Firestore Emulator.
- Verify that store loyalty points and Kyrubia credits remain separate from global Pitangas.

**Decision:** no production bootstrap, redemption enablement or conversion endpoint until these unknowns are resolved. The read-only authority inspection is diagnostic, not a migration lock.
