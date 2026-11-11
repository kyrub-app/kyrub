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
5. Preserve historic XP independently from Pitanga redemption and reversals. Conversion is **never** triggered automatically when balance reaches 1,000.
6. Validate emulator scenarios: 999/1,000/2,075 Pitangas; duplicate request ID with same/different payload; two simultaneous conversions against 100 Pitangas; cancellation/reversal; unauthenticated/other UID; partial failure; retry after ambiguous response; integer overflow.
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
- Demonstrate actual Firestore Emulator transactions for two different request IDs spending the same 1,000 Pitangas, plus same-ID retries. One successful conversion, one insufficient-balance rejection, no negative balance or double credit.
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


## Concorrência de resgate identificada (11/11/2026)

`shared/gamificationRedemption.ts` recebe `currentBalanceKCoins` do chamador e verifica saldo **durante o planejamento**. `server/gamification/redemptionRepository.ts` grava débito/voucher/recibo em transação, mas **não relê saldo nem serializa com outro débito na mesma transação**. Portanto, a atomicidade de quatro documentos não equivale à proteção contra gasto simultâneo de Pitangas. É necessário auditar os chamadores e todas as operações de crédito antes de decidir a correção; não habilitar conversão enquanto resgate e conversão puderem gastar sobre visões diferentes do saldo.

`shared/gamificationLedger.ts` define `createAuditableKCoinLedgerEntry`, um **construtor puro** de lançamento auditável; não grava ganhos. Aliases `Pitanga` adicionados para novo código, mantendo formato legado persistido.


## Leitor canônico encontrado e contrato legado de API (11/11/2026)

A PR #1057 introduziu a operação autenticada `selos-kairubi-balance`, presente em `api/health.ts` na `main`, com rewrite `/api/selos-kairubi` em `vercel.json`. Ela verifica Firebase ID token, lê `adminDb.collection(\`users/${actor.uid}/rewardLedger\`).get()`, confere `entry.userId` e `entry.id` com o documento, valida cada lançamento com `assertKyrubRewardLedgerEntry` e calcula `balance: kyrubKCoinBalance(entries)`. A resposta pública usa `schemaVersion: 1` e `unit: 'selos_kairubi'` (legado). **Não renomear rota ou unidade da resposta sem inventariar consumidores e planejar versionamento.**

O saldo observado é **derivado da soma do ledger**, não de um documento `availableKCoins`. O leitor é uma consulta independente, não uma operação transacional que reserva saldo; não pode ser usado isoladamente para autorizar débitos concorrentes. A primitiva de conversão permanece bloqueada até alinhar sua fonte de saldo à autoridade persistida e coordenar atomicamente resgate/conversão. Não confundir o nome legado `selos_kairubi` dessa API com pontos de fidelidade de lojas.


## Consumidor de saldo confirmado e renomeação visual (11/11/2026)

`src/components/tabs/KyrubTab.tsx` consome `/api/selos-kairubi`, verifica explicitamente `data.unit === 'selos_kairubi'` e apresenta o saldo no cartão Recompensas. Na PR #1128, somente o título visível `Selos Kairubi` foi alterado para **Pitangas**; o contrato da API e sua validação permanecem inalterados. Antes de versionar a rota/unidade, pesquisar todos os demais consumidores; não pressupor que esse seja o único.


## Auditoria de emissão e regras (11/11/2026)

PRs #274 e #324 introduziram respectivamente o contrato do Reward Ledger e o construtor **puro** `createAuditableKCoinLedgerEntry`; PR #333 introduziu guardas **puros** de orçamento/emissão. Nenhum desses patches demonstra gravação de **ganhos** no Firestore. A busca de PRs por `rewardLedger` identificou #1057 (somente leitura); isso não comprova ausência de escritor em outras rotas. A investigação do escritor de ganho segue **inconclusiva**.

