# Auditoria de prontidão — Split de pagamentos Mercado Pago (17/11/2026)

**Escopo:** inspeção somente leitura do código `main` (`008c6078435a312e05358a583ece6b148614a04e`), de metadados **não descriptografados** do projeto Vercel `kyrub`, e da documentação pública atual do Mercado Pago. **Nenhum pagamento, configuração da conta, credencial, recurso de produção, contrato ou deploy alterado.**

## Resultado

| Frente | Estado confirmado | O que NÃO está comprovado |
| --- | --- | --- |
| Pix de venda da loja | Implementado com recebedor da loja por OAuth, validação `/users/me`, `collector_id`, binding ao pagamento; sujeito às flags próprias e a preflight efetivo | Habilitação de checkout para novas vendas em produção, sucesso de Pix real recente |
| Split 1:1 | **DESATIVADO por desenho no checkout atual:** sem `application_fee`, `marketplace_fee` ou `splits` nos emissores | Habilitação comercial, compatibilidade Pix+split efetiva e conta marketplace correta |
| Split 1:N | **NÃO IMPLEMENTADO** | Elegibilidade contratual (carteira assessorada) e consentimento de recebedores |
| Remuneração entregador | Obrigação econômica separada de `Payment/Allocation/Settlement`; retorno/espera ainda exigem evidência, tarifário e revisão | Canal autorizado de repasse; participação como recebedor em split 1:1 ou 1:N |
| Pro/Business da Loja Oficial | Recebedor da plataforma, separado das vendas de lojistas | Nenhuma autorização para aplicar comissão de marketplace às assinaturas oficiais |

## Evidências técnicas reproduzíveis

- `server/payments/mercadoPagoStoreScopedProvider.ts`: o POST `/v1/payments` usa o OAuth do lojista e dados do pedido, mas não envia `application_fee`. Verifica identidade `/users/me` e `collector_id`; preserva binding ao mesmo recebedor.
- `server/payments/mercadoPagoCheckoutBridge.ts`: encaminha novas cobranças ao provedor escopado da loja; não insere split nem altera Pix histórico.
- `server/payments/mercadoPagoMerchantPixRolloutPolicy.ts`: novas cobranças marketplace passam apenas em `VERCEL_ENV=production`, `KYRUB_MP_MERCHANT_PIX_ENABLED=true` e modo `canary` com ID exato ou `connected_stores`. Padrão é **bloquear**; a flag de **emissão Pix da loja** não é uma autorização de **split**.
- `shared/marketplaceSellerSplit.ts`: calcula plano **sem movimentar fundos**; saldo bruto menos comissão proposta NÃO é valor líquido real, pois as tarifas do PSP permanecem não verificadas. Esta auditoria acrescenta campos explícitos `sellerNetReceivedMinor:null`, `providerProcessingFeeMinor:null` e `settlementVerified:false` no contrato *planned*.
- `shared/commercialRecipientAuthority.ts`: vendas de lojista usam conta da loja, cobrança de plano usa conta da plataforma e `platformFeeMode:'separate'`.
- `tests/marketplace-split-disabled-by-default.test.ts`: teste existente protege a ausência de split em ambos os caminhos de checkout.
- Inspeção Vercel **somente metadados** de 14 variáveis de projeto (17/11/2026, sem descriptografar valores): não foram encontradas as chaves `KYRUB_MP_MERCHANT_PIX_ENABLED`, `KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE`, `KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID` nem uma chave explícita de split. Isso **não substitui** inspeção dos ambientes reais, configurações compartilhadas ou painel Mercado Pago; a presença de credenciais de billing da plataforma tampouco habilita split de vendas.
- `docs/finance/marketplace-merchant-pix-cutover-isolated.md`: proíbe split 1:1 e 1:N no cutover inicial; prevê piloto controlado.

## Mercado Pago: especificação do fornecedor

Documentação oficial consultada em 17/11/2026:

