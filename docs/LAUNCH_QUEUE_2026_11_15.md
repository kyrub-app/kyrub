# Fila de lançamento recuperada — 15/11/2026

Base atualizada: main `008c6078435a312e05358a583ece6b148614a04e`, com a PR #1136 integrada. Atualização exclusiva da branch `fix/gamification-activation-delivery`; sem merge na main ou deploy.

## Preservar as entregas e evidências existentes

- #1134 está integrada: primeira publicação verificada com 2 XP e 0 Pitangas. Não reexecutar a jornada já aprovada sem evidência de regressão. A issue #1133 aberta não prova que a implementação esteja ausente.
- Cadastro, criação da loja, Free, contratação Pro/Business e confirmação de pagamento: preservar as validações relatadas no histórico. Esta entrega não reabre esses fluxos nem afirma nova homologação em produção.
- Gamificação é obrigatória para liberar o uso do app já publicado, que já tem usuários reais: 100 Pitangas no primeiro cadastro Google elegível, 2 XP na primeira publicação, saldos/extratos e conversão voluntária 1000:1. #1135 não é pós-lançamento. A entrega fix/gamification-activation-delivery consolida o código da #1135 e conecta conversão/extrato. Ativação continua dependente de evidência dos escritores implantados e autorização; não alterar writersVerified ou saldos.
- #1130/#1132/#1128 são trabalhos anteriores isolados; não retomá-los automaticamente como próxima base.

## #1136 integrada na main e preservada nesta atualização — parte da #765

Produtos & Estoque usa ProductInventoryDirectRuntime, cujo host é `erp-product-inventory-workspace`. OperationalDualWriteBridge também montava StoreConnectionsPortalBridge, que procura `kyrub-product-inventory-workspace-host` e tenta novamente a cada 80 ms. O host pertence à interface antiga e não aparece no módulo direto.

Correção limitada: o módulo direto desativa a montagem do portal, preservando ambas as assinaturas de sincronização canônica e sua limpeza. O chamador legado RetailerPanel mantém o comportamento padrão. Integrações permanece com seu runtime próprio. Nenhuma remoção do portal legado ou mudança nos escritores de dados.

Aceite automatizado: portal ausente no modo direto; duas assinaturas ativas; portal preservado por padrão; alternar portal não reinicia assinaturas; desmontar libera as duas assinaturas e o listener de autenticação.

## Próximas pendências a confirmar no código

- #765: a ponte global GerencialIntegrationsNativeBridge ainda está montada em main.tsx; mapear a compatibilidade antes de retirá-la. O menu móvel duplicado e o envio seguro de incidentes são subitens separados, não incluídos nesta correção.
- Monitoramento, restauração e privacidade constam sem conclusão em MVP_CLOSURE.md. Checkboxes antigos não substituem evidência atual e não justificam repetir auditorias completas.
- Aprovação humana para merge e qualquer publicação continua pendente. Esta branch bloqueia deploy automático explicitamente.

Rollback desta mudança: reverter o commit da PR. Não há migração, alteração de credenciais, Pix, saldo ou dados em produção.

## Entrega de ativação da gamificação

Consultar GAMIFICATION_ACTIVATION_DELIVERY.md. A #1136 foi integrada à main em `008c6078435a312e05358a583ece6b148614a04e`; esta branch incorpora a main preservando integralmente a correção de inventário e seus testes. A rota `/api/pitangas`, o bloqueio de deploy automático da branch de gamificação e as configurações existentes de produção permanecem preservados. #1135 é substituída como proposta de integração por esta entrega consolidada; a #1135 permanece preservada e não foi fechada ou alterada por esta atualização.