No arquivo `firestore.rules` da `main`, não há regras explícitas nomeadas `rewardLedger`, `rewardRedemptions` ou `xpLedger` (pesquisa textual no arquivo); isso **não substitui** auditoria de regras herdadas/catch-all e de acessos Admin SDK. Não assumir que o cliente possa escrever ou que todas as gravações estejam protegidas sem teste de regras.

**Condição de desbloqueio:** inventário verificável de todos os caminhos de emissão e débito, regra de autorização de escrita, teste de concorrência entre dois resgates e entre resgate/conversão, e definição de saldo único consistente com o leitor existente. A existência de um planejador de emissão não equivale à implementação do escritor.


## Revisão de escopo das regras Firestore (11/11/2026)

`firestore.rules` da `main` contém `match /{document=**} { allow read, write: if false; }` no escopo raiz. As regras de `/users/{userId}` cobrem o documento do usuário e subcoleções explicitamente nomeadas (`tasks`, `favorites`, `savedItems`, `selections`, `skills`, `stores`), **não** `rewardLedger`. A regra recursiva permissiva `match /{allData=**}` está **dentro de** `/artifacts/{tenantId}`, portanto não se aplica a `users/{uid}/rewardLedger/{entryId}`. Pela inspeção estática, o cliente Firestore não tem permissão explícita para escrever diretamente no ledger global; o Admin SDK ignora regras de segurança e exige controle próprio de autorização. Confirmar com testes no emulador antes de tratar isso como garantia de produção.


## Inventário estrutural confirmado pela árvore completa da main (11/11/2026)

A árvore Git de `main` foi consultada recursivamente (1.935 entradas, `truncated: false`). Entre os arquivos de servidor de gamificação encontrados estão `globalChallengeAdminRepository.ts`, `redemptionRepository.ts` e `xpLedgerRepository.ts`. A administração de desafios globais cria e publica definições, mas não comprova emissão de Pitangas. `xpLedgerRepository.ts` escreve XP, não crédito de Pitangas. Não foi identificado, por esse inventário de nomes, um repositório dedicado à emissão global de Pitangas; **isso não prova inexistência de gravações em outras rotas**.

### Decisão de integração segura

- Preservar o `rewardLedger` como histórico verificável e fonte do saldo observado pelo endpoint legado; não iniciar uma segunda fonte de verdade `availableKCoins` apenas para conversão.
- Antes de autorizar novos débitos, definir um ponto de serialização compartilhado por todos os escritores de créditos e débitos, incluindo resgate e conversão. Uma transação que lê somente o recibo do próprio resgate não protege contra outro débito concorrente.
- Um eventual documento materializado de saldo exige inicialização reconciliada com o histórico, atualização atômica por **todos** os escritores e migração explicitamente controlada. Sem esses três requisitos, mantê-lo desativado.
- Os testes de idempotência de resgate aprovados no CI não equivalem a testes de saldo sob concorrência. A integração da conversão permanece bloqueada até testes reais com emulador/Firestore.

## Bloqueio operacional explícito de novos resgates (11/11/2026)

A PR #1128 passou a rejeitar **novas** chamadas a `persistKyrubRedemptionAtomically` com
`REDEMPTION_BALANCE_AUTHORITY_UNAVAILABLE` após verificar a inexistência de recibo,
voucher, lançamento e auditoria anteriores. A leitura idempotente de uma operação
previamente emitida e íntegra continua permitida. O bloqueio é intencional e não
representa uma implementação de saldo transacional.

**Impacto funcional:** enquanto a PR estiver nesse estado, qualquer fluxo que dependa
desse repositório para emitir um novo voucher de recompensa ficará indisponível.
Antes do merge, verificar todos os chamadores e confirmar que não há fluxo ativo
de produção dependente dessa emissão. Não remover o bloqueio simplesmente para
restaurar a emissão: primeiro implementar o saldo canônico e o bloqueio de
concorrência compartilhado por ganhos, resgates e conversões.

