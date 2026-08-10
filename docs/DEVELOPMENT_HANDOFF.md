# Development Handoff — Kyrub

> Documento operacional para reiniciar o desenvolvimento em outro chat, agente ou sessão. Deve ser atualizado quando um marco técnico muda. Não substitui a leitura do código/PR real.

## Como retomar em uma nova sessão

Comando recomendado:

> **Leia `docs/PRODUCT_CONSTITUTION.md`, `docs/PRODUCT_ROADMAP.md`, `docs/DEVELOPMENT_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/KYRUBIA.md` e os PRs abertos relevantes do repositório `kyrub-app/kyrub`. Confirme o estado real do código e continue do próximo gate sem fazer merge sem minha autorização.**

## Estado da linha principal

- Repositório: `kyrub-app/kyrub`
- Branch principal: `main`
- `main` atual na criação deste documento: `2178c2b084b541c2612ff7a158faed1996cc1e99`
- PR #151 foi concluída/mergeada e estabeleceu a Query/Action Language quota-first da Kyrubia.

## PR ativa principal

- PR: **#152 — `feat: let Kyrubia activate stores and create products`**
- URL: `https://github.com/kyrub-app/kyrub/pull/152`
- Base: `main`
- Branch: `feat/kyrubia-store-activation-product-creation`
- Head validado ao criar este handoff: `e55760ec8c3bb357a1bb032b0292572eb572b87b`
- Estado: **Draft, aberta, não mergeada**
- Regra: **não fazer merge sem autorização explícita do proprietário**.

## Objetivo da #152

Permitir que a Kyrubia:

1. detecte objetivo de cadastrar produto/serviço;
2. se necessário, peça autorização para **ATIVAR** a Loja Kyrub;
3. colete dados mínimos da loja em passos curtos;
4. grave perfil da loja sob grant server-side curto/escopado;
5. retome automaticamente o objetivo de produto;
6. colete apenas dados essenciais do item;
7. mostre confirmação final específica do produto;
8. execute criação pelo servidor com política, idempotência e recibo.

Ativar Loja Kyrub não significa automaticamente abrir operação nem publicar a loja no marketplace.

## Ações seguras introduzidas na #152

- `start_store_activation`
- `update_store_profile`
- `create_product`
- `create_note` permanece existente

Princípios:

- servidor define blast radius/metadados;
- browser não grava diretamente essas ações críticas;
- grant de ativação é temporário, vinculado ao ator e ao escopo;
- criação de produto possui confirmação própria;
- contexto local do workflow não é autoridade;
- loja canônica permanece pausada até ação explícita de publicação/abertura apropriada.

## Capacidade de produtos / plano

Estado implementado em #152:

- servidor possui enforcement de capacidade;
- Free atualmente bloqueia acima de 5 produtos;
- cliente possui preflight conversacional de capacidade;
- contexto ERP é invalidado após `create_product` para evitar contagem imediatamente obsoleta;
- servidor continua autoridade final contra corrida/bypass.

### Decisão comercial nova ainda a aplicar

A resposta atual da #152 pode oferecer **Business** quando o Free chega a 5 itens. Isso está obsoleto perante a Constituição de Produto.

Novo fluxo esperado:

- Free (5) → oferecer **Pro**;
- Pro → Business somente quando uma capacidade Business realmente for necessária;
- Kyrubia deve recomendar o menor plano suficiente.

## Problema humano encontrado: múltiplos produtos

Teste humano realizado com intenção “Cadastre mais 2 produtos na minha loja”.

Comportamento observado:

- o fluxo entrou como produto único;
- entradas combinadas como “Teste2 e teste 3”, “R$14 e R$21” e “10 e 20” foram tratadas como campos de um único produto;
- depois, ao tentar criar outro item com a loja já em 5/5, o bloqueio comercial funcionou e nenhum sexto item foi criado.

### Diagnóstico e correção já realizada

Havia risco de snapshot de contagem do ERP ficar até 10s atrasado após criação via Kyrubia. A #152 centralizou invalidação do cache após execução válida de `create_product`.

**Não afirmar que existe force-read antes de toda intenção; o hardening implementado é invalidação após criação + enforcement server-side.**

## Próxima implementação técnica recomendada

**Criar workflow sequencial real para múltiplos produtos dentro da #152.**

Requisitos:

1. persistir quantidade solicitada e progresso apenas como estado conversacional local;
2. coletar um item por vez;
3. confirmação individual para cada produto;
4. depois de sucesso do Produto 1, avançar para coleta do Produto 2 em vez de limpar todo o workflow;
5. invalidar contexto ERP após cada criação;
6. reavaliar capacidade antes de continuar;
7. se capacidade acabar por concorrência/alteração externa, interromper e fazer handoff comercial correto;
8. nunca criar ação de “batch” fictícia: reutilizar `create_product` individualmente;
9. cancelamento precisa encerrar/ajustar o workflow de forma explícita;
10. testes de contrato para não concatenar nomes, preços ou estoques de itens diferentes.

