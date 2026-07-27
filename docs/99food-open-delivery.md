# 99Food via Open Delivery

Esta integração conecta uma unidade 99Food ao painel operacional do Kyrub usando o padrão Open Delivery 1.7.0.

## O que está implementado

- OAuth 2.0 `client_credentials`, com token em cache e renovação automática;
- credenciais distintas por estabelecimento;
- armazenamento criptografado do `clientId` e `clientSecret` com AES-256-GCM;
- recebimento por webhook com validação HMAC-SHA256 do corpo bruto;
- polling e acknowledgment como reconciliação;
- idempotência por `eventId`;
- consulta dos detalhes completos do pedido;
- conversão para a coleção já usada pelo KDS;
- espelho no pedido canônico quando a loja já possui `canonicalStoreId`;
- retorno de confirmação, preparação, pronto, despacho, conclusão e cancelamento;
- segregação de credenciais e eventos por tenant.

## Variáveis obrigatórias no servidor

```dotenv
PUBLIC_APP_URL=https://app.kyrub.com
FIREBASE_PROJECT_ID=kyrub-b8d0e
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":"...","client_email":"...","private_key":"..."}
INTEGRATION_MASTER_KEY=<32 bytes em base64 ou 64 caracteres hexadecimais>
INTEGRATION_CRON_SECRET=<segredo longo e aleatório>
```

Em ambientes Google com identidade de serviço, `FIREBASE_SERVICE_ACCOUNT_JSON` pode ser omitido e o Admin SDK usará Application Default Credentials.

Uma chave adequada para `INTEGRATION_MASTER_KEY` pode ser gerada com:

```bash
openssl rand -base64 32
```

Nunca versionar essas variáveis, credenciais da 99Food ou respostas contendo tokens.

## Credenciamento com a 99Food

Para cada restaurante/unidade, solicitar à 99Food:

- Merchant ID;
- URL base da API de sandbox ou produção;
- URL do token, quando diferente de `/oauth/token`;
- `clientId` exclusivo daquele estabelecimento;
- `clientSecret` exclusivo daquele estabelecimento;
- confirmação do intervalo permitido para polling;
- confirmação do endpoint e payload de `merchantOnboarding` usado para registrar o webhook.

A Vitrine Open Delivery da 99Food informa disponibilidade de sandbox, webhook e polling. O contato e o portal técnico indicados pela empresa devem ser usados para obtenção das credenciais e homologação.

## Fluxo de ativação

1. Abrir `Configurações da loja → Integrações → 99Food`.
2. Preencher o nome da unidade, Merchant ID e destino operacional.
3. Abrir a caixa `Conexão real 99Food · Open Delivery`.
4. Informar URLs, `clientId` e `clientSecret`.
5. Tocar em `Validar e conectar`.
6. Confirmar o status `Conector ativo`.
7. Executar `Reconciliar pedidos agora` no sandbox.
8. Criar pedidos de homologação na 99Food.
9. Confirmar entrada única no KDS e retorno correto dos estados.
10. Somente depois repetir o credenciamento no ambiente de produção.

## Webhooks

O conector expõe os endpoints equivalentes:

```text
POST /api/integrations/99food/v1/newEvent
POST /api/integrations/99food/v1/orderUpdate
```

São exigidos:

- `X-App-MerchantId`;
- `X-App-Signature`;
- corpo JSON original, sem transformação anterior à validação.

A assinatura é comparada em tempo constante usando HMAC-SHA256 e o `clientSecret` da unidade.

## Reconciliação programada

O endpoint abaixo consulta todas as conexões configuradas:

```text
GET /api/integrations/99food/internal/poll-all
Authorization: Bearer <INTEGRATION_CRON_SECRET>
```

Também é aceito `X-Cron-Secret`. Configure um scheduler da infraestrutura respeitando o intervalo negociado com a 99Food. Não escolha uma frequência arbitrária: o Open Delivery alerta que cada Ordering Application pode definir limites e penalidades.

## Persistência

Segredos e conexões, acessíveis apenas ao backend:

```text
integrationConnections/{tenantId}__99food
integrationConnectionLookup/{hash}
tenants/{tenantId}/integrationEvents/{eventHash}
```

Pedidos consumidos pelo painel atual:

```text
artifacts/{tenantId}/public/data/customerOrders/{orderId}
```

Espelho canônico, quando configurado:

```text
stores/{canonicalStoreId}/orders/{orderId}
```

## Critérios antes de produção

- credenciais de sandbox e produção separadas;
- webhook público com HTTPS válido;
- nenhum segredo presente em logs ou no navegador;
- pedido repetido não gera duplicidade;
- falha temporária pode ser reconciliada pelo polling;
- confirmação enviada dentro do prazo definido pela 99Food;
- alterações feitas no KDS chegam ao parceiro;
- alertas operacionais para `attention` e falhas de polling;
- plano de contingência mantendo o Gestor de Pedidos 99 aberto durante o piloto;
- homologação formal concluída com a 99Food.
