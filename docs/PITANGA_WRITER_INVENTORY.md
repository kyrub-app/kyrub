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
| Historical migration | Read-only verifiers plus isolated `bootstrapVerifiedPitangaBalanceInTransaction` | Transactionally reads ledger, checks checkpoint and creates balance plus receipt; not connected to an approved cutover job | **No** | Blocked |
| Store points and CRM rewards | Store-specific services and ledger | Separate economy | Not applicable to global Pitangas | Must remain separate |

**Cutover acceptance criteria (all required):**

1. Enumerate and trace actual production callers, including scheduled/background jobs and external integrations; identify the deployed versions and all Firestore mutation paths.
2. Enforce a server-side write fence on **every** legacy global reward-ledger writer, including administrator tools, before beginning a historical snapshot. Prove stale deployed writers cannot bypass it.
3. Capture a complete ledger at a verified fence epoch, validate every historical record and create a deterministic checkpoint. A caller-supplied `legacyWritersFenced: true` flag is **not evidence** of enforcement.
4. Bootstrap the canonical balance and migration receipt atomically with idempotent conflict handling; recheck the checkpoint and fence epoch in the same controlled cutover.
5. Switch **all** authorized earn/spend/voucher/conversion paths to the canonical transactional balance, with emulator race tests and a rollback/incident plan.
6. Obtain independent review and explicit deployment approval. Do not infer readiness from green CI alone.

**Current conclusion:** an isolated atomic historical bootstrap and emulator tests exist, but there is no approved cutover job or production-wide write fence. The caller-provided `legacyWritersFenced` flag does not establish real enforcement. The PR must not be merged as a complete, user-facing rewards release.


## Confirmed transaction-primitive call graph and migration fence (11 November 2026)

The branch contains `pitangaLegacyWriterFence.ts`, a transaction-scoped guard reading `systemControl/pitangaLegacyWriterFence`. The Firestore Emulator tests exercise the guard directly and demonstrate rejection after `fencing` or `fenced`, including a race against activation. **Those tests do not establish that any production writer invokes the guard.** The guard intentionally allows a missing control document for pre-cutover compatibility; that behavior cannot authorize historical migration.

The inspected global operations have these entry-point constraints:

- `redemptionRepository.ts`: the existing public-facing persistence path retains idempotent replay and rejects all *new* voucher issuance with `REDEMPTION_BALANCE_AUTHORITY_UNAVAILABLE`. It does not call the isolated `issuePitangaVoucherInTransaction` primitive.
- `pitangaEarnTransaction.ts`, `pitangaSpendTransaction.ts`, `pitangaXpConversionTransaction.ts`, `pitangaVoucherIssuanceTransaction.ts`: transaction primitives, not confirmed active production routes. The global challenge administrative endpoints manage definitions, not completed-award credits.
- `pitangaMigrationVerifiedBootstrap.ts`: reads the historical ledger in a Firestore transaction, validates the checkpoint, then delegates to `pitangaMigrationBootstrapTransaction.ts` to verify the fence document and atomically create balance and receipt. This is **implemented but unwired**, and a `writersVerified: true` document alone cannot attest that older deployed services are fenced.

**Deployment hazard:** a green CI suite does not eliminate the fail-closed voucher restriction or prove writer coverage. Before merge, either explicitly accept the user-facing voucher restriction as a separately approved release behavior, or connect the atomic voucher path after a verified migration. Do not treat the current branch as a completed Pitangas/XP release.

## CI artifact triage — 20 lexical mutation candidates (run 43105952285)

The downloaded `pitanga-ledger-access-inventory` artifact for commit `5771a2a` reports 1,011 tracked JS/TS files, 96 lexical hits and **20 possible mutation lines**. Classification of those 20 lines by source context:

| Candidate lines | Count | Classification |
| --- | ---: | --- |
| `pitangaEarnTransaction.ts:71`, `pitangaSpendTransaction.ts:62`, `pitangaVoucherIssuanceTransaction.ts:90`, `pitangaXpConversionTransaction.ts:98` | 4 | Canonical global Pitanga balance updates in isolated, unwired transaction primitives; require verified migration and shared lock |
| `xpLedgerRepository.ts:49` | 1 | XP ledger write; separate from global Pitanga reward ledger |
| `globalChallengeAdminRepository.ts:63` | 1 | Global challenge definition status update, not a Pitanga award |
| `globalChallengeAdminRateLimit.ts:41` | 1 | Administrative rate-limit state |
| `globalChallengeVisualServer.ts:53,73,75` | 3 | Visual test seed writes (challenge definitions, admin profile, rate limits), not production Pitanga awards |
| `storeChallengeProcessor.ts:469`, `storeRewardService.ts:266-268`, `src/utils/storeChallenges.ts:121`, `src/utils/storeRewards.ts:107` | 6 | Store-specific reward/points operations; do not conflate with global Pitangas |
| `globalChallengeAdminHandler.ts:15`, `globalChallengeAdminRateLimit.ts:28`, `pitangaMigrationSnapshot.ts:34,51` | 4 | Non-Firestore methods (`Set.add`, `Hash.update`); lexical false positives |

**Reconciliation:** 4 + 1 + 1 + 1 + 3 + 6 + 4 = 20. This triage classifies the scanner's **matched lines only**; it is not a complete mutation call graph. The scanner misses methods invoked through aliases and operations split across multiple lines, and does not prove coverage of external/background writers. No new live global award writer is established by this artifact.

**Blocking action:** inspect actual deployed callers and all rewardLedger writes, then enforce the legacy fence across them before activating historical migration. Do not merge solely because this artifact has been triaged.


## Production commit comparison — 12 November 2026

Read-only comparison against the Vercel production deployment on `main` at
`6389794796d85af9c4c6142e316abfeb15ce6806` (deployment
`dpl_CxMoSxkvcHfrdhQ6QddUMFQNHFWe`):

- **Confirmed deployed legacy ledger writer:** `server/gamification/redemptionRepository.ts`,
  `persistKyrubRedemptionAtomically`, calls `transaction.create(ledgerRef, ...)`
  on `users/{uid}/rewardLedger/{redemptionId}_debit` when issuing a new voucher.
  It does not acquire/update `users/{uid}/pitangaBalance/balance` and does
  not read `systemControl/pitangaLegacyWriterFence`. Its deployed code can
  therefore bypass the new branch's fence if left running at cutover.
- **PR behavior differs materially:** the branch's `redemptionRepository.ts`
  rejects new issuance with `REDEMPTION_BALANCE_AUTHORITY_UNAVAILABLE`,
  preserving only validated replay. This must be explicitly approved as a
  user-visible restriction or replaced with the verified atomic voucher path
  after cutover; it must not be silently merged.
- `server/gamification/globalChallengeAdminRepository.ts` at that production
  SHA writes `global_challenges` definitions and audit subcollections, not
  `users/{uid}/rewardLedger`. The admin handler is not evidence of a
  deployed global award-credit writer.
- The isolated `pitangaVoucherIssuanceService.ts` on this PR constructs
  canonical references and invokes the migration-verified transactional gate,
  but has **no public route** and does not fence the deployed legacy writer.

**Release blocker:** enumerate and control every deployed writer (including
background/external versions), then prove stale deployments cannot continue
writing the legacy ledger. This comparison confirms one deployed writer,
not exhaustive production writer coverage. No production fence or migration
was activated by this investigation.
