# Recompensa de 100 Pitangas — conclusão da integração

## Escopo e reaproveitamento

Base: PR #1135, branch `codex/welcome-100-pitangas-isolated-contract`, SHA `89a8ed4fd6fc7c4e37c896fb240194e8a98a2f60`. Frente C, gamificação; dependência de implantação sob responsabilidade de infraestrutura. Nenhuma mudança de produção autorizada.

Foram preservados os contratos de 100 Pitangas, recibo imutável, saldo canônico, ledger, idempotência, guardas e testes isolados existentes. A busca em `api/`, `server/`, `src/`, configurações Firebase e testes encontrou o adaptador `welcomeTrustedAuthRegistration` e o serviço `signedSessionWelcomeService`, mas nenhum registro de gatilho que os conectasse. A integração usa esses donos canônicos; não cria outro sistema de recompensas.

## Integração acrescentada

`functions/index.ts` registra `welcome100PitangasOnAuthCreate` no evento confiável Auth onCreate, com repetição em falhas. Para contas Google, o evento de criação corresponde ao primeiro login federado. O handler reutiliza o emissor de recibo e o mesmo serviço transacional de crédito. Não há novo endpoint HTTP, declaração de primeiro login do cliente ou timestamp assinado fabricado.

A elegibilidade Google existente foi preservada: contas anônimas, senha e outros provedores não recebem o bônus. Contas criadas antes do corte são ignoradas. O evento de criação não volta a disparar em logins normais posteriores. Duplicatas de entrega usam o mesmo recibo e a mesma chave de concessão. A emissão do recibo e o crédito são transações separadas e idempotentes; uma falha transitória entre elas pode ser recuperada por repetição do evento. Saldo e lançamento de crédito continuam na mesma transação. Estado econômico preexistente causa rejeição, sem sobrescrita.

A homologação real identificou e corrigiu uma divergência de precisão: o evento Auth preserva milissegundos, enquanto a consulta getUser serializa creationTime em segundos. O consumidor conserva o timestamp do evento confiável, verifica que corresponde ao mesmo segundo da criação consultada e usa esse valor para validar o recibo; não relaxa a igualdade do recibo nem aceita timestamps do navegador.

O mesmo sinalizador existente permanece desligado por padrão: `KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED`. Projeto esperado, data de corte e epoch são obrigatórios; o crédito exige `systemControl/pitangaLegacyWriterFence` com `status=fenced`, `writersVerified=true` e epoch correspondente. Essa combinação não foi configurada em produção. O projeto fictício de testes é `demo-kyrub-welcome`; o arquivo `firebase.welcome.json` permite testar a ligação Auth → Functions → Firestore. A configuração Firebase padrão não foi alterada.

## Seis chamadas classificadas

| Chamador | Uso no código | Escrita/guarda | Decisão |
|---|---|---|---|
| cleanBaselineVerifiedSpend:28 | Wrapper isolado, chamado pelos testes, sem rota na aplicação | Débito canônico; procedência clean-baseline e fence revalidados na transação da primitiva | Preservar |
| cleanBaselineVerifiedVoucherIssuance:28 | Wrapper isolado, sem endpoint | Saldo, voucher, resgate, débito e auditoria; procedência e fence na mesma transação | Preservar |
| cleanBaselineVerifiedXpConversion:29 | Wrapper isolado, sem endpoint | Saldo, recibo de conversão e ledgers; procedência e fence na transação | Preservar; taxa 1.000:1 intacta |
| firstStoreChallengeAwardTransaction:66 | Adaptador interno de desafio antigo, sem rota pública | Ramo de Pitangas inalcançável pelo contrato atual: rewardKCoins deve ser 0 e XP deve ser 2; ramo ainda passa fence à primitiva | Não corrigir ramo sem defeito reproduzido; preservar 2 XP |
| pitangaVerifiedVoucherIssuance:53 | Usado por pitangaVoucherIssuanceService; serviço interno sem rota pública | Recibo histórico, epoch e fence verificados; evidência migrada repassada à primitiva | Preservar |
| pitangaVerifiedXpConversion:56 | Usado por pitangaXpConversionService; serviço interno sem rota pública | Recibo histórico, epoch e fence verificados; evidência migrada repassada à primitiva | Preservar |

