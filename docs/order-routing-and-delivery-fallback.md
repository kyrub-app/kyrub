# Aprovação de pedidos, KDS multiorigem e fallback de entregas

Este documento descreve a etapa operacional posterior ao conector 99Food/Open Delivery.

## Duplo gate para autoatendimento presencial

Pedidos feitos pelo cliente em uma mesa ou código de atendimento não entram diretamente em produção.

```text
Cliente envia pelo QR Code
        ↓
Card da mesa/comanda — aguardando staff
        ↓
Staff revisa, altera, aprova ou recusa
        ↓
Pedido continua pending, agora liberado para o KDS
        ↓
KDS aceita ou recusa
        ↓
preparing → ready → dispatch → delivered
```

A aprovação comercial e a decisão operacional são distintas:

- antes da aprovação do staff, `operatorId` permanece vazio e o pedido fica oculto do KDS;
- ao aprovar, o staff é registrado em `operatorId` e `operatorName`, mas o status continua `pending`;
- o alerta “novo” desaparece do card de atendimento;
- o KDS passa a exibir o pedido e mantém as ações de aceitar ou recusar;
- qualquer recusa exige motivo e pode incluir uma alternativa sugerida.

## Filtro global de origem no KDS

A primeira barra do painel de Pedidos filtra a origem antes das etapas operacionais.

Origens reconhecidas inicialmente:

- ambientes de atendimento presencial cadastrados;
- Kyrub Ofertas;
- PDV / Staff;
- 99Food;
- outros canais de marketplace.

Enquanto os produtos ainda não possuem roteamento por estação própria, o ambiente presencial é inferido pelo código da mesa e pelos nomes cadastrados em `Ambientes`.

## Webhook 99Food em alto volume

O endpoint público não transforma o pedido dentro da mesma requisição.

```text
99Food
  ↓
validação do Merchant ID e HMAC
  ↓
integrationIngress — gravação durável e idempotente
  ↓
HTTP 200 vazio
  ↓
worker protegido
  ↓
normalização, persistência e KDS
```

A fila utiliza:

- identidade derivada de Merchant ID + `eventId`;
- `availableAt` para ordenar somente eventos executáveis;
- lease para impedir dois workers no mesmo evento;
- backoff exponencial após falha;
- remoção de `availableAt` após sucesso;
- remoção do corpo bruto, assinatura e payload após sucesso;
- `expiresAt` para retenção de auditoria por 30 dias.

Configure uma política TTL do Firestore para o campo:

```text
integrationIngress.expiresAt
```

## Workers e schedulers

Todos os endpoints abaixo exigem `INTEGRATION_CRON_SECRET`, enviado em `Authorization: Bearer` ou `X-Cron-Secret`.

### Processar a fila de webhooks

```text
GET /api/integrations/99food/internal/drain
```

Pode ser executado frequentemente. O worker processa somente documentos cujo `availableAt` já venceu.

### Reconciliação por polling

```text
GET /api/integrations/99food/internal/poll-all
```

Esse endpoint drena a fila antes de consultar o polling. A frequência do polling deve respeitar o intervalo negociado com a 99Food.

### Escalonar entregas sem aceite

```text
GET /api/delivery-opportunities/internal/escalate
```

Recomenda-se execução ao menos uma vez por minuto para aproximar o fallback da janela de três minutos.

## Kyrub Entregas

Quando um pedido com `fulfillmentType=delivery` chega a `ready` ou `out_for_delivery`, o Kyrub cria uma oportunidade idempotente em:

```text
delivery_jobs/{deliveryJobId}
```

A oportunidade aparece no mural existente da guia `Renda → Kyrub Entregas`.

Se o status continuar `available` após três minutos, o worker cria:

```text
adminLogisticsEscalations/{deliveryJobId}
```

com estado:

```text
awaiting_provider_routing
```

Isso prepara o controle de `admin.kyrub.com`, mas ainda não chama Lalamove, entreGo ou qualquer outro parceiro. Credenciais, regras de seleção, preços e aceite de cada fornecedor serão implementados em conectores próprios.

## Critérios de validação

- pedido de QR não aparece no KDS antes da revisão do staff;
- aprovação do staff não equivale à aceitação do KDS;
- o card da mesa deixa de mostrar alerta comercial após a revisão;
- recusa registra motivo e alternativa;
- filtro de origem aparece acima dos filtros de etapa;
- webhook duplicado não cria duas entradas;
- o webhook responde `200` após a gravação durável;
- falha de worker permanece reprocessável;
- payload sensível é removido após sucesso;
- entrega pronta cria uma única oportunidade;
- aceite antes de três minutos impede o fallback;
- ausência de aceite cria uma única escalada para o painel administrativo.
