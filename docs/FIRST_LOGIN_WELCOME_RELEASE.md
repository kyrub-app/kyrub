# KYRUB — Liberação controlada do bônus de boas-vindas

## Contrato aprovado

- Usuário criado a partir da data oficial da campanha: **1.000 Pitangas**, uma única vez.
- Criação verificada da primeira loja: **2 XP**, sem Pitangas adicionais.
- XP e Pitangas são economias independentes.
- Usuários anteriores ao início da campanha não recebem bônus retroativo.
- Não alterar checkout Pix ou ativar cobrança real neste rollout.

## Integrações implementadas na PR #1130

- O aplicativo chama `POST /api/plan-control?op=onboarding.welcome.claim` após autenticação Firebase **somente quando** `VITE_KYRUB_WELCOME_BONUS_EFFECTIVE_AT` estiver configurada e a conta tiver sido criada a partir da data. Essa checagem no navegador é apenas uma otimização; o servidor continua sendo a autoridade.
- O servidor revalida o UID, consulta metadados Firebase Admin, aplica o corte de elegibilidade e usa lançamento idempotente.
- O crédito falha de forma segura quando o saldo canônico não existe.
- A criação da primeira loja registra evento verificável e tenta o prêmio de 2 XP sem bloquear o provisionamento.

## Recibo permanente de primeiro login — estado de segurança

- `server/gamification/firstLoginReceiptVerification.ts` valida, dentro da mesma transação do crédito, o recibo em `users/{uid}/authEvents/first_login_v1`.
- `server/gamification/firstLoginReceiptWriter.ts` cria o recibo de forma idempotente, mas é **apenas uma primitiva isolada**: o parâmetro `trustedFirstLoginEvent` é uma afirmação do chamador, **não** uma autenticação criptográfica nem uma prova independente de primeiro login.
- **Não expor o escritor por rota pública nem passar `trustedFirstLoginEvent: true` com base em token Firebase ID, `lastSignInTime`, `creationTime`, data enviada pelo cliente ou mero primeiro acesso a uma API.** Nenhum desses elementos comprova isoladamente o primeiro login.
- Antes de conectar o escritor, implementar e auditar uma origem confiável de eventos de autenticação com prova de primeira ocorrência, deduplicação e controle de permissão de gravação em Firestore. Restringir a criação/edição do recibo ao serviço autorizado; validar regras Firestore e credenciais de serviço. Documentar como a origem distingue o primeiro login de logins posteriores e como trata eventos fora de ordem.
- Até essa integração ser comprovada, **nenhum novo recibo deve ser emitido e nenhum novo crédito deve ser autorizado**. O CI verde não substitui a homologação de segurança.

## Decisão de simplificação — marco zero dos dados de teste

O proprietário confirmou que a economia anterior de Pitangas foi usada em testes
e autorizou planejar um reinício limpo, sem obrigação de migrar saldos fictícios.
**Essa decisão não autoriza exclusão automática em produção.**

Antes de implementar outro ledger, foram identificados no repositório:
`shared/gamificationLedger.ts`, `shared/gamificationEconomies.ts`,
`server/gamification/redemptionRepository.ts`,
`server/gamification/pitangaEarnTransaction.ts`,
`server/gamification/pitangaSpendTransaction.ts`,
`server/gamification/pitangaNewUserBootstrapTransaction.ts`,
`server/gamification/firstLoginReceiptWriter.ts` e
`server/gamification/firstLoginWelcomeAwardService.ts`.
Reutilizar esses contratos; não criar uma segunda economia paralela.

Plano de execução delimitado:
1. Classificar as coleções de Pitangas existentes e confirmar se há registros
   de usuários reais ou transações não fictícias. Gerar manifesto com contagens
   e IDs anonimizados antes de qualquer alteração.
2. Em ambiente isolado, usar um namespace/base de teste limpa e criar o saldo
   canônico de novas contas na mesma transação do crédito idempotente, sem
   reinicializar saldos de contas preexistentes.
3. Emitir o recibo de primeiro login somente por origem de autenticação
   verificada no servidor, nunca por declaração do cliente.
4. Homologar primeiro login, repetição, concorrência, histórico e primeira loja
   (+2 XP), mantendo o bônus de 1.000 Pitangas separado do XP.
5. Se a limpeza de produção for realmente necessária, apresentar previamente
   o manifesto exato dos documentos a excluir e executar somente após
   autorização específica, com cópia de segurança e plano de reversão.

O antigo bloqueio de migração pode ser dispensado **apenas no novo namespace
limpo e isolado**, após comprovar que não há escritores concorrentes nem dados
reais. Não definir `writersVerified=true` por presunção e não alterar
`systemControl/pitangaLegacyWriterFence` na produção atual.

## Bloqueios de ativação — não contornar

1. **Inventário e bloqueio de escritores legados de Pitangas.** Verificar TODOS os escritores ativos e comprovar o fence efetivo. Um documento `systemControl/pitangaLegacyWriterFence` isolado não é prova suficiente.
2. **Migração/conciliação dos saldos existentes.** Reconstruir e verificar cada histórico com recibos e manifestos antes de criar saldos canônicos; não inicializar contas antigas com zero.
3. **Provisionamento seguro de saldo para contas novas.** A primitiva isolada `server/gamification/pitangaNewUserBootstrapTransaction.ts` foi criada: exige conta posterior ao corte, fence verificado, ledger completo vazio e recibo imutável. **Ainda faltam testes transacionais, comprovação operacional do fence e integração controlada com o serviço de boas-vindas.** Até isso ocorrer, a tentativa de crédito deve retornar indisponível.
4. **Elegibilidade de primeiro login.** Homologar contas criadas depois do corte, contas antigas, repetição de login, duas abas e concorrência. Metadados `lastSignInTime` são atualizados pelo Firebase e não representam, isoladamente, uma prova imutável do primeiro login.
5. **Desafio administrativo.** Confirmar que `global_challenges/first_store_created` está publicado com `rewardXp: 2`, `rewardKCoins: 0`, modo determinístico, sponsor Kyrub e máximo de uma conclusão.
6. **Observabilidade.** A UI atualmente não apresenta confirmação de crédito nem fila durável de reprocessamento; uma falha temporária pode exigir novo login para tentar novamente.
7. **Homologação integrada.** Criar usuário de teste, validar exatamente um lançamento de 1.000 Pitangas, duas sessões simultâneas sem duplicidade, primeira loja com 2 XP, repetição da criação sem duplicidade, e usuário antigo sem bônus.
8. **Publicação.** Após CI e aprovação, efetuar merge/deploy controlado. Configurar **ambas** `KYRUB_WELCOME_BONUS_EFFECTIVE_AT` (servidor) e `VITE_KYRUB_WELCOME_BONUS_EFFECTIVE_AT` (build do navegador) com a **mesma data ISO 8601 futura**, antes do build final, e monitorar os primeiros lançamentos. Variáveis `VITE_` são incorporadas ao bundle no build; alterar somente o ambiente depois do build não atualiza o navegador.

**Estado:** PR em desenvolvimento; sem autorização implícita para merge, deploy, alteração de flags de produção ou distribuição de recompensas.
