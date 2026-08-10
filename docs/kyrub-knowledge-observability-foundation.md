# Fundação de Conhecimento Oficial e Observabilidade

Esta etapa muda a ordem de evolução da Kyrubia: antes de ampliar respostas conversacionais específicas, o Kyrub passa a construir fontes explícitas de verdade e contexto observável.

## 1. Conhecimento oficial primeiro

As Comunidades multiusuário já existem no Kyrub. Nesta fase inicial, **Debates criados manualmente pelo perfil oficial dentro de Comunidades Oficiais Kyrub** podem servir como artigos/FAQ canônicos.

Convenção provisória:

- título do Debate = pergunta/assunto oficial;
- conteúdo do Debate = explicação oficial;
- `status: open` = referência vigente;
- `status: closed` = referência retirada/arquivada;
- comentários de membros nunca fazem parte da verdade oficial;
- debates criados por outros participantes nunca viram conhecimento oficial apenas por estarem dentro de uma comunidade oficial.

Essa convenção permite começar com a infraestrutura atual sem criar uma coleção nova ou alterar regras do Firestore nesta primeira etapa. A aba `Avisos` poderá ganhar uma experiência editorial própria depois, mantendo o mesmo contrato de conhecimento.

## 2. Âncoras de confiança

O cliente não grava `isOfficial: true`.

A configuração preferida continua sendo pelo deployment:

- `VITE_KYRUB_OFFICIAL_PROFILE_UID`;
- `VITE_KYRUB_OFFICIAL_COMMUNITY_IDS` (lista separada por vírgulas).

Como o conector operacional atual não permite escrever Environment Variables da Vercel, a PR #154 possui temporariamente um fallback versionado em `src/knowledge/officialKnowledgeAnchors.ts`. Esses IDs são públicos, não secrets, e o `env` continua tendo precedência quando existir. Como a PR está em Draft, esse fallback não alcança `main`/produção sem autorização explícita de merge.

Âncoras humanas validadas nesta etapa:

- perfil oficial candidato: `8DK3cZ42hPVp8NCjzZEPpduV5rF2`;
- comunidade `Manual KYRUB`: `fIemZnVFXZsagd6EA6sN`.

O leitor revalida que:

1. a comunidade configurada existe;
2. o `ownerId` corresponde ao perfil oficial configurado;
3. a comunidade é pública ou moderada;
4. o Debate está vigente (`open`);
5. o `authorId` do Debate é o próprio perfil oficial.

A simples presença desses IDs no bundle não concede autoridade a outro usuário, porque a confiança depende das revalidações acima.

### Diagnóstico explícito de configuração

O Preview pode abrir o modo `?officialKnowledgeSetup=1`. Esse modo é visível apenas quando solicitado pela URL e:

- lista apenas comunidades que o perfil autenticado realmente possui;
- mostra `communityId` e o UID do proprietário candidato;
- não altera a oficialidade de nenhum documento;
- testa a comunidade candidata usando o mesmo `readOfficialCommunityKnowledge` que será usado pela fundação;
- exibe os títulos dos Debates elegíveis como prova de recuperação;
- permite copiar as duas âncoras para configuração controlada.

Esse diagnóstico não é uma credencial administrativa e não concede autoridade ao perfil.

## 3. Kyrubia ainda não lê essa fonte nesta PR

Esta fundação deliberadamente **não conecta** Comunidades à Kyrubia ainda.

Ordem de trabalho:

1. criar conteúdos oficiais manualmente;
2. validar confiança e recuperação determinística;
3. criar eventos semânticos de uso;
4. somente depois conectar a Kyrubia como leitora;
5. a Kyrubia nunca deve reescrever silenciosamente conhecimento oficial.

A futura composição desejada é:

- funcionamento do produto → conhecimento oficial;
- estado real do usuário → banco/ERP/runtime;
- navegação e ações recentes → eventos semânticos;
- execução → Policy Engine e servidor;
- julgamento aberto → IA generativa quando necessário.

## 4. Eventos semânticos, não log técnico bruto

`shared/kyrubActivityEvents.ts` define um contrato pequeno para eventos que descrevem significado operacional.

Exemplos:

- `navigation.screen_viewed`;
- `navigation.community_opened`;
- `interaction.action_attempted`;
- `result.action_succeeded`;
- `result.action_failed`.

Um clique ou tentativa observada no cliente possui autoridade `context_only`.

Somente resultado proveniente de fonte `server_confirmed` recebe autoridade `confirmed_result`.

Portanto:

> clicar em “Publicar” não significa que a loja foi publicada; o resultado confirmado pelo sistema é que pode afirmar isso.

## 5. Minimização de dados

O buffer inicial é local, limitado e não é enviado à Kyrubia nesta etapa.

O logger bloqueia chaves de metadados que possam carregar conversa ou dados pessoais, como `content`, `message`, `text`, `prompt`, `response`, `email`, `phone`, `address`, tokens, secrets e senhas.

Eventos devem referenciar IDs e estados sem copiar conteúdo privado.

## 6. Estado humano desta etapa

A primeira comunidade manual escolhida para a base oficial é **Manual KYRUB**.

Primeiro artigo publicado manualmente:

- `O que é o Kyrub?`

O diagnóstico humano recuperou as âncoras reais do proprietário e da comunidade, que agora estão configuradas na #154 com fallback versionado e precedência futura de `env`.

## 7. Próxima etapa

Depois de CI/build do head com as âncoras:

- atualizar o Preview estável;
- validar que o leitor inicia como fonte oficial configurada e recupera `O que é o Kyrub?` sem precisar selecionar manualmente a comunidade candidata;
- publicar mais FAQs reais manualmente;
- testar busca lexical com perguntas diferentes do título literal;
- instrumentar algumas jornadas do app com eventos semânticos;
- só então criar o adaptador que entrega conhecimento + estado + contexto recente para a Kyrubia.
