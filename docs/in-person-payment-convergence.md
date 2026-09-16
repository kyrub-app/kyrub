# Atendimento presencial — mapa de convergência de pagamentos

Este documento registra as camadas já existentes no Kyrub para impedir que uma nova evolução do PDV recrie pagamento, conta ou chamada de atendimento com outra nomenclatura.

## Regra principal

**Não criar uma segunda máquina de pagamento presencial.**

Identidade do cliente, pedido, conta operacional, solicitação ao staff, Payment/PaymentIntent, confirmação do PSP, pontos e fiscal são domínios relacionados, mas não são a mesma autoridade.

## Camada 1 — conta e recebimento operacional legado de mesa

Código atual:

- `src/components/customer/TableServiceWorkspace.tsx`
- `src/utils/tableOperations.ts`

O fluxo existente permite ao staff:

- consultar itens ainda abertos da mesa;
- selecionar itens e quantidades específicas;
- realizar fechamento parcial;
- registrar método `cash | pix | card | other`;
- incrementar `paidQuantity` por linha;
- recalcular `paymentStatus` operacional do `CustomerOrder`;
- concluir o pedido quando todos os itens estiverem pagos ou transferidos.

O recibo é persistido em:

`artifacts/{legacyStoreId}/public/data/tablePayments/{paymentId}`

Esse registro prova que **um operador do estabelecimento registrou um recebimento operacional**. Ele não prova, por si só, liquidação bancária, confirmação de PSP, webhook ou Pix processado pelo Kyrub.

Portanto:

- dinheiro ou cartão presencial podem continuar sendo registrados como fatos operacionais enquanto essa camada existir;
- selecionar `pix` nesse fluxo legado não deve ser confundido com um Pix criado/confirmado pelo Mercado Pago;
- nenhum leitor novo pode transformar automaticamente esse recibo legado em `CanonicalPayment.status = paid`.

## Camada 2 — dual-write operacional de compatibilidade

Código atual:

- `src/components/store/OperationalDualWriteBridge.tsx`
- `src/utils/operationalDualWrite.ts`

O bridge histórico espelha `tablePayments` para:

`stores/{canonicalStoreId}/payments/{paymentId}`

O destino usa o nome `payments`, mas o documento espelhado possui o contrato legado de recebimento de mesa, não o contrato moderno `CanonicalPayment`.

Essa convivência faz de `stores/{storeId}/payments` uma coleção transicional de esquema misto enquanto o bridge antigo permanecer ativo.

### Regra para leitores

Todo leitor que percorra a coleção inteira deve classificar o documento antes de usá-lo:

1. `CanonicalPayment` válido → pode participar das regras financeiras canônicas;
2. espelho reconhecido de `tablePayment` legado → compatibilidade operacional, não PSP proof;
3. formato desconhecido/malformado → falhar fechado; não ignorar silenciosamente.

`server/payments/paymentRecordCompatibility.ts` centraliza essa fronteira.

## Camada 3 — pagamento canônico moderno

Contrato:

- `src/utils/canonicalPayment.ts`
- `src/utils/canonicalPaymentIntent.ts`

A arquitetura moderna já prevê:

- `PaymentMethod = pix | card | cash | other`;
- `PaymentContext = marketplace | table | pos`;
- status independentes do status operacional do pedido;
- PaymentIntent separado do pedido;
- confirmação autoritativa por backend/provedor;
- idempotência e webhook;
- refund/chargeback/reconciliation sem permitir que o frontend declare `paid`.

Para Pix real, o fluxo atual reutiliza Mercado Pago e mantém a cobrança pendente no Kyrub até confirmação autoritativa.

### Limite atual importante

A criação real de PaymentIntent disponível no checkout atual foi desenhada para `delivery | pickup` e contexto `marketplace`.

O contrato já conhece `table | pos`, mas ainda não existe uma extensão canônica concluída para iniciar um Pix contra **um pedido presencial já existente**.

Quando essa extensão for feita, ela deverá reutilizar:

- `CanonicalPayment`;
- `CanonicalPaymentIntent` quando aplicável;
- o adaptador Mercado Pago existente;
- a mesma autoridade de webhook;
- a mesma idempotência e reconciliação.

Ela **não** deve criar um novo `PdvPayment`, `TablePix`, `LocalPayment` ou outro modelo paralelo.

## Camada 4 — Conta do cliente

Código atual:

- `src/components/modals/B2CCartDrawer.tsx`

A aba `Conta` já mostra:

