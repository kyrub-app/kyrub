# Kyrub — recuperação do Admin / Integrações (21/10/2026)

## Incidente observado

Ao abrir Integrações & Infraestrutura no Chrome Android, o usuário recebeu o erro global `KYR-MVIOXE8M-4PT8R`, gerado pelo `AppErrorBoundary` às `2026-10-21T22:35:22.582Z` (19h35 no Brasil).

A observabilidade Vercel registrou, no mesmo acesso, `GET /api/admin/platform-economy` com Firestore `9 FAILED_PRECONDITION` e o requisito de índice composto `economicLedger` (`kind ASC`, `amountMinor ASC`, escopo `COLLECTION_GROUP`). A resposta de backend estava prevista para ser capturada pela UI; **não existe telemetria centralizada da exceção React** suficiente para atribuir causalidade exclusiva ao erro de índice. O identificador do incidente é gerado localmente no navegador.

## Correções isoladas

1. Declarar o índice em `firestore.indexes.json`. **Merge Vercel não instala o índice no Firestore.** O operador com credenciais e autorização apropriadas deve promover o índice via pipeline Firebase ou `firebase deploy --only firestore:indexes --project kyrub-b8d0e` e conferir seu estado no console. Não publicar índices em um projeto Firebase diferente. Não alterar regras de segurança.
2. Responder `503 PLATFORM_ECONOMY_INDEX_PENDING` sem expor detalhes internos do Firestore enquanto o índice estiver indisponível.
3. Limitar exceções React de Integrações, Fiscal e Economia da Plataforma à própria seção, preservando navegação administrativa e botão de recuperação local.
4. Validar a resposta do inventário Mercado Pago antes de renderizar listas, tratando respostas parciais com mensagem inline. Nenhum token é exposto, renovado ou desconectado.
5. Rodar testes de regressão e preview no SHA final; depois de eventual promoção autorizada, confirmar leitura do inventário com sessão de Super Admin, e verificar se a tela global não aparece mais.

## Não incluído

- Nenhuma emissão Pix, nenhuma liberação de flag, webhook, liquidação, credencial OAuth ou movimentação financeira.
- PR #956 permanece Draft, sem merge.
- Não inferir que um erro HTTP 503 explique sozinho o crash React; o cliente deverá confirmar recuperação visual e, se ocorrer novamente, informar o código da nova tela para análise específica.

## Critérios de encerramento

- O índice econômico está implantado e `READY` no Firestore.
- O Admin abre Integrações & Infraestrutura no Chrome Android sem cair no error boundary global.
- Inventário Mercado Pago exibe a conta autorizada e estado adequado, mantendo leitura apenas.
- Painel Econômico deixa de receber `FAILED_PRECONDITION` nas consultas protegidas.
