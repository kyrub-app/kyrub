# Development Handoff — Kyrub

> Documento operacional para reiniciar o desenvolvimento em outro chat, agente ou sessão. Deve ser atualizado quando um marco técnico muda. Não substitui a leitura do código/PR real.

## Como retomar em uma nova sessão

Comando recomendado:

> **Leia `docs/PRODUCT_CONSTITUTION.md`, `docs/PRODUCT_ROADMAP.md`, `docs/DEVELOPMENT_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/KYRUBIA.md` e os PRs abertos relevantes do repositório `kyrub-app/kyrub`. Confirme o estado real do código e continue do próximo gate sem fazer merge sem minha autorização.**

## Estado da linha principal

- Repositório: `kyrub-app/kyrub`
- Branch principal: `main`
- `main` atual nesta atualização: `2178c2b084b541c2612ff7a158faed1996cc1e99`
- PR #151 foi mergeada e estabeleceu Query/Action Language quota-first da Kyrubia.
- PR #137 já está mergeada e estabeleceu **Comunidades + Debates multiusuário** no Firebase.

## Mudança estratégica de 2026-08-10

O desenvolvimento **não deve continuar ampliando a Kyrubia frase por frase** como prioridade imediata.

A sequência agora é:

1. criar fonte humana/canônica de Conhecimento Oficial;
2. criar observabilidade semântica do uso do app;
3. validar recuperação determinística das fontes;
4. só depois conectar a Kyrubia como leitora dessas fontes;
5. manter execução segura/Policy Engine para qualquer ação;
6. usar IA generativa principalmente para interpretação/julgamento que realmente exija raciocínio.

Princípio:

> **A Kyrubia não precisa ter o Kyrub inteiro decorado. Ela precisa saber onde está a verdade, enxergar o que está acontecendo e ter permissão segura para agir.**

## Comunidades já existem — não reconstruir

A PR #137 entregou:

- comunidades compartilhadas entre usuários;
- membros ligados ao Firebase Auth;
- mural compartilhado;
- Debates;
- comentários em tempo real;
- moderação;
- capa no Firebase Storage;
- regras/testes de Firestore e Storage;
- migração assistida do protótipo local.

Arquivos centrais existentes:

- `src/utils/communityCloud.ts`;
- `src/components/ProfileCommunitiesCloudBridge.tsx`;
- `src/components/ProfilePublishingDestinationsCloudBridge.tsx`;
- `src/hooks/useCommunityDirectory.ts`;
- `firestore.communities.fragment.rules`;
- `firestore.community-debate-comment-query.fragment.rules`;
- `tests/community-cloud-contract.test.ts`.

A aba **Avisos** existe visualmente, mas ainda é placeholder.

### Convenção inicial para FAQ manual

Para não criar nova coleção/regras antes da hora, a primeira fundação usa **Debates criados manualmente pelo perfil oficial** como artigos de conhecimento:

- título = assunto/pergunta;
- conteúdo = explicação oficial;
- `status: open` = vigente;
- `status: closed` = retirado;
- comentários não fazem parte do conhecimento oficial;
- Debates de membros não são conhecimento oficial.

A aba Avisos pode virar um editor/leitor dedicado depois, mantendo o mesmo contrato de conhecimento.

## PR #154 — prioridade técnica atual

- PR: **#154 — `feat: establish official community knowledge foundation`**
- URL: `https://github.com/kyrub-app/kyrub/pull/154`
- Branch: `feat/official-community-knowledge-foundation`
- Base: `main`
- Head validado nesta atualização: `4b630ce2aefd8000ed008cf26ec0ed51ee21f46c`
- Estado: **Draft, aberta, não mergeada**
- Regra: não fazer merge sem autorização explícita do proprietário.

### Escopo da primeira fundação

A PR #154 introduz:

- `shared/kyrubKnowledge.ts` — contrato canônico de conhecimento;
- `shared/kyrubKnowledgeSearch.ts` — busca lexical/determinística;
- `src/knowledge/officialCommunityKnowledge.ts` — leitor de Debates oficiais;
- `shared/kyrubActivityEvents.ts` — contrato de eventos semânticos;
- `src/observability/kyrubActivityLog.ts` — buffer local limitado/minimizado;
- `src/components/OfficialKnowledgeSetupBridge.tsx` — diagnóstico explícito das âncoras e prova de recuperação;
- testes de contrato/unidade;
- `docs/kyrub-knowledge-observability-foundation.md`.

### Âncoras de confiança

A leitura de conhecimento oficial é desabilitada até o deployment configurar:

- `VITE_KYRUB_OFFICIAL_PROFILE_UID`;
- `VITE_KYRUB_OFFICIAL_COMMUNITY_IDS`.

