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

A leitura de conhecimento só é habilitada quando o deployment configura:

- `VITE_KYRUB_OFFICIAL_PROFILE_UID`;
- `VITE_KYRUB_OFFICIAL_COMMUNITY_IDS` (lista separada por vírgulas).

O leitor revalida que:

1. a comunidade configurada existe;
2. o `ownerId` corresponde ao perfil oficial configurado;
3. a comunidade é pública ou moderada;
4. o Debate está vigente (`open`);
5. o `authorId` do Debate é o próprio perfil oficial.

Os IDs são identificadores públicos, não secrets. Mesmo assim, a configuração deve ser administrada pelo deployment do Kyrub, e não por dados arbitrários escritos pelo usuário.

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

## 6. Próxima etapa

Depois de validar esta fundação:

- escolher/criar o perfil oficial Kyrub;
- criar a primeira Comunidade Oficial manualmente;
- publicar de 3 a 5 FAQs reais como Debates;
- configurar os IDs no Preview;
- validar a recuperação determinística desses conteúdos;
- instrumentar algumas jornadas do app com eventos semânticos;
- só então criar o adaptador que entrega conhecimento + estado + contexto recente para a Kyrubia.