Essas classificações são do código, não de revisões implantadas. Não representam seis vulnerabilidades. O script de auditoria continua conservador quanto à prova de implantação e não foi alterado para aprovar produção.

## Classificação dos 35 arquivos candidatos existentes

Todos os caminhos abaixo usam o prefixo `server/gamification/`, exceto os explicitamente completos. `Interno isolado` significa sem entrada de aplicação encontrada na base revisada; não prova ausência de implantação externa.

| Arquivo | Classificação |
|---|---|
| pitangaXpConversionTransaction.ts | Escritor interno isolado; transação protegida, conversão 1.000:1 preservada |
| firstStorePublicationAuthority.ts | Entrada da aplicação via firstStorePublicationHandler; publica loja e concede somente 2 XP |
| pitangaVoucherIssuanceTransaction.ts | Escritor interno isolado protegido |
| pitangaSpendTransaction.ts | Escritor interno isolado protegido |
| cleanBaselineSpendingEligibility.ts | Verificador de leitura; mutation hints são falsos positivos |
| cleanBaselineWelcomeTransaction.ts | Escritor canônico de boas-vindas; agora alcançável pelo gatilho, condicionado a flags/fence |
| firstStoreChallengeAwardTransaction.ts | Escritor de XP interno; ramo Pitangas bloqueado pelo contrato zero |
| pitangaEarnTransaction.ts | Primitiva de crédito com fence; única chamada encontrada é o ramo zero acima |
| pitangaMigrationBootstrapTransaction.ts | Escritor de migração isolado; exige epoch/fence verificados |
| firstStorePublishedAwardTransaction.ts | Escritor de recibo e XP alcançável pela publicação; apenas lê referência Pitangas para rejeitar conflito |
| pitangaMigrationVerifiedBootstrap.ts | Wrapper isolado; lê histórico e delega ao bootstrap protegido |
| pitangaHistoricalManifest.ts | Construtor/verificador puro, nenhuma persistência |
| pitangaVoucherIssuanceService.ts | Serviço interno isolado, abre transação de voucher verificado |
| pitangaXpConversionService.ts | Serviço interno isolado, abre transação de conversão verificada |
| signedSessionWelcomeService.ts | Serviço de crédito protegido; caminho com recibo agora conectado ao gatilho |
| src/components/admin/AdminGlobalChallengesWorkspace.tsx | Edição de definição de desafio via API administrativa; não credita saldo/ledger |
| firstStorePublishedReward.ts | Planejador puro; zero Pitangas, 2 XP |
| pitangaHistoricalMembership.ts | Digest/verificação pura, sem escrita Firestore |
| pitangaMigrationSnapshot.ts | Planejamento de snapshot, sem persistência |
| pitangaLegacyWriterFence.ts | Guarda de leitura; não ativa fence |
| pitangaMigrationCheckpointVerification.ts | Verificador de leitura |
| pitangaVerifiedVoucherIssuance.ts | Wrapper interno isolado, classificado acima |
| pitangaVerifiedXpConversion.ts | Wrapper interno isolado, classificado acima |
| cleanBaselineVerifiedVoucherIssuance.ts | Wrapper interno isolado, classificado acima |
| api/health.ts | Transporte da aplicação com leitura de rewardLedger; não escreve saldo |
| cleanBaselineVerifiedSpend.ts | Wrapper interno isolado, classificado acima |
| firstStoreChallengeAwardService.ts | Serviço interno do desafio antigo, sem rota pública |
| firstStoreChallengeReward.ts | Contrato puro; exige zero Pitangas e 2 XP |
| cleanBaselineVerifiedXpConversion.ts | Wrapper interno isolado, classificado acima |
| firstLoginWelcome.ts | Contrato puro de elegibilidade e valor 100 |
| firstStorePublishedVerificationService.ts | Serviço interno isolado; verifica publicação e delega à transação de recibo/2 XP, sem crédito Pitangas |
| welcomeAuthenticatedGrant.ts | Fronteira de token interna, sem rota pública; não alterada |
| redemptionRepository.ts | Escritor legado de ledger/voucher/resgate/auditoria, sem chamadores em api/server/src; não atualiza saldo canônico nem lê fence. Isolado e não reutilizado; antes de qualquer conexão deve ser substituído pelo emissor canônico protegido |
| welcomeTrustedAuthRegistration.ts | Escritor do recibo Auth; agora conectado ao gatilho, não escreve saldo |
| src/components/modals/StoreConfigModal.tsx | Dispara publicação e confere resposta zero Pitangas; não escreve saldo |

