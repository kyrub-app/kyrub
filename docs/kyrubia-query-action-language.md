# Kyrubia Query/Action Language

## Problema

A Kyrubia não pode crescer como uma coleção de caminhos específicos por frase, como `list_products_without_images`, `list_products_without_description`, `list_expensive_products` e assim por diante.

O vocabulário humano é aberto; o domínio do Kyrub, porém, possui um conjunto finito de entidades, campos e operações. A arquitetura deve concentrar a determinismo no domínio, não em frases literais.

## Princípio

> IA interpreta. Kyrub planeja, revalida e executa.

A unidade interna não é a frase do usuário. É um plano estruturado.

Exemplo:

```text
"Mostre os 3 produtos mais caros sem imagem e com estoque de até 10"

↓

entity: product
filters:
  - hasImage eq false
  - stock lte 10
sort:
  - price desc
limit: 3
```

A frase pode mudar. O plano continua usando o mesmo conjunto pequeno de operadores.

## Primeira entidade: product

A primeira versão introduz `KyrubiaProductQuery` com:

- filtros combináveis;
- ordenação;
- limite de resultados;
- escopo opcional por IDs já exibidos em um turno anterior;
- revalidação desses IDs contra o snapshot atual antes da leitura.

Campos suportados nesta fundação:

- `name`;
- `category`;
- `price`;
- `stock`;
- `isService`;
- `hasDescription`;
- `hasImage`.

Operadores suportados:

- `eq` / `neq`;
- `contains` para texto;
- `lt` / `lte` / `gt` / `gte` para números.

## Composição

Uma consulta não precisa ganhar uma nova tool para cada destino.

```text
query(products, hasImage = false)
       ↓
create_note(resultado)
```

Por isso:

- `Quais produtos estão sem imagem?`
- `Crie uma nota com os produtos sem imagem.`
- `Mostre os 2 mais caros sem imagem.`
- `Liste os produtos sem imagem e com estoque de até 10.`

reutilizam o mesmo executor de consulta.

## Compatibilidade

Os nomes históricos `list_products` e `list_low_stock_products` permanecem temporariamente como aliases de capability/telemetria para evitar regressões durante a migração.

Eles não precisam manter implementações separadas: o objetivo é que ambos sejam produzidos a partir do mesmo plano e executados pelo mesmo mecanismo.

## Deterministic fallback

A Kyrubia mantém um compilador local pequeno para construções operacionais comuns. Ele existe para resiliência quando o provedor generativo está indisponível ou em quota, não para tentar reproduzir toda a linguagem natural com regex.

O compilador local reconhece operadores do domínio e produz a mesma estrutura utilizada pelo executor. Novas combinações de filtros não exigem novos executores.

## Caminho generativo

A próxima integração desta mesma fundação é expor uma primitiva genérica `query_products` ao modelo. O modelo poderá traduzir linguagem mais aberta para a estrutura permitida, mas não executará consultas diretamente e não poderá inventar campos ou operadores fora do schema.

```text
usuário
  ↓
interpretação (LLM ou fallback local)
  ↓
KyrubiaProductQuery
  ↓
executor determinístico sobre dados atuais do Kyrub
  ↓
resultado estruturado
  ↓
resposta ou composição com ação
```

Mesmo no caminho generativo, a verdade operacional continua vindo do Kyrub.

## Relação com a Safe Execution Foundation

Consultas são leitura e não concedem autorização.

Quando uma composição termina em mutação, como `create_note`, a etapa de escrita continua atravessando a fundação da PR #150:

```text
query
  ↓
resultado
  ↓
proposta de ação
  ↓
confirmação quando exigida
  ↓
Policy Engine
  ↓
Execution Envelope
  ↓
executor oficial
```

Memória e listas anteriores fornecem contexto. Elas nunca substituem autorização nem a revalidação do estado atual.

## Critério de evolução

Adicionar uma nova tool específica só é justificável quando existe uma nova capacidade de domínio ou semântica de segurança diferente.

Adicionar apenas um novo filtro, ordenação ou combinação de critérios não deve criar uma nova tool.

A mesma estratégia poderá depois ser aplicada a outras entidades:

- `query_orders`;
- `query_customers`;
- `query_notes`;
- `query_transactions`.

O objetivo é manter poucas primitivas expressivas, em vez de centenas de caminhos determinados por frase.
