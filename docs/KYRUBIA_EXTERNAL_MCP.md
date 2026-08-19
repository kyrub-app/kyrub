# Kyrubia MCP — integração com IAs externas

Status: **Fase 3.9 em desenvolvimento**.

## Objetivo

Permitir que o usuário conecte dados e capacidades do próprio Kyrub a agentes externos compatíveis com MCP, sem duplicar regras de negócio e sem entregar acesso direto ao Firestore.

Fluxo alvo:

`ChatGPT / Gemini / outro agente -> MCP Kyrubia -> autenticação e escopos -> Camada Oficial de Ações -> Kyrub`

O MCP é uma porta adicional para as capacidades do Kyrub. A Kyrubia interna e o modo manual continuam existindo.

## Fases

### 3.9.1 — Contrato público de capacidades

- [x] separar ferramentas MCP das ações internas;
- [x] marcar leitura como `readOnlyHint`;
- [x] limitar parâmetros e quantidade de resultados;
- [x] impedir qualquer escrita no primeiro contrato.

### 3.9.2 — Servidor MCP Streamable HTTP

- [x] endpoint `/api/mcp`;
- [x] JSON-RPC 2.0;
- [x] `initialize`, `ping`, `tools/list` e `tools/call`;
- [x] servidor stateless, adequado a funções serverless;
- [x] feature flag `KYRUB_MCP_ENABLED` com fail-closed.

### 3.9.3 — Autenticação e escopos

- [x] abstração de principal autenticado;
- [x] modo de desenvolvimento por Firebase ID token, desligado por padrão;
- [ ] servidor OAuth 2.1/OIDC para conexão persistente do ChatGPT;
- [ ] refresh token e revogação;
- [ ] consentimento por escopo (`store.read`, `products.read`, `inventory.read`, `orders.read`);
- [ ] tela de conexões ativas e revogação pelo usuário.

O modo Firebase existe apenas para desenvolvimento controlado e para clientes que permitam enviar cabeçalhos próprios. Não deve ser tratado como autenticação final do produto.

### 3.9.4 — Ferramentas read-only

Implementadas:

- `kyrub_get_store`;
- `kyrub_list_products`;
- `kyrub_get_inventory`;
- `kyrub_list_pending_orders`.

As leituras são feitas no servidor e sempre escopadas ao `uid` autenticado.

### 3.9.5 — Escritas seguras

- [x] decisão arquitetural: nenhuma escrita direta pelo MCP;
- [ ] adaptar propostas externas para a Camada Oficial de Ações;
- [ ] confirmação/policy engine conforme risco;
- [ ] recibo autoritativo e idempotência;
- [ ] liberar inicialmente `create_note` e `create_task`;
- [ ] só depois liberar estoque/produtos.

### 3.9.6 — “Conecte sua IA”

- [ ] módulo no Kyrub com ChatGPT, Gemini e “outro MCP”;
- [ ] estado: não conectado / conectado / expirado / revogado;
- [ ] instruções específicas por fornecedor;
- [ ] botão de revogação;
- [ ] telemetria sem armazenar prompts do fornecedor externo por padrão.

## Segurança

1. `KYRUB_MCP_ENABLED` deve ser falso por padrão.
2. Sem autenticação válida, nenhuma ferramenta é listada ou executada.
3. O servidor nunca aceita `uid`, `tenantId` ou caminho Firestore fornecido pelo agente; o tenant deriva da credencial.
4. Ferramentas de escrita não entram no MCP até reutilizarem policy engine, confirmação e recibos oficiais do Kyrub.
5. Dados retornados são mínimos e limitados.

## Compatibilidade de fornecedores

O contrato usa Streamable HTTP. Gemini Interactions permite cabeçalhos HTTP no MCP remoto, o que possibilita testes de desenvolvimento com bearer token. Para uma integração persistente no ChatGPT, a meta é OAuth com refresh token.

## Gate para homologação

Antes de habilitar o endpoint no Preview fixo:

- TypeScript verde;
- testes de contrato MCP verdes;
- revisão de paths Firestore;
- confirmação de que as flags permanecem desligadas no ambiente;
- OAuth permanece pendente e deve ser explicitamente marcado como tal na UI.