## Human validation esperada após a próxima mudança

Quando houver capacidade para 2 itens (preferencialmente conta/ambiente descartável ou estado controlado):

1. enviar “Cadastre mais 2 produtos na minha loja”;
2. Kyrubia inicia Produto 1;
3. fornecer nome/preço/categoria/estoque do Produto 1;
4. confirmar Produto 1;
5. verificar um `/api/action-execute 200` e ausência de fallback `/api/kyrubia` para fluxo local suportado;
6. Kyrubia retoma automaticamente Produto 2;
7. fornecer e confirmar Produto 2;
8. verificar segundo `/api/action-execute 200`;
9. conferir dois produtos distintos na Loja Kyrub;
10. confirmar que nenhum campo foi combinado entre itens.

Não excluir produto real do proprietário nem resetar Loja Kyrub apenas para fabricar capacidade de teste sem autorização explícita.

## Preview estável

Estratégia intencional: utilizar um único alias de Preview para evitar adicionar um domínio Firebase novo a cada deployment.

Alias estável conhecido:

`https://kyrub-git-feat-profile-react-rebuild-kyrubapp-6434s-projects.vercel.app/`

A branch de Preview estável é `feat/profile-react-rebuild`.

### Situação conhecida na criação deste handoff

A Vercel atingiu `build-rate-limit` ao tentar reconstruir o alias estável com as alterações mais recentes da #152. O deployment da própria branch da #152 no head `e55760ec...` chegou a READY, mas o usuário não deve ser orientado a cadastrar domínios Firebase efêmeros apenas para testar.

Antes de pedir novo teste humano no alias estável:

1. consultar o deployment realmente servido pelo alias;
2. confirmar que o commit contém a mudança a testar;
3. se ainda bloqueado por rate limit, não disparar sequência de commits vazios;
4. quando liberar, gerar/atualizar **um único** build agrupado;
5. só então notificar “pronto para testar”.

## Política de builds durante desenvolvimento

- agrupar pequenas alterações relacionadas antes de enviar;
- evitar commits vazios repetidos apenas para forçar Vercel;
- CI verde não substitui validação humana de fluxo;
- Preview READY não significa automaticamente que o alias estável aponta para aquele deployment;
- confirmar alias/commit antes de solicitar teste.

## Segurança que não pode regredir

- nunca solicitar ou expor secrets/private keys;
- `ActionEvents` deve usar proveniência conservadora por padrão; conteúdo generativo não vira `user_intent` automaticamente;
- grants server-side são ator-específicos, escopados e expiram;
- store activation e product creation têm autorizações distintas;
- ativação da loja ≠ publicação/abertura no marketplace;
- browser não é autoridade de plano/permissão;
- servidor revalida limites e alvo do UID autenticado;
- ações destrutivas/financeiras/públicas exigem controles próprios;
- modo manual permanece disponível.

## Generative fallback — atenção

A rota generativa/fallback ainda pode possuir textos/capacidades anteriores à #152. O fluxo operacional de produto atual foi desenhado quota-first/local antes do Gemini.

Não afirmar que o fallback generativo completo de ativação/criação de produtos já está implementado até o código correspondente ser atualizado e testado.

## Documentação canônica

Antes de qualquer grande alteração, ler:

- `docs/PRODUCT_CONSTITUTION.md` — invariantes e direção;
- `docs/PRODUCT_ROADMAP.md` — prioridades/ideias consolidadas;
- `docs/DEVELOPMENT_HANDOFF.md` — estado técnico atual;
- `docs/ARCHITECTURE.md` — arquitetura existente;
- `docs/KYRUBIA.md` — identidade e Lente de Oportunidades;
- `docs/AI_USAGE_GOVERNANCE.md` — governança/custos de IA;
- `docs/PRIVACY_SECURITY_READINESS.md` — privacidade e prontidão;
- `docs/RELEASE_CHECKLIST.md` — liberação.

## Protocolo de notificação ao proprietário

O responsável técnico/assistente deve notificar o proprietário quando um gate concreto for atingido, não a cada microalteração.

### “Pronto para teste humano”

Informar:

- o que mudou;
- qual Preview/ambiente está correto;
- roteiro curto e exato de teste;
- resultado esperado;
- o que **não** deve ser feito com dados reais.

### “Teste humano aprovado”

Registrar evidência observada e quais invariantes foram confirmados.

### “Pronto para merge”

Somente depois de CI + testes aplicáveis + validação humana. Solicitar autorização explícita.

### Merge

Nunca inferir autorização a partir de elogio, “show”, “ótimo” ou aprovação de uma ideia. Merge precisa de autorização inequívoca, como **“Autorizado”**, **“pode fazer o merge”** ou equivalente explícito.

## Última atualização

Criado em 2026-08-10 durante a PR #152. Atualizar este documento sempre que o próximo gate técnico mudar de forma material.