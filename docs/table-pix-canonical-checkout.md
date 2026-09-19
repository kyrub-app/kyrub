# Pix da conta da mesa — convergência canônica

## Problema observado

A tela histórica `TableServiceWorkspace` oferece `cash | pix | card | other` no mesmo registro operacional. Quando `pix` era escolhido, `registerTablePayment` tratava a opção como um recebimento presencial já ocorrido, incrementava `paidQuantity` e podia concluir o pedido/baixar a mesa sem criar uma cobrança Pix no provedor.

Esse comportamento é válido apenas como compatibilidade histórica de recebimento registrado pelo operador; ele não pode representar um Pix processado pelo Kyrub.

## Correção deste corte

`TablePixCanonicalCheckoutBridge` intercepta a escolha de Pix na conta histórica da mesa e abre o fluxo canônico já existente de pagamento local:

1. relê os pedidos ativos da mesa;
2. usa `ServiceLocationFinancialContextPanel`;
3. recupera ou cria `PaymentIntent` canônico por pedido;
4. anexa o Pix do Mercado Pago;
5. exibe QR Code e Pix copia-e-cola;
6. mantém a cobrança pendente até webhook/reconciliação autoritativa.

Enquanto Pix estiver selecionado na tela legada, o clique em `Registrar pagamento` é bloqueado na fase de captura para não alcançar `registerTablePayment` e não antecipar `paidQuantity`.

## Limite preservado

A cobrança Pix canônica atual é por pedido e o valor é calculado no servidor. A seleção granular de itens da tela histórica não é enviada como valor bancário.

Se uma mesa tiver vários pedidos ativos, cada pedido aparece separadamente. Isso evita somar valores no navegador, preserva idempotência e impede uma segunda autoridade financeira.

## Invariantes

- gerar QR Code não significa pagamento;
- o frontend não declara `paid`;
- `paidQuantity` não é alterado ao abrir o Pix;
- o webhook verificado continua sendo autoridade do PSP;
- dinheiro/cartão/outro permanecem no registro operacional legado neste corte;
- nenhuma nova coleção ou novo modelo de pagamento foi criado.
