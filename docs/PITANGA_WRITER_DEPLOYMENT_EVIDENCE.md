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
