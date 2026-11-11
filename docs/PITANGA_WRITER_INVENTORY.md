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

## Additional route and processor inspection (11 November 2026)

- `server/gamification/globalChallengeAdminHandler.ts` routes administrative create/read/update/publish operations through the admin service; no challenge-completion reward ledger write observed in this handler.
- `server/gamification/globalChallengeAdminValidation.ts` validates challenge definitions and queries; no persistence of earned Pitangas observed.
- `server/payments/storeChallengeProcessor.ts` processes **store** challenge contributions and imports `StorePointLedgerEntry` from `shared/storePoints.ts`; it is not evidence of a global Pitanga award writer.
- `server/payments/storeRewardRouter.ts` routes **store** reward operations to `storeRewardService.ts`, not to the global `redemptionRepository.ts`.
- `server/gamification/xpLedgerRepository.ts` reads/writes `users/{uid}/xpLedger`, which is a separate economy from `users/{uid}/rewardLedger`.

The recursive branch file tree contains the expected global gamification modules, but **a filename inventory cannot prove absence of dynamically constructed ledger writes elsewhere**. A repository-wide symbol/path search plus call-graph review remains mandatory before cutover. No global challenge-completion-to-Pitanga-award endpoint was established by these inspections.

**Important functional release condition:** `redemptionRepository.ts` intentionally rejects *new* voucher issuance. Shipping the current branch unchanged would preserve that restriction. A green CI result does not certify readiness for user-facing redemption.

## CI lexical scan evidence — commit bde3c0e (11 November 2026)

The GitHub Actions artifact `pitanga-ledger-access-inventory` from Validate Kyrub run `43083761584` was downloaded and inspected. Its JSON reports **1,005 tracked JS/TS files scanned** and **54 matching source lines**, distributed over 12 paths. This is an inventory of references, **not 54 writers**.

Relevant global paths: `api/health.ts` (4 hits), `server/gamification/pitangaBalanceAuthorityInspection.ts` (10), `pitangaBalanceReconciliation.ts` (4), `pitangaEarnTransaction.ts` (5), `pitangaSpendTransaction.ts` (5), `pitangaXpConversionTransaction.ts` (5), and `redemptionRepository.ts` (7). The scanner itself contributes 7 self-matches. The remaining matches are store CRM/relationship/reward code and UI.

**Finding:** among these lexical matches, no additional global Pitanga challenge-completion award writer was identified. This is *not* proof of absence: indirect imports, alternate names, dynamic paths, Cloud Functions and external workers require manual tracing.

**Release gate:** verify callers of each global transaction primitive, review `api/health.ts` balance semantics, and replace fail-closed new voucher issuance only after the canonical balance migration/write fence is proven. Do not migrate or enable the public conversion API based solely on this scan.


## Operational write-fence coverage matrix (11 November 2026)

This is a release-blocking **coverage map**, not a declaration that a fence exists.
A lexical scan cannot certify that all production writers have been fenced.

| Operation | Current entry point | Canonical balance lock | Production fence verified | Release status |
| --- | --- | --- | --- | --- |
| Global Pitanga earning | `applyPitangaEarnInTransaction` (isolated primitive; no confirmed challenge completion caller) | Candidate `users/{uid}/pitangaBalance/balance` | **No** | Blocked |
| Global Pitanga spending | `applyPitangaSpendInTransaction` (isolated primitive) | Same candidate | **No** | Blocked |
| Global voucher issuance | `issuePitangaVoucherInTransaction` (isolated primitive, not connected to public redemption) | Same candidate | **No** | Blocked |
| Legacy voucher issuance | `persistKyrubRedemptionAtomically` | No authoritative balance for new issuance; explicitly fails closed | **No** | New issuance blocked; existing replay only |
| Pitanga-to-XP conversion | `applyPitangaXpConversionInTransaction` (isolated primitive; no public endpoint) | Same candidate | **No** | Blocked |
| Historical migration | Read-only snapshot/checkpoint verifiers | No write transaction or migration receipt | **No** | Blocked |
| Store points and CRM rewards | Store-specific services and ledger | Separate economy | Not applicable to global Pitangas | Must remain separate |

**Cutover acceptance criteria (all required):**

1. Enumerate and trace actual production callers, including scheduled/background jobs and external integrations; identify the deployed versions and all Firestore mutation paths.
2. Enforce a server-side write fence on **every** legacy global reward-ledger writer, including administrator tools, before beginning a historical snapshot. Prove stale deployed writers cannot bypass it.
3. Capture a complete ledger at a verified fence epoch, validate every historical record and create a deterministic checkpoint. A caller-supplied `legacyWritersFenced: true` flag is **not evidence** of enforcement.
4. Bootstrap the canonical balance and migration receipt atomically with idempotent conflict handling; recheck the checkpoint and fence epoch in the same controlled cutover.
5. Switch **all** authorized earn/spend/voucher/conversion paths to the canonical transactional balance, with emulator race tests and a rollback/incident plan.
6. Obtain independent review and explicit deployment approval. Do not infer readiness from green CI alone.

**Current conclusion:** the read-only verifiers and concurrency tests improve confidence, but neither a production write fence nor an atomic historical bootstrap has been implemented. The PR must not be merged as a complete, user-facing rewards release.