**Critério de remoção:** teste real no Firestore Emulator com dois pedidos
independentes consumindo as mesmas 1.000 Pitangas (exatamente um deve vencer),
além de resgate versus conversão concorrentes, replay idempotente, migração
compatível com `rewardLedger` e confirmação de que nenhuma outra rotina de
crédito/débito contorna a autoridade de saldo.

## Cutover protocol: no implicit initialization (11/11/2026)

The test-only `users/{uid}/pitangaBalance/balance` reference is a **candidate**, not a production-approved canonical path. The live `/api/selos-kairubi` reader still derives its result from the entire `users/{uid}/rewardLedger` collection. The current redemption repository rejects new issuance until an authoritative shared balance is integrated. Do not interpret a passing emulator test as authorization to create a zero balance for an existing account.

**Preconditions before any production cutover**

1. Inventory every server and administrative writer of `users/{uid}/rewardLedger` (including reversal, expiry, manual adjustment and migration tools), and verify there are no client writes or bypasses. Record the exact commit and paths. If a writer cannot be enumerated, the cutover is blocked.
2. Choose and document a single canonical balance path, its schema/version, authorization rules, and owner. Every earn, spend, conversion, reversal and expiry writer must atomically update that same document with its ledger entry. No independent legacy writer may remain.
3. Establish a maintenance/fencing mechanism that actually prevents *all* legacy writes during bootstrap, not just a UI flag. An application-level flag is insufficient if a background worker or Admin SDK can bypass it. Verify enforcement for each writer and keep a rollback plan.
4. Under the verified write fence, read the **complete** historical reward ledger, validate document IDs, ownership, idempotency, chronological nonnegative balance and safe integers, and compare any existing projection. Reject incomplete pagination, malformed entries, inconsistent projections or negative historical balances.
5. Bootstrap the canonical balance with a deterministic migration receipt and a ledger digest/checkpoint, using a transaction or equivalent guarded protocol. Never silently overwrite an existing projection or initialize an account with historical entries to zero. If transaction limits prevent a single atomic bootstrap, use a verifiable fenced staged migration; do not claim atomicity.
6. Reconcile the ledger and projection again before opening the fence. Confirm that all newly deployed writers use the same balance document and that the public reader cannot silently disagree with the spendable balance.
7. Run Firestore Emulator races for earn/spend, spend/spend, spend/conversion and conversion/conversion; repeat same request IDs and conflicting payloads; verify reversals and expiries. Add an emulator cutover test with a pre-existing historical ledger and a concurrent legacy writer attempting to bypass the fence.
8. Release the fence only after independent review and explicit merge/deploy authorization. If any invariant fails, keep issuance/conversion disabled and preserve the original ledger. No production Pix changes are in scope.

**Current state:** the isolated transaction primitives and emulator tests do not implement this migration or fence. The read-only inspection service can identify projection drift but cannot certify a consistent snapshot while other writers are active. This is a deliberate release blocker, not a completed migration.

## Updated product direction — 11 November 2026

- **Voluntary conversion rate: 1,000 Pitangas for 1 XP** (replaces 100:1). XP remains independent and is not automatically converted.
- The suggested **R$ 0.01 per Pitanga** is a *proposed reference value*, **not** a cash balance, guaranteed redemption, withdrawal right, fixed exchange rate, or financial liability. Commercial and legal terms require separate approval.
- Possible XP milestone campaigns at **10, 50, 100, 500 and 1,000 XP** may offer physical gifts (e.g. LoRa communication devices, pitanga seedlings, NFC keychains, protective helmets or rain gear for delivery workers). These are ideas, **not active or promised benefits**. Eligibility, cumulative-versus-spendable XP, fulfillment, inventory, geography, privacy/consent, fraud controls, cost and campaign terms remain undecided.
- No gift fulfillment, address collection, payout, public conversion endpoint or production migration is authorized by this design update.
