# Pitangas — evidence of deployed writers (release blocker)

Atualização de 15/11/2026: consultas autenticadas adicionais a Cloud Asset, Logging e Monitoring e a entrega consolidada estão em [GAMIFICATION_ACTIVATION_DELIVERY.md](GAMIFICATION_ACTIVATION_DELIVERY.md). As APIs desabilitadas não comprovam ausência; Monitoring retornou duas séries de uso de chaves no período. As pendências abaixo não exigem reiniciar a auditoria estática já documentada.

## Scope and observed facts (2026-11-15)

- Vercel project: `kyrub` (`prj_X7hpqaftcikyA8jAK7Iec8HOkqqp`).
- Production deployment: `dpl_2khudc1LbDJCS5iXYJ8NwUqvMXzK`, READY.
- Production Git commit: `5fc6c53233bfc05dd7025111aae90530f9d46bc2` on `main`.
- Production aliases include `www.kyrub.com`, `admin.kyrub.com`, `planos.kyrub.com`.
- PR #1135 changes are **not** part of that production commit.
- At the production commit, `firebase.json` configures Firestore and Storage but **does not** configure Cloud Functions. This does **not** prove that no Cloud Functions or external writers are deployed.
- `vercel.json` configures serverless routes and an orders queue consumer. This does **not** establish a complete Pitanga writer inventory.
- Vercel deployment file-tree API returned 404 (file tree not found). Use the recorded deployment Git SHA to review repository source, not as proof of runtime coverage.

## Evidence still required (do not infer or fabricate)

1. List deployed Cloud Functions (both generations), Cloud Run services/jobs, scheduled jobs, Pub/Sub/queues, and external integrations for Firebase/GCP project `kyrub-b8d0e`, using authorized read-only cloud inventory.
2. Enumerate Vercel production functions and active revisions, and trace all paths writing Pitanga balances, reward ledgers, conversion receipts and voucher records.
3. For each deployed writer: record owner, service/revision, triggering event, Firestore collection paths, code SHA, and whether the **actual transaction** checks the canonical fence.
4. Identify direct Admin SDK, REST, client SDK and external service-account writers, including writers outside this repository.
5. Reconcile the deployed inventory with `scripts/inventory-pitanga-writers.mjs` and `scripts/audit-canonical-pitanga-callers.mjs`. Review unresolved call sites individually; do not treat source inventory as deployment evidence.
6. Only after all writers are proven fenced and approved may a separate authorized operation set `systemControl/pitangaLegacyWriterFence.writersVerified=true`.

## Current release decision

**BLOCKED**: deployed/external writer coverage is unverified. Do not set `writersVerified=true`, activate the 100-Pitanga welcome campaign, merge or deploy this PR on the basis of isolated CI alone. Existing CI emulator results demonstrate the isolated transaction behavior only.

No production data or flags were changed during this review.

## Prepared key attestation (continuation of PR #1137)

`docs/FIREBASE_WRITER_KEY_ATTESTATION.md` documents the new offline challenge,
workload signing and public-key verification utility. It uses the existing
Firebase credential variable without exposing its value or changing application
routes. Fourteen targeted tests cover proof verification, deployment metadata
consistency, tampering, expiry, key substitution, input limits and sanitized
errors. It is prepared code, not an executed production attestation. A signature
proves key possession only; provider execution evidence and coverage of every
external consumer remain mandatory. The release decision above remains blocked.


## Atualização somente leitura — 24/11/2026
Consulta autenticada Vercel aos hostnames www.kyrub.com e admin.kyrub.com retornou o mesmo deployment READY de produção: dpl_9P1QiBsF6XJmucEgFM8h6hvYVQgS, projeto kyrub prj_X7hpqaftcikyA8jAK7Iec8HOkqqp, SHA Git 5106d53fa1e5f7450e7597d6523ae40d1c03cdae (redeploy). File-tree API retornou 404 File tree not found; a análise abaixo é do Git identificado pela plataforma, não inspeção dos binários em execução. Git tree não truncada.
- api/health.ts (blob e3800b5ce78e7b588abc2787f03c826b4235ebfd) e vercel.json (83a6998fb373b3afea58f8f90ac6b3ea2b1fafbf): /api/pitangas delega ao transporte pitanga-account. Fonte de pitangaAccountService.ts (0e106f1fd0ce2dd05e8638d289b17cfb37b66175) coincide com a versão candidata e exige flag, projeto, epoch e fence verificado para conversão. Não se inferiu valor de flags efetivas.
- firstStorePublishedAwardTransaction.ts (a30c69f5b184acee4c1c53cea47869bbe3100327): 2 XP, zero Pitangas, rejeita ledger Pitanga conflitante.
- functions/index.ts (a24c667b6b97aa59f441d9fb26115d8b89fa2da9): fonte contém gatilho welcome100PitangasOnAuthCreate. firebase.json não configura Functions, firebase.welcome.json configura codebase isolada; isso não comprova implantação do gatilho nem cobertura externa.
- semeaduraService.ts (54b0217ad4457cf569876994e102a856885dbe58): ainda contém projeção coletiva communities/{communityId}/semeaduraProgress/summary, sem quota diária de 100 nem liquidação econômica. semeaduraHandler.ts contém flag de servidor e leitura coletiva. vercel.json não contém rewrite explícito de semeadura; não se comprovou alcançabilidade runtime ou uso atual. Não habilitar o fluxo antigo; preservar dados históricos, sem backfill automático. Candidata #1277 contém o comportamento autor-only e limite diário, com economia restrita ao emulador.
- CI dc19e920103bac7480451a017bcf007aa7b5aeef: 4/4 aprovados; inventário 45523662761 / job 138901536784 gerou artefatos pitanga-canonical-callers (14980334981) e pitanga-writer-inventory (14982050262). Conteúdo dos ZIPs não inspecionado nesta consulta; release gate skipped. Nenhuma prova de cobertura de escritores externos.
Bloqueio atual: inventário autorizado GCP/Firebase de Functions, Run, Scheduler, filas, identidades e serviços externos, confirmação de suas versões e guardas; não repetir consultas históricas como se fossem atuais. Não configurar fence, habilitar flags, faturamento, publicar regras, merge ou deployment. Nenhuma alteração no Firebase real ou na PR #1274.
