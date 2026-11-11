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

## Explicitly excluded: store loyalty points

The existing `shared/storePoints.ts` and `tests/store-points-ledger.test.ts` implement **per-store customer loyalty points**, not the platform-wide Pitanga/K-Coin economy. Their entries are scoped to `storeId`, `customerId`, purchases, refunds and store rewards. The payment webhook uses `storePointLedgerPath`. **Never debit store loyalty points for Pitanga → XP conversion** and never infer a Pitanga balance from these entries.

Likewise, `economicLedger` tracks real-money marketplace activity and must never fund a gamification conversion.

## Concrete integration acceptance criteria

- Locate a production writer of the **global** `KyrubRewardLedgerEntry` and its Firestore path. If none exists, first establish a single canonical global reward ledger and its authorized writer/reader; a type declaration or UI projection is insufficient evidence.
- Confirm how the global ledger's available balance is serialized across simultaneous earns, spends, refunds and conversions. The transaction primitive currently assumes an `availableKCoins` balance document, but **no such canonical document has been verified**. Do not instantiate it by assumption.
- In the final server adapter, derive user identity from a verified Firebase token and construct all document paths on the server. The primitive's caller-supplied references are trusted-code-only.
- The conversion debit must share the exact canonical global reward-ledger accounting domain. The XP credit must use `users/{uid}/xpLedger`, with sourceType `conversion`, and be visible to `readVerifiedKyrubXpTotal`.
- Demonstrate actual Firestore Emulator transactions for two different request IDs spending the same 100 Pitangas, plus same-ID retries. One successful conversion, one insufficient-balance rejection, no negative balance or double credit.
- Only after these checks: independent security review, then separately authorized merge and deploy.


## Inventário de compatibilidade de nomenclatura (11/11/2026)

- `shared/gamification.ts`: `KyrubRewardLedgerEntry` e campos legados `deltaKCoins`, `rewardKCoins`, `costKCoins`; aliases canônicos `KyrubPitangaLedgerEntry` e `kyrubPitangaBalance` foram adicionados sem regravar dados.
- `shared/gamificationEconomies.ts` (introduzido pela PR #320): identificador técnico `k_coin` diferencia a moeda global de `kyrub_xp`, `store_loyalty_points` e `kyrubia_credits`. Não alterar esse discriminador em dados existentes sem inventário de todos os consumidores.
- `server/gamification/xpLedgerRepository.ts`: ledger XP persistente confirmado; **não é** a autoridade do saldo de Pitangas.
- `server/gamification/globalChallengeAdminRepository.ts`: grava definições de desafios em `global_challenges`; **não comprova** emissão nem débito de Pitangas.
- A pesquisa de código do conector GitHub não retornou ocorrências nem de símbolos confirmados em arquivos conhecidos. Resultado vazio **não demonstra ausência de escritor**.

### Critério para concluir a descoberta do escritor

Localizar em código verificável (1) o caminho Firestore do ledger global, (2) o serviço que grava ganhos/resgates, (3) o controle de concorrência e saldo, (4) todas as leituras e projeções, (5) o identificador `k_coin` e os campos legados usados em dados persistidos. Somente então planejar migração de esquema e conectar a transação de Pitangas → XP. Não criar ledger ou saldo paralelo.


## Descoberta confirmada: escritor de resgate (11/11/2026)

O arquivo **presente em `main`** `server/gamification/redemptionRepository.ts` implementa `persistKyrubRedemptionAtomically` e cria, numa transação Firestore, um débito em `users/{userId}/rewardLedger/{ledgerEntryId}`, além de `rewardRedemptions`, `rewardVouchers` e `rewardAudit`. O lançamento tem `economy: 'k_coin'` e usa os campos legados de `plan.debitEntry`. Histórico da implementação: PR #344.

**Consequência obrigatória:** a primitiva atual `pitangaXpConversionTransaction.ts` ainda pressupõe um documento `balanceRef` com `availableKCoins`, que **não é usado por esse escritor de resgate**. Não conectar a primitiva, não introduzir esse saldo paralelo nem renomear `k_coin` ou `deltaKCoins` nos documentos persistidos antes de verificar todos os escritores e leitores. A descoberta é de um escritor de **débito**, não de emissão/ganho; tampouco comprova o cálculo autoritativo do saldo ou proteção contra gastos concorrentes entre resgate e conversão.

**Próximo bloqueio:** localizar emissor/ganho global, leitores e projeção do saldo; definir serialização transacional única para resgate e conversão (e revalidar o débito de resgate contra saldo sob concorrência). Só depois ligar conversão e planejar migração dos campos.
