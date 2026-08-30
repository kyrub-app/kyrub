# PSP Qualification Matrix — Marketplace Payments

Atualizado em: 2026-08-30

## Objetivo

Comparar provedores para o modelo econômico do Kyrub sem assumir custódia própria, sem inventar rails e sem confundir allocation com settlement.

Critérios avaliados: Pix, onboarding de sellers/recebedores, autorização/conexão, split 1:1, split 1:N, refunds, webhooks, KYC, settlement/repasse, sandbox, produção, suporte/comercial e riscos relevantes.

## Resumo executivo

| Provedor | Pix | Seller/recipient onboarding | 1:1 | 1:N | Refund | Webhook | Sandbox | Observação principal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mercado Pago | Sim | Conta Mercado Pago + OAuth; KYC 6 documentado para seller no modelo 1:1 | Sim, documentado | Comercial/restrito: carteira assessorada | Sim, com regra proporcional no 1:1 | Sim | Contas de teste | Melhor aderência imediata ao fluxo 1:1 já iniciado no Kyrub; 1:N depende de gate comercial |
| PagBank | Sim | Modelo de aplicações / recebedores PagBank | Sim | Sim, múltiplos recebedores; docs atuais citam até 15 | Sim; documentação também cobre estornos com split | Sim | Sim | Forte candidato técnico para 1:N, inclusive marketplace + vendedor + entrega no mesmo pagamento |
| Pagar.me | Sim | `recipient` com cadastro/KYC e conta bancária; split disponível para clientes PSP | Sim | Sim | Sim; Pix suporta estorno total/parcial | Sim | Requer homologação contratual do produto aplicável | Forte desenho de recebedores e responsabilidades, mas split é explicitamente condicionado a contrato PSP |
| Asaas | Sim | Conta/subconta Asaas + `walletId` | Sim | Sim, múltiplas carteiras | Cobranças possuem eventos/fluxos de estorno; confirmar regras econômicas de split no contrato | Sim, inclusive `PAYMENT_SPLIT_DONE` | Sim | Alternativa interessante para white-label/subcontas; precisa qualificação comercial/jurídica mais profunda antes de decisão |

## 1. Mercado Pago

### Evidência oficial

- Split 1:1 é produto oficial de marketplace no Brasil.
- O vendedor autoriza o marketplace via OAuth; o access token do seller é usado no backend.
- O marketplace recebe sua comissão por `marketplace_fee` ou `application_fee`, conforme checkout.
- Pré-requisitos do 1:1 incluem seller Mercado Pago com nível de identificação KYC 6, OAuth e contas de teste.
- A documentação informa que o modelo 1:N está disponível apenas para vendedores de carteira assessorada em contato com o time comercial.
- Refund no 1:1 é repartido proporcionalmente entre seller e marketplace; há risco operacional caso o seller não possua saldo suficiente para sua parcela do reembolso.

### Fit Kyrub

**Bom para MVP 1:1.** É o caminho com menor desvio em relação ao provider, webhook e Vault já construídos. Para 1:N, não devemos implementar por hipótese: primeiro precisa haver habilitação comercial oficial.

### Links oficiais

- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/overview
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/additional-content/security/oauth/introduction

## 2. PagBank

### Evidência oficial

- A API de divisão de pagamento suporta boleto, cartão e Pix.
- Um único pagamento pode ser distribuído automaticamente entre múltiplos recebedores sem criar transações manuais posteriores.
- A documentação usa explicitamente o exemplo marketplace + vendedor + empresa responsável pela entrega.
- A documentação atual de Pedidos & Pagamentos informa divisão em até 15 recebedores, por valor fixo ou percentual.
- A liquidação ocorre nas contas PagBank dos recebedores conforme as regras do produto.
- Há ambiente Sandbox e fluxo separado de produção.
- O PagBank documenta cancelamentos/estornos e webhooks nas APIs de pagamentos; em split, o recebedor primário possui responsabilidades específicas, inclusive chargeback/cancelamento.

### Fit Kyrub

**Candidato técnico forte para 1:N.** O exemplo oficial com marketplace, seller e logística é especialmente aderente à arquitetura Kyrub. Antes de escolha comercial, ainda precisamos confirmar onboarding/KYC de cada tipo de recebedor, preço negociado, limites efetivos em produção e desenho contratual de responsabilidade/chargeback.

### Links oficiais

- https://developer.pagbank.com.br/reference/divisao-de-pagamento
- https://developer.pagbank.com.br/reference/como-utilizar-a-divisao-de-pagamento
- https://developer.pagbank.com.br/docs/servicos-de-pedidos-e-pagamentos
- https://developer.pagbank.com.br/v1/reference/split-ambientes-disponiveis
- https://developer.pagbank.com.br/docs/apis-pagbank

