# Fila de lançamento recuperada — 15/11/2026

Base inspecionada: main `5fc6c53233bfc05dd7025111aae90530f9d46bc2`.

## Preservar as entregas e evidências existentes

- #1134 está integrada: primeira publicação verificada com 2 XP e 0 Pitangas. Não reexecutar a jornada já aprovada sem evidência de regressão. A issue #1133 aberta não prova que a implementação esteja ausente.
- Cadastro, criação da loja, Free, contratação Pro/Business e confirmação de pagamento: preservar as validações relatadas no histórico. Esta entrega não reabre esses fluxos nem afirma nova homologação em produção.
- #1135 continua aberta e isolada, sem ativação de 100 Pitangas. Auditoria de escritores antigos e conversão ficam pós-lançamento; não alterar writersVerified ou saldos.
- #1130/#1132/#1128 são trabalhos anteriores isolados; não retomá-los automaticamente como próxima base.

## Defeito atual escolhido — parte da #765

Produtos & Estoque usa ProductInventoryDirectRuntime, cujo host é `erp-product-inventory-workspace`. OperationalDualWriteBridge também montava StoreConnectionsPortalBridge, que procura `kyrub-product-inventory-workspace-host` e tenta novamente a cada 80 ms. O host pertence à interface antiga e não aparece no módulo direto.

Correção limitada: o módulo direto desativa a montagem do portal, preservando ambas as assinaturas de sincronização canônica e sua limpeza. O chamador legado RetailerPanel mantém o comportamento padrão. Integrações permanece com seu runtime próprio. Nenhuma remoção do portal legado ou mudança nos escritores de dados.

Aceite automatizado: portal ausente no modo direto; duas assinaturas ativas; portal preservado por padrão; alternar portal não reinicia assinaturas; desmontar libera as duas assinaturas e o listener de autenticação.

## Próximas pendências a confirmar no código

- #765: a ponte global GerencialIntegrationsNativeBridge ainda está montada em main.tsx; mapear a compatibilidade antes de retirá-la. O menu móvel duplicado e o envio seguro de incidentes são subitens separados, não incluídos nesta correção.
- Monitoramento, restauração e privacidade constam sem conclusão em MVP_CLOSURE.md. Checkboxes antigos não substituem evidência atual e não justificam repetir auditorias completas.
- Aprovação humana para merge e qualquer publicação continua pendente. Esta branch bloqueia deploy automático explicitamente.

Rollback desta mudança: reverter o commit da PR. Não há migração, alteração de credenciais, Pix, saldo ou dados em produção.
