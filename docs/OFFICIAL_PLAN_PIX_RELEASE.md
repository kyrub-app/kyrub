# Official Pro/Business Pix release

## Confirmed store activation product rule — correction

The **user's confirmed behavior** is: clicking **Criar minha loja** both
creates and activates the store on **Free** when there is no valid paid
entitlement. If the buyer already paid for Pro/Business, the same action
creates and activates the store **on the existing paid plan**, never
downgrading to Free or resetting the term that began at provider Pix approval.
**Acessar loja** only opens an existing ERP; publishing a marketplace listing
remains independent of store activation.

Implementation trace (reviewed):
- `RendaTab.openRetailerWorkspace` calls `POST /api/plan-control?op=store.free.ensure`
  and opens the ERP after HTTP 200.
- `ensureFreePlanForStoreCreation` currently creates/updates only
  `users/{uid}/stores/{uid}` and deliberately sets `status: 'closed'`.
  It does not create a canonical `stores/{storeId}` record, write
  `activatedAt`, or return an activation receipt. **Therefore the click
  does not yet fulfill the confirmed activation requirement.**
- `ensureCanonicalStoreForCatalog` creates/repairs a canonical record
  only after meaningful store setup, and sets
  `publicationStatus: 'paused'`; this catalog repair must not become an
  implicit activation trigger.
- Correct implementation must make **Criar minha loja** the authenticated,
  idempotent activation command, reconcile any existing canonical identity
  rather than inventing a second store, and commit a durable activation marker.
  A paid entitlement must win over Free, and the payment-approved term dates
  must remain unchanged. Activation must not publish the storefront.
- Do not simply call `recordFirstCanonicalStoreActivation` immediately
  after `store.free.ensure`: that helper requires a pre-existing canonical
  store and private-to-canonical link, neither of which the current
  provisioner guarantees. Add an integrated emulator test for the entire
  command before exposing it in production.

The previously documented requirement for a *separate* **Ativar loja** action
was incorrect for this onboarding path. The current
`store.free.ensure` endpoint provisions a private store record but does
**not yet prove canonical-store activation**. The first-activation helper
currently forbids invoking it from creation, so both implementation and
boundary tests must be reconciled with the confirmed product rule. Do not
mark onboarding complete merely because the Free provisioner returns 200.
Any legacy `paid_pending_activation` reconciliation must preserve existing
records without shifting new paid contracts' start dates.

## Current release checkpoint — 10 Nov 2026

**Do not treat this document's older rollout steps as proof that the release is ready.**
PR #1110 (`codex/official-plan-preactivation-contract`) is Draft and targets
`codex/official-plan-pix-one-buyer-pilot`, **not** `main`.
The current PR head is ahead of `main` by more than 100 commits, including its
parent pilot branch. Before a production merge, review the full combined diff,
required migrations and feature flags; retargeting #1110 alone is insufficient.

The no-store checkout remains **blocked for real providers** by
`OFFICIAL_PIX_PENDING_ACTIVATION_NOT_READY`. Only an explicitly enabled
localhost Firestore emulator with the isolated fake platform token may exercise
the no-store POST path. Do not configure
`KYRUB_OFFICIAL_PIX_EMULATOR_PRESTORE_TEST` in Vercel or any live environment.
The integration test covers issuance, provider confirmation, recovery, and
later store provisioning in isolation. Passing CI does **not** authorize
production charging or prove the deployed production configuration.

**Commercial rule:** confirmed Pix payment begins the prepaid term at the
provider's verified approval timestamp, even if the buyer creates their store
later. Delayed store creation must not restart or extend that term. The earlier
paragraph below stating that a buyer must activate a Free store before paying
is historical and is superseded by this rule, subject to completing the
real-provider pre-store checkout before release.

Integration review findings (10 Nov 2026):
- Comparing `main` with this branch currently yields **16 changed files**, not
  112 independent feature files. The commit count includes the stacked pilot
  history; review the actual file diff rather than treating each commit as a
  separate release feature.
- Production-sensitive changes include `api/plan-control.ts`,
  `server/payments/officialPlanPixCheckout.ts`,
  `server/actions/freeStoreProvisioningService.ts`,
  `server/actions/firstCanonicalStoreActivationService.ts`, and
  `src/components/tabs/RendaTab.tsx`. The remaining changes include
  tests, documentation, schedule helpers and test configuration.
