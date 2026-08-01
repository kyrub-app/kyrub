# Arquitetura do Kyrub

## Visão geral

Kyrub é uma aplicação React/TypeScript com três superfícies principais:

1. aplicativo autenticado do usuário;
2. vitrines públicas de lojas;
3. Control Plane administrativo em domínio separado.

O cliente é servido por Vite. O desenvolvimento local usa Express com middleware do Vite; a produção web utiliza o bundle estático e funções em `api/` para rotas serverless.

## Entradas da aplicação

### `src/main.tsx`

Monta a aplicação React e envolve todas as superfícies em uma barreira de recuperação de erros. Uma falha fatal de renderização gera um código de incidente e oferece recarga ou retorno ao início.

### `src/App.tsx`

Resolve a superfície atual:

- `admin.kyrub.com` ou rota administrativa → `AdminControlPlaneRoot`;
- rota de vitrine pública → `PublicStorefrontApp`;
- aplicativo autenticado → `LegacyApp` com bridges modulares;
- rota operacional de equipe → aplicativo autenticado com bridges de operação.

### `src/LegacyApp.tsx`

Ainda concentra parte relevante da composição histórica e do estado da interface. Recursos mais novos são adicionados por componentes, hooks, utilitários e bridges externos para reduzir risco de regressão.

Essa estrutura é transitória. Novas funcionalidades não devem ampliar o monólito sem necessidade; prefira módulos pequenos com testes de contrato.

## Camadas do cliente

### Componentes

- `src/components/admin/`: Control Plane, diretório e saúde operacional;
- `src/components/store/`: operação, catálogo, pedidos, integrações e loja;
- `src/components/modals/`: conversas, perfil, configurações e fluxos auxiliares;
- `src/components/tabs/`: áreas principais do aplicativo;
- bridges: conectam capacidades novas à interface histórica sem duplicar regras de negócio.

### Hooks

Hooks encapsulam sincronização, notas, mensagens, carteira, diretório social e comportamentos reutilizáveis. Um hook não deve contornar regras do Firestore nem armazenar segredos.

### Utilitários

`src/utils/` contém resolução de rotas, persistência, caminhos canônicos do Firestore, composição de documentos, segurança administrativa e adaptação de dados.

## Dados e sincronização

### Firebase Authentication

Google Sign-In identifica o usuário. O documento `users/{uid}` registra o perfil mínimo e alimenta diretórios sociais conforme visibilidade e regras.

### Firestore

Firestore é a fonte compartilhada para dados entre dispositivos. As regras são compostas por scripts e testadas no emulador.

Princípios:

- documentos privados pertencem ao usuário ou à loja autorizada;
- diretórios públicos expõem apenas campos permitidos;
- operações administrativas exigem perfil administrativo separado;
- mudanças críticas não dependem apenas de verificações no navegador;
- caminhos canônicos e migrações são protegidos por testes.

### Offline-first

A aplicação usa persistência local do Firestore e, em fluxos específicos, Dexie. O cache melhora continuidade, mas não concede autorização nem substitui a fonte do servidor.

Conflitos utilizam timestamps e políticas explícitas. Escritas pendentes devem preservar a capacidade de reconciliação após reconexão.

## Servidor Node local

`server.ts` concentra:

- Express e Vite em desenvolvimento;
- limites de taxa;
- rotas de integração;
- saúde operacional;
- endpoints de compatibilidade da inteligência artificial;
- assets estáticos no modo Node de produção.

Segredos são lidos exclusivamente por `process.env`.

## Funções de produção

A pasta `api/` contém handlers autossuficientes adequados à Vercel.

Rotas relevantes:

- `/api/health`: metadados operacionais seguros do Kyrub;
- `/api/kyrubia`: diagnóstico e conversa da Kyrubia;
- `/api/consultor-kyrub`: compatibilidade;
- demais handlers de integração conforme implantação.

Nenhum endpoint de diagnóstico pode devolver chaves, tokens, credenciais ou conteúdo privado.

## Kyrubia

Kyrubia chama modelos pelo servidor. O navegador envia token Firebase para autenticação, histórico limitado e a mensagem atual.

Fluxo de ação:

1. Kyrubia interpreta o pedido;
2. o servidor devolve uma proposta estruturada;
3. o cliente mostra conteúdo e impacto;
4. o usuário confirma;
5. o Kyrub executa pelo mesmo fluxo manual existente.

A primeira ação habilitada é `create_note`. O modelo não grava diretamente no Firestore.

## Control Plane

O painel administrativo tem autenticação Google e autorização adicional em perfil administrativo. Papéis concedem permissões derivadas; o navegador não pode promover uma conta comum.

Métricas devem vir de consultas reais. Valores de receita, conversão, infraestrutura ou plano não devem ser inventados para preencher a interface.

## Segurança

- regras do Firestore são a fronteira principal de autorização de dados;
- Firebase Admin executa somente no servidor;
- chaves do Gemini e segredos de integrações permanecem no servidor;
- limites de taxa reduzem abuso e custo acidental;
- ações administrativas e operacionais relevantes devem gerar trilha de auditoria;
- mensagens de erro ao usuário não exibem stack, segredo ou payload interno.

## Testes

A suíte combina:

- TypeScript com `tsc --noEmit`;
- testes Node de comportamento e contrato;
- testes de regras com Firebase Emulator;
- validações de migração, operação e prontidão;
- builds separados do cliente e do servidor.

## Evolução recomendada

1. continuar extraindo responsabilidades do `LegacyApp`;
2. manter regras de negócio fora de bridges DOM quando houver alternativa modular;
3. criar módulos de domínio para perfil, loja, social, produtividade e faturamento;
4. medir custos e falhas de IA antes de definir franquias comerciais;
5. habilitar integrações por feature flag e ambiente;
6. manter todo novo fluxo crítico coberto por teste de contrato e regra de segurança.
