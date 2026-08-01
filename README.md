# Kyrub

Kyrub é uma plataforma social, comercial e operacional para pessoas, profissionais e negócios. O aplicativo reúne perfil, conexões, lojas, produtos, pedidos, estoque, notas, checklists, oportunidades e uma agente inteligente chamada **Kyrubia**.

## Estado do produto

O repositório está em fase de **fechamento do MVP beta**. O núcleo funcional já existe e é protegido por testes de contrato, TypeScript, regras do Firestore e validações operacionais.

Recursos presentes no código incluem:

- autenticação com Google e diretório de usuários;
- loja privada por usuário e vitrine pública;
- catálogo, estoque, pedidos, caixa e operação de loja;
- notas, checklists, lembretes, compartilhamento e colaboração;
- conexões sociais, feed e mensagens privadas;
- painel administrativo separado em `admin.kyrub.com`;
- sincronização Firestore + cache local offline-first;
- Kyrubia com criação confirmada de notas e lente de oportunidades;
- integrações operacionais em estágios controlados, incluindo entregas e 99Food.

## Princípios do produto

1. Nenhum dado comercial fictício deve ser apresentado como dado real.
2. O modo manual permanece disponível mesmo quando a Kyrubia oferece o mesmo caminho.
3. Ações da inteligência artificial passam por revisão e confirmação do usuário.
4. Dados privados são isolados por usuário, loja e permissão.
5. Recursos ainda não conectados a um backend real devem ser identificados claramente como demonstração ou planejamento.

## Arquitetura resumida

- **Cliente:** React 19, TypeScript, Vite e Tailwind CSS.
- **Servidor local/Node:** Express, esbuild e rotas modulares.
- **Produção web:** Vercel, com funções autossuficientes em `api/`.
- **Dados:** Firebase Authentication, Firestore e Storage.
- **Offline:** persistência local do Firestore e Dexie em fluxos específicos.
- **IA:** Gemini pelo servidor; chaves nunca são enviadas ao navegador.
- **Segurança:** regras do Firestore compostas e testadas em emulador.

Uma visão mais detalhada está em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requisitos locais

- Node.js 22 ou compatível;
- npm;
- Java Runtime para os emuladores do Firebase quando os testes de regras forem executados;
- credenciais próprias para serviços opcionais.

## Instalação

```bash
npm install
cp .env.example .env
npm run dev
```

O servidor local inicia, por padrão, em `http://localhost:3000`.

Nunca coloque segredos em arquivos versionados. As variáveis disponíveis estão descritas em [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Comandos principais

```bash
npm run dev                 # aplicação local com Express + Vite
npm run lint                # verificação TypeScript
npm run prebuild            # contratos do produto antes do build
npm run build               # cliente Vite + servidor Node
npm run test:rules          # regras Firestore no emulador
npm run test:operational    # bancada operacional
npm run operations:check    # prontidão das integrações operacionais
npm run mvp:check           # contrato de fechamento do MVP
```

## Validação antes de publicar

O caminho mínimo de validação é:

```bash
npm run mvp:check
npm run lint
npm run prebuild
npm run build
```

Mudanças em Firestore, permissões, diretórios, notas, perfil social ou estoque também devem executar `npm run test:rules`.

Consulte [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) antes de promover uma implantação para produção.

## Produção e diagnóstico

- `GET /api/health` informa ambiente, release e disponibilidade configurada da Kyrubia sem revelar segredos.
- `GET /api/kyrubia` informa a capacidade específica da agente.
- O painel administrativo possui uma área de saúde operacional protegida por papel e permissão.
- Falhas fatais de renderização são capturadas por uma tela de recuperação com código de incidente.

Procedimentos de resposta estão em [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md).

## Documentação do projeto

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): arquitetura e fronteiras.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md): ambientes e variáveis.
- [`docs/MVP_CLOSURE.md`](docs/MVP_CLOSURE.md): estado e critérios de fechamento.
- [`docs/BETA_TEST_PLAN.md`](docs/BETA_TEST_PLAN.md): roteiro de beta fechado.
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md): publicação segura.
- [`docs/INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md): falhas e recuperação.
- [`docs/AI_USAGE_GOVERNANCE.md`](docs/AI_USAGE_GOVERNANCE.md): custos e limites da Kyrubia.
- [`docs/PRIVACY_SECURITY_READINESS.md`](docs/PRIVACY_SECURITY_READINESS.md): pendências de LGPD e segurança.
- [`docs/KYRUBIA.md`](docs/KYRUBIA.md): identidade e comportamento da agente.
- [`SECURITY.md`](SECURITY.md): comunicação responsável de vulnerabilidades.

## Segurança

Não abra uma issue pública contendo chaves, dados pessoais, tokens, documentos, credenciais ou detalhes exploráveis de uma vulnerabilidade. Siga o processo descrito em [`SECURITY.md`](SECURITY.md).

## Situação das integrações

Integrações externas só devem ser consideradas disponíveis quando:

- as credenciais do ambiente estiverem configuradas;
- os testes operacionais estiverem aprovados;
- o fluxo de falha estiver validado;
- houver responsável e procedimento de recuperação definidos.

A presença de código no repositório, isoladamente, não significa que uma integração esteja habilitada para todos os usuários.
