# Parcelas e múltiplas obrigações de compras

Este bloco permite que uma compra canônica possua várias obrigações financeiras independentes sem criar parcelas automaticamente.

- a primeira obrigação usa `purchasePayableKey = primary`;
- as seguintes usam chaves sequenciais `installment_002`, `installment_003`, ...;
- cada chave produz um `payableId` determinístico no serviço financeiro;
- retries da mesma chave e dos mesmos dados não duplicam a obrigação;
- uma obrigação cancelada deixa de compor o total financeiro ativo, mas sua chave não é reutilizada;
- recebimento físico não cria, paga, cancela ou altera parcelas;
- pagamento de uma parcela não altera estoque;
- o valor estimado da compra é apenas referência: diferenças por frete, desconto ou ajuste comercial são exibidas, não bloqueadas.