- `recordFirstCanonicalStoreActivation` explicitly documents that its
  route is **not yet connected**. Its companion
  `activateCanonicalStoreAndReconcileOfficialPlan` still invokes
  `activatePendingOfficialPlanForStore`, which contains the older
  `paid_pending_activation` path. Code inspection confirms
  `reconcileLoaded` dispatches to that legacy materializer **only when
  the checkout already has `status === 'paid_pending_activation'`**;
  newly approved checkouts dispatch to `materialize`, which starts
  entitlement at provider approval. Preserve legacy records and their
  reconciliation during migration; do not delete this branch blindly.
  Before live release, test that no newly issued checkout can enter
  the legacy status and verify the actual activation transition.
- Before calling the release complete, verify the actual authenticated
  `Ativar loja` transition and paid-entitlement inheritance against the
  deployed application; tests of isolated helpers alone are insufficient.

Before enabling a live pilot, require: reviewed combined integration to
`main`, exact-head CI and emulator checks, verified platform collector and
webhook configuration, pre-store charge path released from its deliberate
gate through a separately reviewed change, and an owner-approved one-buyer
one-shot test. Never use real money to bypass incomplete engineering checks.


This change is prepared for owner approval. Do not merge, deploy or enable real-money creation before that approval. Do not seed prices, discounts, published products or rewards on behalf of the owner.

## Integration

1. Merge reviewed #1076 at `862febfa359a57476b2bf3cfc4e700fa3d37b6f6` after owner approval. Its Application build and Validate Kyrub checks passed; it has no payment creation endpoint.
2. Review the official Pix PR on top of #1076. Require Application build and Validate Kyrub, including `official-plan-pix*.test.ts`, on the exact release head. Retarget to main after #1076 merges and rerun required checks if the diff changes.
3. Confirm Vercel team `kyrubapp-6434s-projects`, project `kyrub`, GitHub repository `kyrub-app/kyrub`, production domain `www.kyrub.com` and approved commit. The inspected production/main base is `41c84483fc6f193243994506488d5864f67da5c4`.
4. The existing `vercel.json` permits automatic deployment for main but excludes `codex/official-plan-pix`. Do not rename this branch to an enabled `preview-*` name before approval. See https://vercel.com/docs/project-configuration/git-configuration.
5. After explicit financial release approval, merge the reviewed Pix commit and monitor the resulting production build. The flag remains disabled until deliberately configured. No CLI deployment, promotion or production environment mutation was performed during development.

## Platform configuration

Set `KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID` to the exact numeric platform account ID approved by the owner. It is a non-secret identifier. The authenticated `/users/me` result must match before a charge or reconciliation; a missing or different receiver fails closed. No account ID is seeded by deployment.

