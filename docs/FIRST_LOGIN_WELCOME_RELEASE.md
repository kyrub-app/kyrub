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

## Bloqueios de ativação — não contornar

1. **Inventário e bloqueio de escritores legados de Pitangas.** Verificar TODOS os escritores ativos e comprovar o fence efetivo. Um documento `systemControl/pitangaLegacyWriterFence` isolado não é prova suficiente.
2. **Migração/conciliação dos saldos existentes.** Reconstruir e verificar cada histórico com recibos e manifestos antes de criar saldos canônicos; não inicializar contas antigas com zero.
3. **Provisionamento seguro de saldo para contas novas.** Implementar e testar um fluxo transacional separado, com prova de ausência de histórico, sem sobrescrever registros nem misturar com a migração legada. Até isso ocorrer, a tentativa de crédito deve retornar indisponível.
4. **Elegibilidade de primeiro login.** Homologar contas criadas depois do corte, contas antigas, repetição de login, duas abas e concorrência. Metadados `lastSignInTime` são atualizados pelo Firebase e não representam, isoladamente, uma prova imutável do primeiro login.
5. **Desafio administrativo.** Confirmar que `global_challenges/first_store_created` está publicado com `rewardXp: 2`, `rewardKCoins: 0`, modo determinístico, sponsor Kyrub e máximo de uma conclusão.
6. **Observabilidade.** A UI atualmente não apresenta confirmação de crédito nem fila durável de reprocessamento; uma falha temporária pode exigir novo login para tentar novamente.
7. **Homologação integrada.** Criar usuário de teste, validar exatamente um lançamento de 1.000 Pitangas, duas sessões simultâneas sem duplicidade, primeira loja com 2 XP, repetição da criação sem duplicidade, e usuário antigo sem bônus.
8. **Publicação.** Após CI e aprovação, efetuar merge/deploy controlado. Configurar **ambas** `KYRUB_WELCOME_BONUS_EFFECTIVE_AT` (servidor) e `VITE_KYRUB_WELCOME_BONUS_EFFECTIVE_AT` (build do navegador) com a **mesma data ISO 8601 futura**, antes do build final, e monitorar os primeiros lançamentos. Variáveis `VITE_` são incorporadas ao bundle no build; alterar somente o ambiente depois do build não atualiza o navegador.

**Estado:** PR em desenvolvimento; sem autorização implícita para merge, deploy, alteração de flags de produção ou distribuição de recompensas.
