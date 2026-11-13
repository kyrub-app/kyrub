# KYRUB — Revisão final de integração da PR #1130

Data: 2026-11-12. Base: `main`. Branch: `feat/store-created-challenge-reward`.
Escopo: primeira loja (+2 XP), boas-vindas (+1.000 Pitangas), proteção de saldo e liberação operacional.

## Evidências confirmadas
- PR aberta em Draft, sem conflitos (`mergeable_state=clean`), 41 arquivos alterados; sem reviews registrados no momento da inspeção.
- Cinco workflows concluídos com sucesso no commit `368611e4bb627c22d32d9fc794def9de466925e5`: Phase 10 integrated validation, Identity security rules, Store security rules, Application build, Validate Kyrub.
- `freeStoreProvisioningService.ts` cria evento `verifiedStoreEvents/first_store_created` no servidor e tenta recompensa idempotente após ativação da loja; falha do prêmio não impede ativação.
- `firstStoreChallengeAwardService.ts` verifica loja canônica, proprietário, evento persistido e desafio na transação.
- `firstStoreChallengeReward.ts` exige desafio publicado/ativo, determinístico, patrocinado pela Kyrub, máximo de uma conclusão, 2 XP e 0 Pitangas.
- `onboarding.welcome.claim` rejeita campanha desativada; rota legada baseada em recibo não é fallback automático.
- `signedSessionWelcomeService.ts` exige projeto Firebase, data de campanha, `auth_time` do token verificado, fence `fenced` com `writersVerified=true` e epoch igual à configuração. O documento de fence NÃO comprova por si só bloqueio dos escritores externos.
- Emulador testa oito concessões concorrentes (um crédito, sete replays) e preservação de saldos/ledger preexistentes.
- `cleanBaselineWelcomeService.ts` é restrito a emulador local com flags explícitas; não é alternativa de produção.

## Decisão por componente
| Componente | Parecer | Condição |
| --- | --- | --- |
| Evento de primeira loja e prêmio de 2 XP | Apto a homologação integrada | Desafio real publicado com configuração exata e teste ponta a ponta |
| Contrato de crédito único de 1.000 Pitangas | Testes de transação aprovados | Não habilitar em produção antes de auditoria operacional |
| Autenticação da campanha | Gate implementado | Conferir configuração real e deploy ativo |
| Migração e escritores legados | BLOQUEADO | Inventário completo de escritores internos/externos e prova de fence por revisão implantada |
| Integração da PR inteira | NÃO APROVADA PARA MERGE NESTA REVISÃO | Falta revisão independente registrada, homologação integrada e comprovação operacional |
| Ativação de campanha | PROIBIDA | Não configurar flags, epoch ou `writersVerified=true` sem evidência |

## Pendências que não podem ser encerradas por inspeção estática
1. Listar Cloud Functions, jobs, rotas administrativas, serviços externos e credenciais Firebase Admin que podem escrever `users/{uid}/pitangaBalance` e `rewardLedger`.
2. Identificar commit/deploy efetivamente ativo de cada escritor e comprovar que o fence é consultado na mesma transação antes da mutação, ou comprovar desativação.
3. Testar no ambiente isolado os escritores com fence `open`, `fencing` e `fenced`, incluindo concorrência e falhas.
4. Homologar jornada real de novo usuário, primeiro login, repetição, primeira loja, XP, e usuário histórico, sem crédito nem cobrança real.
5. Obter aprovação de revisão independente e autorização explícita antes de merge/deploy.

## Limites da verificação
GitHub permite verificar código, checks e estado da PR, mas isso não comprova os serviços e credenciais que estão efetivamente implantados fora do repositório. Não foi realizado merge, deploy, escrita no Firestore de produção ou ativação de créditos. Nenhuma revisão foi registrada em nome de terceiro.

## Recomendação final
**Manter PR #1130 em Draft e campanha desativada.** A implementação de código e seus checks estão verdes, mas a etapa operacional de escritores legados não está comprovada. Não reabrir auditorias genéricas; a próxima execução deve obter especificamente evidência de deploy e de escritores externos, ou declarar o bloqueio sem fingir conclusão.
