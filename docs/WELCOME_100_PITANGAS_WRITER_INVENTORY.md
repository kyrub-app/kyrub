# KYRUB — Inventário inicial dos escritores de Pitangas

Fonte: artefato `pitanga-writer-inventory` da execução GitHub Actions [43646798965](https://github.com/kyrub-app/kyrub/actions/runs/43646798965). O scanner analisou **1.022 arquivos** e apontou **31 candidatos**. Esta é uma classificação inicial por função do código, não uma comprovação de escritores implantados nem de bloqueios em produção.

## Escritores transacionais que exigem inspeção de bloqueio

- `server/gamification/pitangaEarnTransaction.ts` — concessão de Pitangas.
- `server/gamification/pitangaSpendTransaction.ts` — débito de Pitangas.
- `server/gamification/pitangaXpConversionTransaction.ts` — débito para conversão em XP.
- `server/gamification/pitangaVoucherIssuanceTransaction.ts` — débito e emissão de cupom.
- `server/gamification/pitangaMigrationBootstrapTransaction.ts` — inicialização de saldo legado.
- `server/gamification/cleanBaselineWelcomeTransaction.ts` — concessão de 100 Pitangas ao novo usuário (ainda isolada).

## Eventos de primeira loja / XP — verificar ausência de crédito em Pitangas

- `server/gamification/firstStorePublicationAuthority.ts`
- `server/gamification/firstStoreChallengeAwardTransaction.ts`
- `server/gamification/firstStorePublishedAwardTransaction.ts`

A regra atual é **2 XP e 0 Pitangas pela primeira publicação**. Não habilitar campanhas antigas por engano.

## Orquestração e verificação — examinar chamadas aos escritores

- `server/gamification/pitangaMigrationVerifiedBootstrap.ts`
- `server/gamification/pitangaVoucherIssuanceService.ts`
- `server/gamification/pitangaXpConversionService.ts`
- `server/gamification/signedSessionWelcomeService.ts`
- `server/gamification/pitangaVerifiedVoucherIssuance.ts`
- `server/gamification/pitangaVerifiedXpConversion.ts`
- `server/gamification/firstStoreChallengeAwardService.ts`
- `server/gamification/welcomeAuthenticatedGrant.ts`
- `server/gamification/welcomeTrustedAuthRegistration.ts`

## Outros candidatos / referências — verificar, não presumir escrita

- `server/gamification/pitangaHistoricalManifest.ts`
- `server/gamification/pitangaHistoricalMembership.ts`
- `server/gamification/pitangaMigrationSnapshot.ts`
- `server/gamification/pitangaMigrationCheckpointVerification.ts`
- `server/gamification/pitangaLegacyWriterFence.ts`
- `server/gamification/firstStorePublishedReward.ts`
- `server/gamification/firstStoreChallengeReward.ts`
- `server/gamification/firstStorePublishedVerificationService.ts`
- `server/gamification/firstLoginWelcome.ts`
- `server/gamification/redemptionRepository.ts`
- `api/health.ts`
- `src/components/admin/AdminGlobalChallengesWorkspace.tsx`
- `src/components/modals/StoreConfigModal.tsx`

## Portão de liberação

1. Inspecionar cada escritor transacional e todos os seus chamadores, comprovando autorização, idempotência, integridade e bloqueio do escritor legado na **revisão efetivamente implantada**.
2. Inventariar Cloud Functions externas, tarefas agendadas, scripts operacionais e credenciais Admin SDK que não aparecem no repositório.
3. Não definir `writersVerified: true` com base apenas neste inventário. Exigir evidências dos bloqueios em todos os escritores implantados.
4. Não ativar o bônus de boas-vindas antes da validação do gatilho Auth real, do caminho de gasto para saldo novo e dos testes isolados.
