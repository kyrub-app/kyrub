# Contrato de segurança das lojas Kyrub

## Decisões aprovadas

- Um usuário pode possuir várias lojas.
- Um usuário pode trabalhar em várias lojas.
- Cada loja possui um `storeId` próprio, independente do UID Google do proprietário.
- Cada loja possui um proprietário principal.
- O papel amplo de atendimento ao público é **Vendedor** (`seller`).
- O cliente só cria pedidos diretamente após autenticação Google.
- Cliente sem login é atendido por um funcionário autenticado no PDV.
- Vendedores podem registrar pagamentos presenciais ligados aos atendimentos.
- Gerentes podem convidar e suspender Caixa, Vendedor e Produção.
- Somente o proprietário pode criar, suspender ou remover Gerente.
- Gerente não altera o proprietário e não transfere a propriedade.

## Papéis

| Identificador | Nome exibido |
| --- | --- |
| `owner` | Proprietário |
| `manager` | Gerente |
| `cashier` | Caixa |
| `seller` | Vendedor |
| `production` | Produção |

## Limites de desconto

| Papel | Limite padrão |
| --- | ---: |
| Proprietário | Sem limite técnico; ainda sujeito à configuração da loja |
| Gerente | 20% |
| Caixa | 10% |
| Vendedor | 5% |
| Produção | 0% |

Todo desconto exige motivo. A loja poderá reduzir ou desativar os limites em uma etapa posterior, mas nunca ampliá-los acima do limite do papel sem uma decisão explícita de segurança.

## Cancelamentos

- Proprietário, Gerente e Caixa cancelam diretamente com motivo.
- Vendedor cancela diretamente somente antes do envio à produção.
- Depois do envio à produção, o Vendedor solicita cancelamento.
- Produção informa impossibilidade ou solicita cancelamento, sem executar estorno financeiro.
- Cancelamentos e solicitações devem gerar auditoria.

## Estrutura canônica

```text
/stores/{storeId}
/stores/{storeId}/members/{userId}
/stores/{storeId}/orders/{orderId}
/stores/{storeId}/payments/{paymentId}
/stores/{storeId}/cashSessions/{sessionId}
/stores/{storeId}/auditLogs/{logId}
```

O vínculo do usuário com a loja vive em `members/{userId}`. O papel não é global e pode variar entre lojas.

## Origem dos pedidos

### Pedido criado pelo cliente

```ts
{
  source: 'customer',
  buyerId: '<uid do cliente>',
  createdByUserId: '<uid do cliente>',
  createdByRole: 'customer'
}
```

### Pedido criado no PDV

```ts
{
  source: 'staff',
  buyerId: '<identificador interno do atendimento>',
  createdByUserId: '<uid do funcionário>',
  createdByRole: 'seller' // ou owner, manager, cashier
}
```

Não haverá escrita anônima direta no Firestore.

## Auditoria

Ações sensíveis devem gerar registros append-only:

```ts
{
  id,
  storeId,
  actorUserId,
  actorRole,
  action,
  entityType,
  entityId,
  reason,
  before,
  after,
  createdAt
}
```

Proprietário e Gerente leem auditoria. Registros não podem ser editados ou apagados pelo painel comum.

## Estratégia de migração

1. Validar o modelo canônico e as regras no emulador.
2. Criar lojas canônicas com IDs independentes.
3. Criar o proprietário como vínculo inicial de cada loja.
4. Implementar convites e seleção de loja ativa.
5. Adicionar gravação dupla para pedidos e pagamentos novos.
6. Comparar contagens, valores, itens, status e atores entre os caminhos.
7. Trocar as leituras para o caminho canônico.
8. Encerrar a gravação no caminho legado.
9. Bloquear `/artifacts` para gravações comerciais.
10. Remover a leitura legada somente após uma janela de verificação.

## Arquivos desta fundação

- `src/utils/storeSecurity.ts`: papéis, permissões, descontos e hierarquia.
- `src/utils/canonicalStoreData.ts`: adaptação explícita de pedidos legados.
- `firestore.store-security.rules`: regras canônicas isoladas, ainda não implantadas.
- `firebase.security.json`: configuração isolada do emulador.
- `tests/store-security.test.ts`: contrato de negócio.
- `tests/canonical-store-data.test.ts`: contrato da migração.
- `tests/firestore-store-security.test.ts`: testes de autorização no emulador.

## Execução dos testes

Os testes puros são executados pelo `prebuild`.

Os testes das regras exigem Firebase CLI e Java instalado:

```bash
npm run test:rules
```

O arquivo de regras canônicas não substitui `firestore.rules` nesta fase. Essa separação evita bloquear a aplicação antes da gravação dupla, migração e validação.
