# Kyrub — arquitetura de recebimentos: Modelo B, split preparado (decisão 14/10/2026)

**Status:** decisão de produto aprovada. Implementação do checkout em PR #949 (Draft até validação em ambiente seguro). Esta decisão não autoriza comissão automática, split 1:1 ativo nem BaaS.

## Autoridade do dinheiro
| Transação | Quem processa/recebe | O que o Kyrub registra | Comissão de marketplace agora |
| --- | --- | --- | --- |
| Venda de produto/serviço na vitrine Kyrub | Conta Mercado Pago do **lojista**, autorizada por OAuth | Pedido canônico, pagamento, taxa MP, evidência do líquido, estoque/CMV e margem | **Não** |
| Venda direta no Mercado Pago fora do Kyrub | Conta do lojista no Mercado Pago | **Espelhamento de evidências**, com vínculo idempotente e sem inventar um segundo recebimento | **Não** |
| Assinatura de serviço/produto oferecida pelo lojista | Conta Mercado Pago do lojista, conforme fluxo de contratação | Venda, assinatura, recebíveis e evidência | **Não** |
| Assinatura do plano do próprio Kyrub | Conta de faturamento da **plataforma** | Faturamento do serviço Kyrub, isolado do tenant lojista | Fora do split de venda de loja |
| Pix histórico já emitido | **Conta originalmente credora**, nunca alterar retroativamente | Consulta de origem e conciliação somente com evidência verificável | Não acrescentar comissão depois da emissão |

O login do lojista é uma autorização OAuth para sua **própria conta Mercado Pago**, não uma segunda conexão com Mercado Livre. Administrador configura o aplicativo integrador do Kyrub uma vez, sem reutilizar uma conta central para cobrar as vendas do lojista.

## Split 1:1 — caminho evolutivo, **DESATIVADO**
O Mercado Pago documenta Split 1:1 de **um vendedor + marketplace**, em que a plataforma pode reter comissão no checkout, usando token OAuth do vendedor:
- Checkout Transparente (Payments API): campo de criação de pagamento `application_fee`.
- Checkout Pro (Preferences API): `marketplace_fee`.
- Comissão MP é deduzida do vendedor antes da comissão de marketplace, conforme a documentação; impostos, taxas, repasses e refunds exigem reconciliação por fonte.
- Cadastro do aplicativo marketplace, elegibilidade/identificação da conta e autorizações OAuth são pré-requisitos.

**Regra segura já definida:** a operação padrão continua SEM `application_fee`, `marketplace_fee`, `split` ou destino secundário; não inserir zero fictício nem previsão de receita por comissão. Uma futura PR deverá introduzir configuração **exclusivamente server-side** por contrato/loja/plano, ativação explicitamente aprovada pelo proprietário do Kyrub, cálculo em centavos com arredondamento testado, snapshot da regra no pedido antes da emissão e evidências do provedor. O frontend não pode definir valor de comissão. Uma vez criado o Pix, não alterar comissão nem conta recebedora por tentativas/retries.

**Split 1:N:** a documentação restringe disponibilidade a clientes com carteira assessorada e contato comercial; não está contratado/habilitado no Kyrub. O fluxo por Orders API e consentimento dos vendedores requer outro contrato e testes. Não implementar array de beneficiários fictício agora, nem afirmar que a habilitação será garantida. BaaS permanece independente e opcional.

## Pré-merge da PR #949: gates obrigatórios
1. CI, TypeScript, grafo Serverless e preview READY no SHA exato.
2. Verificar pela área **Recebimentos → Mercado Pago → Verificar conexão** se a conta autorizada está conectada e qual coletor/conta foi vinculado (sem expor token).
3. Exercitar checkout de vitrine em homologação com método de teste autorizado: pedido aceito → criação Pix via OAuth → binding imutável → pagamento/assinatura do webhook → estoque/KDS → conciliação. O coletor na resposta MP precisa corresponder à conta OAuth do lojista. Na emissão da vitrine, o QR e o binding são bloqueados se a resposta do MP não comprovar `collector_id` igual à conta conectada; essa validação não altera o fluxo legado de vendas locais.
4. Verificar idempotência, reconsulta de Pix já emitido, recusas sem OAuth, assinatura de webhook e cenário legado sem reemissão.
5. Só então integrar na branch fixa de homologação. `main` exige promoção separada aprovada.

## Fontes Mercado Pago (acesso em 14/10/2026)
- Visão geral 1:1: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/overview
- Pré-requisitos e escopo 1:N com atendimento comercial: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites
- OAuth, `application_fee`, `marketplace_fee` e reembolso: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Orders API / split: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders
