# Kyrub — Lista-mãe e mapa de lançamento do MVP

Atualizado em 2026-10-27. Documento de acompanhamento; **não constitui homologação**.

## Regras de acompanhamento
- Status: **não auditado**, **implementado sem validação**, **homologado**, **bloqueado**, **pós-MVP**.
- Uma funcionalidade só recebe status **homologado** após evidências de teste e validação no ambiente correto.
- Não duplicar implementações: identificar fonte canônica antes de alterar bridges, rotas e módulos legados.
- A produção não deve receber mudanças sem os gates apropriados.
- O ERP manual deve funcionar sem dependência de IA.

## 12 frentes principais

| ID | Frente | Escopo | Situação de verificação |
|---|---|---|---|
| F01 | Identidade e acesso | Conta, login, perfil, permissões, ativação da loja | Não auditado integralmente |
| F02 | Praça e Comunidades | Feed, Salvos, comunidades, membros, grupos, convites, chat | Implementação em andamento; homologação pendente |
| F03 | Marketplace | Descoberta, vitrine, carrinho, pedidos, checkout | Auditoria transversal pendente |
| F04 | ERP do lojista | Produtos, serviços, estoque, PDV, caixa, financeiro, fiscal, CRM, equipe, relatórios | Auditoria específica e E2E pendentes |
| F05 | Pagamentos e repasses | MP OAuth, split, taxas, ledger, repasses, conciliação | Split e repasses não homologados ponta a ponta |
| F06 | Entregas e logística | Solicitação, aceite, conclusão, cancelamento, remuneração | Auditoria E2E pendente |
| F07 | Freelancers e serviços | Contratação, execução, avaliação, remuneração | Não auditado integralmente |
| F08 | Planos e assinaturas | Free/Pro/Business, loja oficial, contratos, limites | Consolidação pendente |
| F09 | Governança administrativa | Regras globais, indicadores, auditoria, central de repasses | Consolidação pendente |
| F10 | Kyrubia e automações | IA assistiva e tarefas com autorização; ERP manual independente | Não auditado integralmente |
| F11 | Ecossistema Kairubi | Fidelidade, pontos, NFC, identificação, widgets, IoT | Priorizar por dependência; parte pós-MVP |
| F12 | Infraestrutura, segurança e lançamento | Firestore, isolamento, testes, deploy, monitoramento | Gates finais pendentes |

## Cinco blocos prioritários para lançar
1. **Experiência principal:** Praça → Comunidades → Perfil, navegação e Marketplace; eliminar duplicidades sem perder funcionalidades.
2. **ERP:** ativação da loja, cadastro, venda, estoque, caixa, financeiro, fiscal aplicável, equipe, CRM e operação manual completa.
3. **Financeiro da plataforma:** Mercado Pago, comissão, taxa fixa, conciliação e repasses.
4. **Jornada operacional:** compra → pagamento → pedido → entrega/serviço → confirmação → repasse → pós-venda, cancelamento e reembolso.
5. **Beta Gate:** testes E2E, isolamento multi-tenant, regras Firestore, deploy fixo de homologação e conferência final.

## Contrato comercial pretendido — Marketplace
- Total do cliente = produtos/serviços + taxa de entrega + **R$ 1,00** de taxa do aplicativo.
- Comissão da plataforma = **7% do valor dos produtos/serviços do lojista**, excluindo frete.
- Valor econômico do lojista = produtos/serviços menos comissão, antes das tarifas/encargos aplicáveis.
- A plataforma administra a obrigação de repasse da entrega ao entregador; não contabilizar esse valor como receita própria.
- Exemplo: produtos R$ 100 + frete R$ 20 + taxa R$ 1 = cliente R$ 121; destino econômico lojista R$ 93, plataforma receita R$ 8, obrigação de repasse R$ 20; antes das tarifas.
- **Hipótese a homologar:** split Mercado Pago 1:1 entre lojista e Kyrub, com a plataforma recebendo o valor da comissão, da taxa fixa e o montante destinado ao entregador. Validar limites, tarifas, comportamento real do checkout e conciliação; não presumir que a API aceita a configuração.
- Split 1:N: evolução sujeita à habilitação comercial. Não bloquear MVP exclusivamente por isso.
- Repasse do Kyrub ao entregador: pesquisar Pix de saída automatizado; até lá, processo manual com autorização, comprovante, idempotência e conciliação. Não marcar como pago antes de confirmação.
- Central de Repasses (ADM): **pendente → liberado → pago**, com estados de falha, cancelamento e estorno; separar entregadores de freelancers e preservar rastreabilidade por pedido/serviço.
- Confirmar juridicamente/contabilmente a custódia temporária, tarifas, responsabilidade de reembolsos e regras de saque antes de operar com dinheiro real.

## Critérios mínimos de homologação do MVP
- [ ] Cadastro, login, Perfil e ativação de loja.
- [ ] ERP manual: produtos, vendas, estoque, caixa, financeiro, equipe e CRM.
- [ ] Marketplace: vitrine, carrinho, checkout e pedidos.
- [ ] Split e valores reconciliados com pagamento real.
- [ ] Taxa fixa de R$ 1 e comissão de 7% aplicadas corretamente.
- [ ] Entrega concluída e repasse ao profissional com comprovante.
- [ ] Cancelamento, reembolso e prevenção de pagamento duplicado.
- [ ] Permissões, isolamento de lojas e regras de segurança publicados e testados.
- [ ] Homologação visual e funcional no endereço fixo.
- [ ] Beta Gate E2E documentado, com evidências e responsáveis.

## Próxima auditoria — evidência por frente
Para cada frente registrar: caminho canônico, rotas/telas, contratos de dados, testes existentes, execução dos testes, lacunas, bloqueadores, decisão MVP/pós-MVP e links de commit/PR/deploy.

**Próxima sequência:** fechar F02 (Praça/Comunidades/Perfil), depois F03 (Marketplace), F04 (ERP), F05 (Pagamentos/Repasses), F06 (Entregas) e F12 (Beta Gate). Não considerar o documento como prova de conclusão.