- consumo;
- valor pago;
- valor transferido;
- saldo em aberto;
- estado `unpaid | partial | paid` do pedido.

Hoje ela é principalmente uma projeção operacional e deixa explícito que forma de pagamento/fechamento são confirmados pela loja.

Não devemos criar outra tela de “minha conta” para Service Locations. A evolução deve reaproveitar essa experiência/read model, ajustando a fonte canônica quando a migração chegar nela.

## Camada 5 — identificação Cairuvi e CRM

PRs empilhadas da frente atual:

- #691–#694: Service Locations e pedido presencial canônico;
- #695: identificação do Cairuvi por nome/CPF/telefone + vínculo CRM + leitura do estado financeiro.

Identificar o Cairuvi:

- não confirma pagamento;
- não inicia cobrança automaticamente;
- não gera pontos por si só;
- não altera recibos financeiros já existentes;
- não dispara fiscal.

O mesmo pedido pode existir inicialmente com identidade local e ser vinculado depois a uma conta real sem que isso reescreva silenciosamente a autoridade do pagamento.

## “Chamar staff / solicitar maquininha”

Na auditoria atual do código e histórico de PRs, foi confirmado o fechamento pelo staff e a conta do cliente, mas **não foi localizada uma implementação atual canônica** do botão específico “Solicitar maquininha” / “Chamar staff para pagamento”.

Se essa experiência existiu em uma camada anterior não preservada na árvore atual, sua reconstrução deve ser tratada como **Service Request**, e não como pagamento.

Exemplo conceitual:

`customer -> request_staff(payment_terminal) -> staff acknowledges -> existing payment flow`

A solicitação:

- pode carregar `storeId`, `orderId`, `serviceLocationId`, tipo da solicitação e timestamps;
- pode alertar o staff da mesa/balcão/quarto correto;
- não altera `paymentStatus`;
- não incrementa `paidQuantity`;
- não cria `CanonicalPayment`;
- não afirma recebimento;
- não deve ser usada como prova para CRM, pontos, ledger ou fiscal.

Depois que o staff atender, ele usa a autoridade de pagamento já existente/aprovada.

## Caminho de convergência

### Etapa A — agora

- impedir que espelhos antigos de `tablePayments` quebrem leitores modernos;
- impedir que sejam contados como compra canônica apenas por estarem na coleção `payments`;
- documentar a coexistência das camadas.

### Etapa B — solicitação de atendimento

Reconstruir, se necessário, `Chamar atendimento / Solicitar maquininha` como um evento operacional simples e idempotente, ligado a Service Location e pedido.

Sem movimentação monetária.

### Etapa C — Pix do pedido presencial existente

Adicionar um modo server-side de iniciar Pix para pedido já existente, reutilizando o domínio canônico e Mercado Pago existentes.

Requisitos mínimos:

- reler pedido e saldo no servidor;
- rejeitar cobrança acima do saldo aberto;
- idempotência;
- `context = table | pos` conforme o atendimento;
- comprador identificado quando disponível, sem impedir walk-in quando a regra permitir;
- QR/Copia e Cola vindos do mesmo provider existente;
- `paid` somente pelo mesmo webhook/reconciliation authority;
- atualizar a projeção operacional sem criar um segundo recibo concorrente.

### Etapa D — retirada gradual do registro legado

`registerTablePayment` só pode ser aposentado depois que os casos hoje cobertos por ele tiverem substituto explícito:

- dinheiro;
- cartão presencial/maquininha externa;
- Pix processado pelo Kyrub;
- outros recebimentos autorizados;
- parcial por item/quantidade;
- transferência entre mesas;
- auditoria do operador.

Até lá, preservar compatibilidade é mais seguro que removê-lo.

## Invariantes para qualquer PR futuro desta frente

1. Pedido não é pagamento.
2. Pedido `paymentStatus` não substitui `CanonicalPayment.status` como prova financeira.
3. Service Request não é pagamento.
4. `tablePayment` legado não é webhook de PSP.
5. Pix real reutiliza o provider e o processador canônico existentes.
6. Nenhum frontend declara `paid` para pagamento processado por PSP.
7. Identificação Cairuvi não retroage recibo financeiro silenciosamente.
8. Pontos e CRM contam compra apenas a partir da autoridade econômica definida para aquela modalidade.
9. Fiscal permanece fora desse gatilho até política contábil executável.
10. Nenhum novo modelo de pagamento é criado sem provar que o contrato canônico existente é insuficiente.
