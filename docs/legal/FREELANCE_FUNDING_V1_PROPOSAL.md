# Kyrub Freelas — política de financiamento V1 (proposta, não aprovada)
 
## Princípios
- Contratante financia serviço; Kyrub intermediador, sem antecipação própria ou custódia interna.
- Remuneração acordada em centavos, separada de taxas e responsabilidade econômica. Percentual de comissão, incidência de tarifas, prazos de cancelamento e remuneração parcial exigem aprovação do proprietário e revisão contratual.
- Confirmação bilateral da contratação precede cobrança. Início de serviço comercial deve depender de financiamento confirmado pelo PSP, com condições de liberação, devolução e cancelamento acordadas. O serviço candidato agora exige cobertura simulada exclusivamente no emulador local; bloqueia início fora dele até implementação de adaptador real autorizado. Não pode ser ativado comercialmente.
- Conclusão operacional gera base de remuneração; cancelamento após contratação preserva valor e deixa remuneração indeterminada até decisão. Não presume zero nem integral. Não realiza transferência ou débito automaticamente.
- Sem subsídio, crédito, saldo custodiado ou antecipação pela plataforma por padrão. Não presumir capacidade de retenção de fundos ou garantia de pagamento.
 
## Mercado Pago — alternativas verificadas em 27/11/2026
- Split 1:1: prestador conhecido antes da cobrança. Checkout Pro/Transparente documentado; OAuth e KYC exigidos. Confirmar se a atividade de serviços e a liberação condicionada à conclusão são suportadas. O fluxo comum de split não equivale a retenção até conclusão. Não presumir taxas ou prazos.
- Split 1:N via Orders: exige habilitação comercial e consentimento do vendedor secundário; não pressupor disponibilidade. Documentação de migração informa que a Orders API não possui equivalente documentado ao application_fee da Payments API para 1:1.
- Payouts: possível alternativa somente após confirmação comercial de origem dos fundos, autorização, beneficiário, devolução, idempotência e conciliação. Não contratar nem configurar produto.
- Perfil financeiro por UID deve reutilizar a identidade financeira genérica do ecossistema (#262), mediante reconciliação com a árvore produtiva. Sem armazenamento de chaves Pix ou documentos adicionais nesta parcela.
 
Referências oficiais:
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/split-payments-1-n
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders
- https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/api-endpoints
 
## Portões de liberação
1. Aprovação de política, tarifas e contrato com PSP, revisão jurídica/contábil.
2. Implementar registro canônico de financiamento vinculado ao contrato e recebedor, confirmação do PSP e bloqueio de início sem cobertura.
3. Homologar ambiente de teste: pagamento, duplicatas, confirmação, falha, cancelamento, devolução, remuneração parcial, recebedor inválido e conciliação. Nenhuma chamada real nesta parcela.
4. Integrar painel de ganhos e avisos; diferenciar previsto, serviço confirmado, revisão financeira e recebido comprovado.
5. Teste integrado de duas contas, regras, concorrência, UI, autenticação administrativa/MFA e evidência do PSP. O novo teste no emulador cobre apenas a operação e base de remuneração, não o PSP ou liberação financeira.
6. Autorizações específicas para merge, implantação e qualquer configuração de produção.

## Pendência de continuidade — decisão do proprietário em 27/11/2026
Após concluir a etapa técnica de Freelas e sua homologação isolada, revisar especificamente como operar o Mercado Pago enquanto o Split 1:N não estiver habilitado, considerando Lojas, Entregas e Freelas, sem antecipar a discussão nesta etapa. Nenhuma configuração comercial, taxa ou integração real é aprovada por este registro.