Esses IDs são públicos, não secrets.

O leitor deve verificar simultaneamente:

1. comunidade configurada existe;
2. `ownerId` da comunidade == perfil oficial configurado;
3. comunidade é pública/moderada;
4. Debate está `open`;
5. `authorId` do Debate == perfil oficial configurado.

Não introduzir `isOfficial: true` gravável pelo cliente como fonte de autoridade.

### Diagnóstico de configuração

O Preview pode abrir `?officialKnowledgeSetup=1`.

Esse modo:

- só aparece quando solicitado explicitamente na URL;
- lista apenas comunidades pertencentes ao perfil autenticado;
- mostra `communityId` + UID do proprietário candidato;
- usa o próprio `readOfficialCommunityKnowledge` para testar a comunidade candidata;
- mostra os Debates elegíveis como prova de recuperação;
- não torna nenhuma comunidade oficial por si só;
- não conecta a Kyrubia à fonte.

### Eventos semânticos

A fundação distingue:

- navegação/contexto;
- tentativa/intenção;
- resultado confirmado.

Eventos observados no cliente são `context_only`.
Somente fonte `server_confirmed` pode produzir `confirmed_result`.

Um clique não é prova de sucesso.

O buffer inicial é local e bloqueia metadados com conversa/PII/secrets, incluindo `content`, `message`, `text`, `prompt`, `response`, `email`, `phone`, `address`, tokens, secrets e senhas.

### Fora do escopo da #154 inicial

- Kyrubia lendo a base;
- Kyrubia criando/alterando conteúdo oficial;
- ingestão de log técnico bruto;
- nova coleção Firestore de Avisos/FAQ;
- deploy de regras Firebase;
- autoaprendizado silencioso;
- merge sem teste/aprovação.

## Estado humano da base oficial

O proprietário criou manualmente a comunidade:

- **Manual KYRUB**

Primeiro artigo/FAQ publicado manualmente como Debate vigente:

- **O que é o Kyrub?**

A criação manual foi intencional: a Kyrubia ainda não cria nem edita conhecimento oficial.

## Próximo gate da #154

O head `4b630ce...` passou Application Build, Validate Kyrub, Store Security e Identity Security.

Próximo teste humano:

1. abrir o Preview estável com `?officialKnowledgeSetup=1`;
2. confirmar que **Manual KYRUB** aparece como comunidade pertencente ao perfil autenticado;
3. selecionar `Manual KYRUB`;
4. confirmar que **O que é o Kyrub?** aparece como `Conhecimento elegível`;
5. copiar os dois identificadores mostrados pelo diagnóstico;
6. configurar UID/ID no Preview sob controle do deployment;
7. revalidar a recuperação determinística usando as âncoras configuradas;
8. depois publicar novos FAQs reais manualmente e testar busca lexical;
9. instrumentar poucas jornadas reais com eventos semânticos;
10. somente depois planejar o adaptador que entrega conhecimento + estado + contexto para a Kyrubia.

Se alguma etapa exigir mudar regras Firebase de produção, parar no gate e pedir autorização específica antes do deploy.

## PR #152 — preservada e temporariamente secundária

- PR: **#152 — `feat: let Kyrubia activate stores and create products`**
- URL: `https://github.com/kyrub-app/kyrub/pull/152`
- Branch: `feat/kyrubia-store-activation-product-creation`
- Head atual confirmado: `e9084bb970dc54b40a71278ce47be4266e0f6a51`
- Estado: **Draft, aberta, não mergeada**
- Não continuar adicionando rotas/regex conversacionais assunto por assunto enquanto a nova base de conhecimento não estiver estabelecida.

### O que a #152 já provou

- ativação segura de Loja Kyrub sem publicação automática;
- criação segura de produto;
- grants server-side escopados/expiráveis;
- confirmação própria de produto;
- enforcement de capacidade no servidor;
- invalidação de cache ERP após criação pela Kyrubia;
- Free 5/5 faz handoff para **Pro**, não Business;
- catálogo comercial V1 determinístico de Free/Pro/Business;
- próximos passos/chips com `authorization: intent_only`;
- continuação genérica “Então explica” funciona quando há uma única oferta principal;
- ambiguidade entre várias ofertas é mantida determinística e pede escolha.

### Testes humanos relevantes da #152

Fluxo testado:

- “Cadastre mais 2 produtos na minha loja” → bloqueou corretamente em 5/5 Free;
- recomendou Pro e disse que Business era desnecessário;
- “O q ele libera?” → respondeu fatos V1 do Pro sem Gemini;
- “Então explica” após múltiplas opções → pediu escolha sem Gemini;
- “Explica o que o plano pró libera” → determinístico;
- “O q falta pra minha loja ser publicada?” → caiu no Gemini e encontrou limite do provedor.