The Firestore concurrency proof runs with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node --test --import tsx tests/firestore-official-plan-pix.test.ts`. It refuses a non-local host and uses only `demo-kyrub-pix`, with a simulated provider. Four concurrent attempts must produce one provider POST; concurrent confirmations must preserve one contract, payment, financial capture, point entry, XP entry, achievement and benefit cycle.

Use existing server-only `KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN` and `KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET`, scoped to Production. Never copy merchant OAuth credentials into platform billing. `/users/me` identifies the platform collector; every payment GET independently checks that collector, BRL, Pix, external reference, exact cents and Production `live_mode=true`.

`KYRUB_PLAN_BILLING_WEBHOOK_URL` must identify the HTTPS production application. The adapter constructs `/api/plan-control?op=official.prepaid.webhook&checkoutId=...`; use the same platform application's webhook secret and enable Mercado Pago payment notifications. Missing/incorrect signatures cannot activate a contract. Confirm delivery on the first owner-executed purchase, not by creating a live payment from an engineering script.

Set `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=true` only after approval. It applies to every eligible authenticated buyer, without a UID allowlist. `KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED` continues to govern merchant prepaid subscriptions; enabling it does not enable official platform Pix. `GET /api/plan-control?op=plans.billing` adds `pixAvailable` without returning any secret. Vercel environment configuration must take effect in the released deployment.

## Owner catalog setup

In the Official Store ERP, create subscription products with a monthly interval and access benefit. Use the existing product editor for actual monthly price, publication status, points per purchase and optional 1/3/6/12-month contract discounts. Bind each eligible draft or published product to Pro or Business in the new official-plan panel. Configure optional purchase XP and an achievement/badge there; no reward is issued when unconfigured. Global XP configuration remains super-admin controlled. Publication remains an explicit owner action in the product editor.

Paid plans are prepaid for the explicitly accepted period, with a single Pix, no installments and no automatic renewal. An active entitlement or unresolved subscription prevents a competing plan purchase; upgrades/proration are not invented. Historical implementation note: the earlier flow required a Free store before purchase. PR #1110 changes the commercial rule to allow payment before store creation, but the real-provider no-store checkout is still gated pending release validation.

## Confirmation, logs and first purchase

No provider POST is made by status, reconciliation or webhook. A lost creation response retains the buyer-wide slot; recovery looks up the original reference and refuses ambiguous matches. Signed notifications can recover an early payment before the original POST returns. Definitive rejected/cancelled unpaid attempts close their slot; an expired QR alone never authorizes another charge.

Verified payment materialization uses one Firestore transaction for the shared global payment binding, prepaid contract/period, official-store subscription, canonical payment, finance capture, product points, plan mirrors, expiring entitlement and audit event. XP, achievement, CRM and benefit projections are retry-safe. `effectsStatus=pending` persists until all projections complete; retries reuse the same payment and deterministic identities. The existing prepaid coverage verifier checks contract/period/binding consistency before ERP or access-benefit use.

Follow structured `[official-plan-pix]` logs by checkout ID, stage and provider payment ID. Do not log tokens, payer data, QR payloads or raw PSP responses. Inspect `kyrub_admin/control_plane/plan_pix_checkouts/{checkoutId}` for `status`, `effectsStatus`, quote/acceptance digests and provider binding. Verify the linked canonical subscription, contract, period, official-store CRM, economicLedger, storePointLedger, user xpLedger/achievement and buyer entitlement. A receipt is shown as activated only after projections complete.

The owner performs the first live purchase. Check approved/accredited evidence from the PSP, collector and live mode; confirm expiry/access in a fresh session and replay the notification/status to confirm counts stay unchanged. Refunds/chargebacks and manual administrative conflicts are surfaced for review; this PR never initiates refunds or transfers. Post-payment non-approved statuses deliberately fail reconciliation and log an alert rather than silently restoring revoked benefits.

## Rollback

First disable new creation with `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=false` and ensure the serving deployment receives it. Keep status and signed webhook reconciliation running for in-flight payments. The kill switch does not prevent already paid contracts from materializing or retrying missing projections. Do not revert/remove the handler while unresolved provider payments exist. Preserve immutable contracts, global bindings, receipts and rewards; never delete ledger records to reset a test. Only roll back to the previous commit after reconciling in-flight payments and assessing any required compensating entries through the existing governed financial workflows.


## Escopo comercial atualizado — Business R$ 1 via cupom da Loja Oficial (17/11/2026)

**Decisão do proprietário:** o custo de R$ 1 **não é preço oficial do Business**. Trata-se da contratação do **Business mensal oficial R$ 397,00**, com **cupom ERP de R$ 396,00**, gerando **um Pix de R$ 1,00** para o primeiro comprador real de homologação (um segundo perfil controlado pelo proprietário). O objetivo é provar Pix verdadeiro, conta recebedora, webhook, contrato, concessão do Business, vitrine/ERP e idempotência. **Não usar o piloto Pro R$ 197 descrito nas seções legadas abaixo como substituto.**

A implementação está na [PR #1159](https://github.com/kyrub-app/kyrub/pull/1159) **Draft**, cumulativa sobre #1158. O valor do produto no catálogo **não é alterado** e o código apenas habilita, por flag adicional default OFF, um caminho **já existente** de cupom → preço servidor → aceite → Pix → contrato.

**Configuração necessária, só após homologação e autorização expressa:**

- `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=true` (gatilho financeiro geral, que deve permanecer OFF antes da liberação);
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE=true`;
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUSINESS_COUPON_ENABLED=true` (**nova flag, default OFF**);
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID=<UID Firebase do segundo perfil autenticado, obtido via operação autorizada>`;
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_ID=<ID canônico da promoção criada pelo ERP>`;
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_PROMOTION_CODE=<código normalizado do cupom criado pelo ERP>`.

O código/ID do cupom ainda não foram escolhidos para produção, portanto os nomes `BIZ1`/`business-pilot` que aparecem nos **testes** são fictícios e não provam campanha publicada. Não inserir UID, token ou segredo em GitHub/ChatGPT. O recebedor Mercado Pago permanece a **conta oficial já aprovada**; conferir no preflight autenticado o `receiverId` e **`checkoutEnabled` atual** antes do piloto. Não habilitar a flag até a janela de teste; desligá-la depois, preservando webhooks/reconciliação de pagamentos emitidos.

