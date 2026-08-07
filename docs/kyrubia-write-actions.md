# Kyrubia — autorização de ações de escrita no ERP

## Objetivo

Esta etapa prepara a fronteira de segurança para futuras mutações operacionais da Kyrubia sem liberar ainda criação de produtos, alteração de estoque ou mudança de dados da loja.

A regra é simples: contexto de conversa nunca é prova de autorização. Antes de qualquer escrita, o Kyrub precisa revalidar a loja canônica, o usuário autenticado, o vínculo do usuário com a loja, o status do vínculo e a permissão exigida pela ação.

## Ações planejadas

O protocolo passa a registrar política explícita para:

- `create_task` — baixo risco, confirmação obrigatória;
- `create_product_draft` — risco médio, confirmação obrigatória, `products.write`;
- `update_product_draft` — risco médio, confirmação obrigatória, `products.write`;
- `adjust_inventory` — alto risco, confirmação obrigatória, `products.write`;
- `update_store` — risco médio, confirmação obrigatória, `store.update`;
- `analyze_catalog` — leitura, sem mutação;
- `import_catalog_draft` — risco médio, confirmação obrigatória, `products.write`.

Essas ações continuam planejadas e não são anunciadas pela Kyrubia como executáveis até que cada serviço oficial, confirmação de interface e teste de segurança estejam concluídos.

## Fronteira de autorização

`resolveAuthorizedStoreAction()` recebe:

- usuário Firebase autenticado;
- `storeId` canônico explícito;
- permissão necessária.

A função lê novamente o documento `stores/{storeId}`. Se o usuário for o proprietário, usa o papel `owner`. Caso contrário, lê `stores/{storeId}/members/{uid}` e exige vínculo `active`.

Depois disso, a permissão é calculada pela matriz oficial do ERP em `storeSecurity.ts`.

Convites pendentes, usuários suspensos, removidos, externos ou papéis sem a permissão requerida são recusados antes de qualquer mutação.

## Próxima etapa

A primeira mutação comercial deve ser `create_product_draft`, mas somente depois de definir um armazenamento de rascunho que seja compatível com o catálogo canônico e com a interface atual. A ação não deve publicar produto automaticamente nem depender do snapshot enviado à IA.

A sequência prevista é:

1. preparar proposta estruturada;
2. resolver loja alvo;
3. revalidar permissão `products.write`;
4. mostrar antes/depois e campos faltantes;
5. confirmar;
6. executar serviço oficial idempotente;
7. registrar auditoria;
8. manter o produto como rascunho até publicação explícita.