1. [Split 1:1 — integração](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace): marketplace deve obter **OAuth de cada vendedor**; Checkout Transparente/Payments API usa `application_fee` **como valor**, Checkout Pro usa `marketplace_fee`. É o Mercado Pago quem efetua a separação; a comissão/taxas do PSP afetam o líquido do vendedor. Em reembolso, o ressarcimento envolve proporcionalmente vendedor e marketplace, sujeito a restrições de saldo.
2. [Pré-requisitos Split 1:1](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites): inclui conta de vendedor com KYC, OAuth, aplicação compatível e contas de teste. Não inferir elegibilidade de uma conta só porque o token funciona para Pix.
3. [Criar aplicação marketplace e Redirect URL](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration): conferir produto, modelo Marketplace, callback OAuth e escopos.
4. [Split 1:N — Orders API](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/split-payments-1-n): disponibilidade restrita a carteira assessorada/contato comercial, consentimento formal dos recebedores e `receiver_id` por participante.
5. [Relatório de vendas split](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/additional-content/reports/sales-report/report-fields): conciliar pagamento, comissão, custo MP, valor líquido e recebedor por registro.

**Questão aberta, não afirmar sem teste contratual:** confirmar expressamente com o Mercado Pago o suporte a **Pix externo** no modelo 1:1 da *aplicação marketplace específica*. O guia de split menciona restrições a transferências de instituições externas, enquanto páginas gerais do Checkout Transparente oferecem Pix. Isso exige teste de compatibilidade do caso concreto, não a inferência de que todo Pix padrão suporta split.

## Bloqueios de liberação antes de criar qualquer `application_fee`

- [ ] **Owner/comercial:** verificar no Mercado Pago Developers, pela conta marketplace correspondente ao Kyrub, que a aplicação é `Marketplace`, que o produto Checkout Transparente/Payments API é compatível com a comissão e que o aceite/termos/repasse estão habilitados; observar KYC do vendedor e vínculo de OAuth, sem copiar tokens para o chat.
- [ ] **Produto:** aprovar valor/percentual da comissão de plataforma e quem absorve custos de PSP; congelar percentual/valor em centavos **por venda**, com prazo de vigência, versionamento e aceite do lojista. Nenhum percentual é presumido nesta auditoria.
- [ ] **Backend:** só após aprovação, implementar modo de split explicitamente habilitável, fail-closed, sobre o checkout **existente**, com conta de vendedor original, `application_fee` informado em valor exato e vinculada a cada cobrança, sem mudar o faturamento Pro/Business e sem aceitar valores de navegador.
- [ ] **Conciliação:** capturar evidências do PSP de aplicação de comissão, `collector_id`, `payment_id`, valor bruto, taxa MP, marketplace fee, líquido vendedor e reversões; não inferir comissão recebida apenas do payload enviado.
- [ ] **Reembolsos:** homologar total/parcial, duplicatas, PSP incerto, falta de saldo vendedor e responsabilidade por taxas. PR #1146 protege histórico parcial em análise, mas **não valida split real**.
- [ ] **Entregas:** PR #1145 conserva retorno, espera, custódia e revisão financeira independentes. **Não** inserir entregador como terceiro recebedor em split 1:1. Para 1:N requer habilitação comercial e rail de liquidação autorizado; antes disso, manter obrigação auditável sem execução.
- [ ] **E2E:** teste isolado de receita e recusa do `application_fee`, valores em centavos, transações concorrentes, webhook, estorno e relatório. Posteriormente apenas um piloto autorizado de valor limitado em produção, nunca pela ativação automática de flags.
- [ ] **Release:** revisão jurídica, consentimento e autorização explícita do proprietário antes de habilitar produção; verificar SHA e logs sem dados pessoais.

## Sequência recomendada

**Curto prazo:** concluir os gates de PRs #1145 (Entregas) e #1146 (reembolsos), mantendo-as independentes. Encerrar inventário de configuração do split, sem cobrança.  
**Depois:** colher prova de habilitação comercial e compatibilidade de Pix 1:1 junto ao Mercado Pago; modelar tarifa/consentimento e reconciliação de comissão.  
**Mais adiante:** avaliar 1:N com a equipe comercial, sem forçar pagamentos do entregador pelo caixa da plataforma.

**Decisão operacional desta auditoria:** `split_1_1=blocked_pending_commercial_confirmation`; `split_1_n=not_eligible_until_approved`; `automatic_courier_split=disabled`; nenhuma flag nova nem cobrança.
