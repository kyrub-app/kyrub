# PR #1135 — Fechamento por bloqueios reais (14/11/2026)

## Resultado verificável

- CI do commit `90844973f641583643ba720ad8344848e5b4d244`: seis verificações aprovadas.
- Bônus de primeiro acesso: 100 Pitangas, no máximo uma concessão por usuário, com recibo de evento de autenticação confiável, saldo canônico e lançamento no ledger.
- Gastos de saldo limpo: primitiva transacional isolada, com testes de concorrência, saldo insuficiente e conflito de idempotência.
- Primeira publicação de loja: 2 XP, 0 Pitangas; implementação anterior já integrada à main, fora do escopo de merge desta PR.

## Bloqueios para habilitar a campanha — não confundir testes com integração

### 1. Evento real de registro Firebase Auth — PENDENTE

`welcomeTrustedAuthRegistration.ts` é um adaptador isolado, **não um gatilho implantado**. Não existe prova de execução do evento confiável no cadastro real. `trustedFirstLoginEvent: true` não pode ser fornecido por navegador, HTTP público ou por uma sessão Google isoladamente. A confirmação do provedor Google deve vir de origem verificável; evento Auth sem `providerData` deve falhar fechado.

**Aceite:** registrar e testar um evento real em ambiente isolado, com identidade do projeto e origem verificadas, incluindo concorrência/reentrega, sem criar usuário real de produção.

### 2. Cercamento efetivo de escritores antigos — PENDENTE

`pitangaLegacyWriterFence.ts` é apenas uma guarda reutilizável. A inspeção de `pitangaEarnTransaction.ts`, `pitangaSpendTransaction.ts`, `pitangaXpConversionTransaction.ts`, `pitangaVoucherIssuanceTransaction.ts` e `pitangaMigrationBootstrapTransaction.ts` mostra que **nenhuma dessas cinco primitivas chama a guarda**. O documento `writersVerified: true` por si só não bloqueia escritores. A inspeção de todos os chamadores efetivos, Cloud Functions, jobs e versões implantadas permanece necessária.

**Aceite:** inventário de cada escritor ativo e seus chamadores; instalação/validação do bloqueio em todas as rotas transacionais aplicáveis, sem interromper a publicação da loja (2 XP); evidência de que nenhuma versão ativa pode escrever por fora; somente então marcar `writersVerified: true`.

### 3. Conversão XP e emissão de vouchers para novos usuários — PENDENTE

`pitangaXpConversionTransaction.ts` exige `migrationEpoch` no saldo tanto no primeiro uso quanto no replay. O fluxo de vouchers também passa por verificadores históricos. O saldo legítimo de novo usuário possui `initializedBy: 'verified_clean_baseline_welcome'` e **não** possui `migrationEpoch`. A primitiva de gasto isolada não equivale à integração das conversões e vouchers.

**Aceite:** autoridade de saldo limpo verificada transacionalmente nos fluxos reais de conversão e vouchers, com testes de débito/XP/cupom atômicos e idempotentes. Nunca criar recibo histórico fictício.

### 4. Homologação final e autorização — PENDENTE

Reexecutar testes E2E com Auth e Firestore Emulator, confirmar flags desativadas por padrão e ausência de writes de produção. Não fazer merge/deploy ou ativar Pitangas antes da autorização explícita.

## Ordem de execução recomendada

1. Concluir o inventário dos escritores **ativos**, com evidência de versão e cercamento; não apenas adicionar testes da guarda.
2. Implementar o evento confiável de cadastro no ambiente isolado e testar entrega real.
3. Integrar a autoridade de saldo limpo em conversões/vouchers, se essas operações fizerem parte do lançamento; caso contrário, manter resgates indisponíveis e registrar limitação explicitamente.
4. Rodar homologação E2E final e solicitar autorização separada para qualquer mudança de produção.

**Estado:** PR #1135 em desenvolvimento isolado; não pronta para ativar a campanha.