Esse último teste foi o gatilho para a mudança de estratégia: em vez de codificar cada novo FAQ diretamente no roteador da Kyrubia, criar uma fonte oficial que explique o produto e combinar essa fonte com estado real do usuário.

### Publicação da Loja — diagnóstico útil preservado

O fluxo manual atual em `StoreConfigModal.tsx`:

- publicação é separada de `status: open/closed`;
- `publicationStatus` usa `published/paused`;
- o botão de publicar exige nome da loja;
- descrição, endereço, logo e banner não são hoje requisitos obrigatórios de publicação;
- o snapshot ERP atual da Kyrubia ainda não carrega `publicationStatus`.

Não inventar requisitos adicionais de publicação.

## Multi-produto da #152

O problema humano original foi “Cadastre mais 2 produtos” ser tratado como um único produto com campos concatenados.

A implementação sequencial foi adicionada tecnicamente na #152:

- quantidade/progresso local;
- um produto por vez;
- confirmação individual;
- criação individual por `create_product`, nunca batch fictício;
- avanço para o próximo item após sucesso;
- rechecagem de capacidade;
- proteção contra nomes/preços/estoques combinados.

A validação humana completa com dois novos itens ainda exige um estado controlado com capacidade suficiente; não excluir produtos reais apenas para fabricar esse cenário sem autorização.

## Preview estável

Alias estável:

`https://kyrub-git-feat-profile-react-rebuild-kyrubapp-6434s-projects.vercel.app/`

Branch de Preview estável: `feat/profile-react-rebuild`.

Estado nesta atualização:

- branch estável foi apontada para `4b630ce2aefd8000ed008cf26ec0ed51ee21f46c`;
- deployment Vercel `dpl_2bQGWGLEXh46DFZQAeyjZFK9JuYA` ficou **READY**;
- alias estável está associado a esse deployment;
- este Preview está dedicado ao gate atual da #154.

Estratégia intencional: reutilizar um alias para evitar cadastrar um domínio Firebase por deployment efêmero.

Antes de pedir teste humano:

1. confirmar commit realmente servido pelo alias;
2. confirmar CI/build;
3. atualizar o Preview uma única vez com mudança agrupada;
4. só então avisar “pronto para testar”.

## Segurança que não pode regredir

- nunca solicitar/expor secrets/private keys;
- `ActionEvents` usa proveniência conservadora por padrão;
- grants são ator-específicos, escopados e expiram;
- ativação de loja ≠ publicação/abertura;
- contexto, botão ou evento observado ≠ autoridade;
- browser não é autoridade final de plano/permissão;
- servidor revalida limites e UID alvo;
- ações destrutivas/financeiras/públicas exigem controles próprios;
- modo manual permanece;
- conhecimento oficial não pode ser autoalterado pela IA;
- comentários de comunidade não viram regra de produto;
- eventos não devem copiar conteúdo privado desnecessário.

## Documentação canônica

Antes de grande alteração, ler:

- `docs/PRODUCT_CONSTITUTION.md` — invariantes e direção;
- `docs/PRODUCT_ROADMAP.md` — prioridades/ideias consolidadas;
- `docs/DEVELOPMENT_HANDOFF.md` — estado técnico atual;
- `docs/ARCHITECTURE.md`;
- `docs/KYRUBIA.md`;
- `docs/AI_USAGE_GOVERNANCE.md`;
- `docs/PRIVACY_SECURITY_READINESS.md`;
- `docs/RELEASE_CHECKLIST.md`;
- `docs/kyrub-knowledge-observability-foundation.md` enquanto a #154 estiver em desenvolvimento.

Atualizar os documentos automaticamente quando estratégia, arquitetura, prioridade ou próximo gate mudar materialmente. O proprietário não deve precisar lembrar de pedir essa atualização.

## Protocolo de notificação ao proprietário

### “Pronto para teste humano”

Informar:

- o que mudou;
- Preview/ambiente correto;
- roteiro curto/exato;
- resultado esperado;
- o que não deve ser feito com dados reais.

### “Teste humano aprovado”

Registrar evidência observada e invariantes confirmados.

### “Pronto para merge”

Somente depois de CI + testes aplicáveis + validação humana. Pedir autorização explícita.

### Merge

Nunca inferir autorização de elogio, “show”, “ótimo” ou aprovação conceitual. Merge exige autorização inequívoca como **“Autorizado”** ou **“pode fazer o merge”**.

## Última atualização

Atualizado em 2026-08-10 após criação manual da comunidade **Manual KYRUB**, publicação do primeiro artigo **O que é o Kyrub?**, inclusão do diagnóstico de âncoras na #154 e disponibilização do Preview estável para validação humana.