## 3. Pagar.me

### Evidência oficial

- Split permite pedidos com mais de um recebedor, por valor ou percentual.
- A documentação atual marca a funcionalidade como disponível para clientes PSP.
- Recebedores são entidades próprias (`recipient`) e precisam ser cadastrados antes de participar de splits.
- O contrato de recebedores exige dados mínimos cadastrais em razão de obrigações regulatórias/KYC.
- Pix suporta split com dois ou mais recebedores.
- Pix também documenta estorno total ou parcial.
- O marketplace define regras de divisão e responsabilidades por recebedor.

### Fit Kyrub

**Muito aderente conceitualmente ao Settlement Adapter multi-recebedor**, mas existe um gate comercial/contratual claro: ser cliente PSP/habilitado para o produto. Não devemos tratar disponibilidade na documentação como habilitação automática da conta Kyrub.

### Links oficiais

- https://docs.pagar.me/docs/pedidos-com-split
- https://docs.pagar.me/docs/recebedores-2
- https://docs.pagar.me/reference/recebedores-1
- https://docs.pagar.me/docs/overview-marketplace
- https://docs.pagar.me/docs/pix-1

## 4. Asaas

### Evidência oficial

- Split distribui automaticamente partes de uma cobrança para outras contas Asaas.
- Cada recebedor utiliza `walletId`; splits podem ser fixos ou percentuais.
- Subcontas podem ser criadas via API e o retorno inclui `walletId`, cenário documentado para white-label, marketplaces e ERPs.
- Pix, subcontas, split e webhooks fazem parte da plataforma.
- Há evento específico `PAYMENT_SPLIT_DONE` para acompanhar liquidação de split.
- Sandbox suporta cobranças, Pix, split, transferências e webhooks sem movimentação real.
- Produção pode exigir habilitações distintas das simulações disponíveis em Sandbox.

### Fit Kyrub

**Candidato secundário relevante**, especialmente se o produto evoluir para uma camada white-label/BaaS com subcontas. Precisamos validar comercialmente KYC, responsabilidades de marketplace, política de refunds/chargebacks em splits, custos e condições de produção antes de promover este provider a candidato principal.

### Links oficiais

- https://docs.asaas.com/docs/split-de-pagamentos
- https://docs.asaas.com/reference/criar-subconta
- https://docs.asaas.com/docs/sandbox
- https://docs.asaas.com/docs/webhook-para-cobrancas

## Matriz de decisão para o Kyrub

### MVP marketplace 1:1

1. **Mercado Pago** — prioridade atual, pois já existe integração estrutural no Kyrub e o produto 1:1 é oficialmente documentado com OAuth de seller.
2. **PagBank** — manter como principal alternativa/segunda implementação do Settlement Adapter.
3. **Pagar.me** — qualificar comercialmente como opção PSP estruturada.
4. **Asaas** — qualificar como alternativa de white-label/subcontas e split.

### Futuro 1:N

Não escolher por preferência de API. A ordem correta é:

`requisito Kyrub → habilitação comercial real → KYC/onboarding → responsabilidades → custos → sandbox → Settlement Adapter`.

No estado atual:

- Mercado Pago: **gate comercial obrigatório para 1:N**.
- PagBank: **capacidade técnica pública forte para multi-recebedor**; falta qualificação comercial do caso Kyrub.
- Pagar.me: **capacidade técnica pública forte**, mas split depende de contratação/habilitação PSP.
- Asaas: **capacidade técnica de multi-conta/split existe**, mas a aderência jurídica/comercial ao desenho completo do marketplace Kyrub ainda precisa ser qualificada.

## Itens que NÃO estão decididos por esta matriz

Esta análise não escolhe automaticamente provider de produção, não cria conta, não aceita contrato, não define tarifas, não define custodiante, não movimenta dinheiro e não autoriza 1:N.

Ainda exigem Owner/Commercial Gate:

- preços e MDR/tarifas negociadas;
- modelo contratual de marketplace/PSP;
- KYC e onboarding de lojistas, entregadores e demais recebedores;
- responsabilidades por chargeback/refund/saldo insuficiente;
- limites e SLAs de produção;
- autorização efetiva de 1:N;
- definição de qual rail liquidará obrigações de entregadores/freelancers.

## Conclusão operacional

Para a arquitetura atual, manter **Mercado Pago como primeiro adapter 1:1** é racional. Paralelamente, o **PagBank deve ser o primeiro candidato a uma prova técnica de adapter 1:N**, sem ativar dinheiro real e sem assumir que a aprovação comercial existe. Pagar.me deve entrar na mesma rodada de qualificação comercial. Asaas permanece como alternativa relevante para a futura camada white-label/BaaS.