## Pendências externas delimitadas

O inventário anterior continua válido: Functions Gen1/Gen2, Run e Scheduler retornaram SERVICE_DISABLED; Pub/Sub vazio. Não foram repetidas consultas nem habilitadas APIs. Infraestrutura/Owner deve fornecer a relação de escritores/revisões externos e confirmar o corte antes de qualquer ativação; API desabilitada não significa ausência de implantação. O documento `PITANGA_WRITER_DEPLOYMENT_EVIDENCE.md` mantém esse bloqueio.

Depois de autorizado separadamente, infraestrutura deverá implantar o gatilho, configurar os parâmetros protegidos e validar a entrega do evento na plataforma. Isso é uma dependência de ativação, não autorização para esta execução. Não marcar writersVerified com base só nesta classificação estática. O kill switch existente é desabilitar o sinalizador de boas-vindas; nenhuma alteração de saldo é necessária para pará-lo.

O responsável pelas credenciais deve revogar/rotacionar as credenciais anteriormente expostas. Nenhum valor sensível é reproduzido ou revogado nesta execução.

## Validação

Resultados locais em 15/11/2026:

- Auth + Functions + Firestore Emulator, projeto fictício demo-kyrub-welcome: **6/6 aprovados**. Novo Google login → 100; novo login → 100; oito entregas concorrentes → uma concessão e sete replays; conta antiga importada com criação em 2000 → nenhum bônus; saldo preexistente preservado; falha de autenticação/provedor inelegível → nenhum crédito; projeto/fence inválidos → rejeição.
- Serviço compartilhado e emissor de recibo: **13/13 aprovados**, incluindo auth_time ausente sem acesso ao caminho reservado ao gatilho.
- Regressão Firestore do recibo/serviço afetado: **22/22 aprovados**, incluindo crédito atômico, replay, conflitos, gasto e conversão atômica de 1.000 Pitangas para 1 XP.
- Verificação TypeScript da aplicação (`tsc --noEmit --allowJs false`): aprovada. Verificação do pacote Functions (`tsc --project functions/tsconfig.json`): aprovada. O pacote tem verificação separada para evitar exigir sua instalação em todos os builds da aplicação.
- Build do gatilho aprovado; nova jornada adicionada ao workflow existente. Nenhum resultado de CI remoto é presumido.
- `npm run lint` completo encontrou TS2307 no arquivo absoluto `/src/utils/firebase.ts`, importado pelo teste de navegador preexistente `tests/first-store-publication-playwright-smoke.mjs`. As três referências a firebase/app, firebase/firestore e firebase/auth fora da árvore local precisam de validação no CI/ambiente desse teste; não foram corrigidas nesta frente. Os imports absolutos já constam no commit de base. Não declarar esse gate global aprovado.

Os testes da primeira loja anteriormente aprovados permanecem evidência válida: seus contratos e escritores não foram alterados. Não declarar produção pronta enquanto a cobertura externa de escritores continuar sem prova. Commits e situação de publicação estão no relatório de entrega.

A configuração `vercel.json` desabilita implantação automática para `*` e não libera esta branch `codex/...`; o workflow de deploy Firebase por push é restrito à main. Publicar o commit desta PR não autoriza merge, deploy manual ou alteração dessas proteções.

Referência do mecanismo de evento: [Firebase Auth — gatilhos de criação de usuário](https://firebase.google.com/docs/functions/1st-gen/auth-events). A comprovação funcional desta entrega são os testes reais nos emuladores descritos acima.
