# Kyrubia — leitura segura do ERP

## Objetivo desta etapa

Dar à Kyrubia acesso de leitura a dados reais do ERP antes de ampliar as mutações. A Kyrubia deixa de responder perguntas operacionais por suposição e passa a consultar um recorte autenticado da loja do usuário.

Nesta etapa, a única mutação continua sendo `create_note`, sempre com confirmação humana.

## Ferramentas ativas

- `read_store_summary`
- `list_products`
- `list_low_stock_products`
- `list_pending_orders`

As quatro ferramentas são declaradas como `mode: read`, risco baixo e sem confirmação porque não alteram dados.

## Fluxo

1. o usuário autenticado envia uma mensagem à Kyrubia;
2. o cliente Kyrub lê, pelas regras normais do Firebase, somente o ERP acessível àquela sessão;
3. o cliente monta um snapshot mínimo e limitado;
4. o servidor valida novamente o ID token Firebase;
5. o Gemini escolhe uma ferramenta de leitura quando a resposta depende de dados operacionais;
6. o servidor executa a ferramenta somente contra o snapshot normalizado;
7. somente o recorte solicitado retorna ao Gemini para a resposta final.

O servidor da IA não ganha credenciais administrativas e não importa Firestore para executar essas leituras.

## Minimização de dados

O contexto enviado à IA contém apenas o necessário para perguntas operacionais.

Produtos:

- id;
- nome;
- categoria;
- preço;
- estoque;
- indicador de serviço;
- existência de descrição;
- existência de imagem.

Pedidos pendentes:

- id;
- status;
- status de pagamento;
- modalidade de atendimento;
- total;
- quantidade de itens;
- data de criação.

Nome, e-mail, endereço, observações e outros dados pessoais do comprador não fazem parte do resumo enviado ao Gemini.

## Limites desta primeira versão

- até 120 produtos no snapshot de uma solicitação;
- até 30 pedidos em andamento;
- ferramentas retornam no máximo 50 produtos ou 30 pedidos por chamada;
- cache local de leitura por poucos segundos para evitar consultas repetidas durante a mesma interação;
- indisponibilidade parcial vira `warning`, não dado inventado.

## Loja ativa e equipe

A primeira versão é deliberadamente voltada ao proprietário e aos caminhos legados que a aplicação principal ainda utiliza:

- loja privada: `users/{uid}/stores/{uid}`;
- catálogo: `tenants/{uid}.publicProducts`;
- pedidos: coleção operacional associada ao `uid` da loja legada.

A próxima evolução deve resolver explicitamente a loja ativa canônica e o papel do membro (`owner`, `manager`, `cashier`, `seller`, `production`) antes de liberar leituras ou escritas multi-loja.

## Regra de confiança

O snapshot é contexto de conversa, não autoridade.

Mesmo sendo produzido pelo cliente autenticado, ele nunca poderá ser usado como prova de permissão para uma mutação. Toda futura escrita no ERP deverá revalidar no serviço oficial:

- usuário;
- loja alvo;
- papel e permissão;
- estado atual do registro;
- confirmação exigida;
- chave de idempotência.

## Próximas etapas

1. validar as quatro leituras no preview com dados reais;
2. resolver loja ativa e permissões multiusuário;
3. adicionar `create_task` como mutação de baixo risco;
4. preparar `create_product_draft` sem publicação automática;
5. adicionar anexos multimodais à conversa;
6. implementar `analyze_catalog` e, depois, `import_catalog_draft`.
