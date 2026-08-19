# Fase 4.5.1 — Ação oficial de status de pedido

Gate desta etapa:

1. interpretar uma intenção operacional de pedido sem Gemini;
2. reler os pedidos autenticados do ERP;
3. resolver um único pedido real;
4. propor `update_order_status` com `expectedCurrentStatus`;
5. exigir motivo para recusa/cancelamento;
6. exigir confirmação humana;
7. passar por `orders.write` no policy engine;
8. executar o motor autoritativo já existente de pedido + estoque;
9. sincronizar 99Food quando aplicável;
10. persistir recibo idempotente;
11. invalidar o snapshot ERP após sucesso.

O fluxo manual continua usando o motor existente. Esta etapa não cria uma segunda regra de transição de pedido.