**Segurança da premiação:** para este primeiro piloto, o produto/termo aceito deve ter **zero pontos de loja, zero XP e nenhum brinde/achievement automático**; caso a configuração oficial inclua recompensas, a emissão real é recusada até a revisão do contrato e do writer gate Firebase. Esse guard não altera saldo nem reescreve catálogo. O foco do primeiro Pix de R$ 1 é cobrança, vigência, CRM, ledger e idempotência, sem antecipar campanhas.

**Cupom ERP de uso único:** somente a Loja Oficial canônica e o produto **Business canônico, 1 mês**, `fixed=396`, `eligibility.mode=specific_user` com **exatamente o UID do segundo perfil**, `maxRedemptions=1`, `maxRedemptionsPerBuyer=1`, período limitado, sem renovação automática. O gerente de cupons na PR permite configurar a elegibilidade; a divulgação pública na Praça mostra apenas código/oferta, **nunca o UID**. Um código não listado na descoberta pública segue pela vitrine oficial para **quote autenticada**: se não pertencer ao comprador, a API recusa; **nunca substitui cupom inválido por preço cheio**. O servidor verifica o vínculo antes da cotação, durante a reserva transacional e imediatamente antes de emitir Pix.

**Jornada simples recomendada:** o segundo perfil faz login → **Criar minha loja** concede Free sem depender de publicação → prepara a primeira loja → acessa a postagem do cupom da Loja Oficial na Praça → `Aproveitar cupom` → vitrine `/@kyrub-oficial?coupon=...` → confere Business por R$ 397 menos R$ 396 e **total R$ 1** → aceita → **somente depois da autorização financeira final** paga um Pix real → a API valida pagamento aprovado/acreditado e inicia vigência Business no instante da aprovação → plano e CRM refletem novo benefício sem exigir publicação da loja. Depois validar repetição de webhook/reabertura em nova sessão, o pedido canônico e ausência de cobranças/contratos duplicados. Não misturar este piloto com as 100 Pitangas enquanto o writer gate estiver aberto.

**Bloqueios de uma transação real:** produto Business e loja oficial realmente publicados; Firestore Rules/app/índices já implantados e compatíveis; preflight Mercado Pago/autorização de coletor e webhook válido; prévia visual autenticada com o segundo perfil; one-shot sem uso anterior; valor e prazo revalidados pelo servidor; owner aprova expressamente **o deploy e, depois, o pagamento de R$ 1**. Caso o PSP responda com resultado incerto, recuperar pelo ID de checkout; **nunca apagar o documento one-shot nem gerar outra cobrança para tentar novamente**.

**Estado:** preparação em PR, sem cupom real criado, sem flag produtiva alterada, sem merge, deploy ou Pix real executado.

## Piloto legado Pro sem desconto — somente histórico (substituído no escopo comercial pelo piloto Business descrito acima)

O código legado Pro permanece compatível quando a flag Business está OFF; **não o executar como piloto escolhido pelo proprietário** sem nova decisão.

## One-buyer, one-emission live pilot (pending approval)

Pilot code is restricted to one official Kyrub Pro, 1 month, BRL 197.00. The server refuses live creation unless **all** production deployment settings are explicit:
- `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED=true`
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE=true`
- `KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID=<verified Firebase Auth UID of the approved test buyer>`

Never set these until exact deployment, approval and security tests are confirmed. A missing or invalid buyer UID fails closed. Every issuing request authenticates its buyer and checks the offer before transaction reservation and again before provider POST. No buyer-controlled request field selects the pilot UID.

The Firestore document `kyrub_admin/control_plane/official_plan_pix_pilot/one_shot` is atomically **created once** alongside the buyer payment slot and the request snapshot, before a provider call. Once present, it is never deleted automatically, even if the provider rejects or the payment expires; this pilot does not authorize another charge. An in-flight checkout is recovered via the original provider reference, webhook and reconciliation, without creating a fresh payment.

Important: do not reset the one-shot document to retry a charge. If the single live attempt cannot prove settlement, separately investigate that precise transaction before deciding on a new controlled pilot. Turning the checkout gate off must not shut down existing payment status, webhooks or reconciliation. The pilot configuration must be removed or switched off and the change must reach the live deployment; Vercel variable changes alone may not alter a currently serving deployment.

Before any deployment, require CI and dedicated emulator concurrency checks on exact PR head. Verify one eligible buyer is allowed in the isolated test, another buyer fails before provider POST, other plan terms/amounts fail, missing config fails, repeated submissions yield only one provider POST, and webhooks still reconcile after the creation gate closes. Do not merge or deploy this PR without separate authorization. General commercial rollout requires a separate reviewed change to remove pilot-only restrictions.
