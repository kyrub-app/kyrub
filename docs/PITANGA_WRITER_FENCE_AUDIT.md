# Pitangas — auditoria de bloqueios antes da ativação (PR #1130)

## Atualização de segurança — PR #1130

- A rota `onboarding.welcome.claim` **não seleciona mais** o serviço antigo baseado em recibo quando as flags estão desativadas: retorna `WELCOME_CAMPAIGN_NOT_ENABLED`. O serviço antigo permanece no repositório, mas não é acionado por essa rota.
- O caminho de sessão assinada exige `KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED=true`, projeto Firebase correspondente, data de início válida, `auth_time` elegível, documento de fence com `status=fenced` e `writersVerified=true`, e `epoch` idêntico a `KYRUB_PITANGA_WELCOME_FENCE_EPOCH`.
- O caminho `KYRUB_PITANGA_CLEAN_BASELINE_ENABLED` exige adicionalmente `KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED=true` e emulador Firestore local. Não é caminho de produção.
- **Nenhuma dessas flags ou verificações prova que todos os escritores antigos foram bloqueados.** A comprovação de deploys e escritores externos permanece pendente.

## Estado verificado no código

- `pitangaLegacyWriterFence.ts` é **somente um guard reutilizável**. Seu comentário informa expressamente que instalar o helper não bloqueia escritores de produção. A pesquisa de código não confirmou adoção por todos os escritores legados.
- `pitangaNewUserBootstrapTransaction.ts` exige documento `systemControl/pitangaLegacyWriterFence` com `status=fenced`, `writersVerified=true` e epoch correspondente, além da confirmação do chamador. Isso é uma pré-condição, **não uma prova independente** de que todos os escritores legados pararam.
- `pitangaMigrationVerifiedBootstrap.ts` também exige comprovação externa do bloqueio. Não substitui inventário e revisão dos caminhos de escrita.
- `pitangaEarnTransaction.ts` não cria saldo ausente: retorna erro, protegendo saldos históricos de reinicialização silenciosa.
- `firstLoginWelcomeAwardService.ts` **não utiliza mais** `Firebase Auth metadata.lastSignInTime` para autorizar crédito. Ele exige recibo em `users/{uid}/authEvents/first_login_v1`, validado na mesma transação do lançamento. Esse recibo **ainda não possui emissor conectado**; portanto, não há fluxo completo de concessão automática.
- `firstLoginReceiptWriter.ts` é uma primitiva isolada. `trustedFirstLoginEvent: true` **não prova** autenticidade; o futuro chamador precisa validar independentemente a origem, a primeira ocorrência e a identidade do evento. Não expor o escritor a solicitações de clientes ou a rotas que apenas validem ID token.
- A validação de campos `issuer: trusted_auth_server` no recibo não constitui atestado criptográfico de proveniência. É obrigatório restringir permissões de gravação e auditar todos os caminhos administrativos capazes de escrever `authEvents`.
- O bootstrap de novas contas ainda não é chamado pela API nem pelo login. A concessão de 1.000 Pitangas fica indisponível para contas sem saldo canônico pré-existente.

## Limitação da inspeção de código

A busca de código GitHub na branch padrão não retornou resultados nem para identificadores presentes no repositório (`availableKCoins`, `pitangaBalance`, `onAuthStateChanged`). Portanto, **não é possível inferir ausência de escritores legados a partir dessa busca vazia**. A inspeção de todos os caminhos de escrita e seus deploys permanece aberta. Não definir `writersVerified=true` com base nesse resultado.

## Descoberta: regras efetivamente publicadas

A configuração `firebase.json` referencia `.firebase/firestore.combined.rules` como arquivo de regras Firestore de deploy. Esse arquivo é **gerado**, não versionado: `npm run firestore:compose` executa `scripts/compose-firestore-rules.mjs`, que combina `firestore.rules` com os fragmentos listados no script e grava `.firebase/firestore.combined.rules`. O workflow `.github/workflows/validate.yml` executa essa composição e publica o resultado como artefato `composed-firestore-rules` (retenção de 3 dias). A ausência do arquivo gerado no GitHub, portanto, é esperada e **não é falha de configuração**. O arquivo `firestore.rules` isolado continua insuficiente para comprovar as permissões efetivas.

Antes de conectar a emissão de recibos, comprovar a etapa de geração do arquivo combinado, inspecionar as regras resultantes e executar testes de autorização negando escrita de cliente em `users/{uid}/authEvents/first_login_v1`, `users/{uid}/pitangaBalance/balance`, `users/{uid}/rewardLedger/{entryId}` e `systemControl/pitangaLegacyWriterFence`. Validar também eventuais `match` sobrepostos, pois regras Firestore permissivas em qualquer `match` aplicável podem autorizar a operação. Regras de cliente não restringem escritas via Firebase Admin SDK; auditar separadamente credenciais e serviços administrativos.

**Estado:** caminho de geração e execução em CI identificados; conteúdo do artefato composto, regras efetivamente publicadas e testes de autorização específicos do bônus ainda não verificados. Não confundir sucesso da composição com aprovação das permissões.

## Inventário executado no CI — commit e0ba61f

O workflow `Validate Kyrub` concluiu com sucesso e publicou o artefato
`pitanga-writer-inventory` (run 43301006249, artifact 13981358434).
A varredura examinou **1.014 arquivos de aplicação** e identificou
**25 arquivos candidatos**, sem usar a busca de código do GitHub.

Caminhos de mutação de economia canônica identificados por inspeção dos
trechos de código no artefato:

| Arquivo | Operação observada | Tratamento |
| --- | --- | --- |
| `pitangaEarnTransaction.ts` | `tx.update` do saldo, crédito e ledger | Escritor novo; verificar integração e isolamento |
| `pitangaSpendTransaction.ts` | `tx.update` do saldo, débito e ledger | Escritor novo; verificar integração e isolamento |
| `pitangaXpConversionTransaction.ts` | `tx.update` do saldo e conversão | Escritor novo; verificar integração e isolamento |
| `pitangaVoucherIssuanceTransaction.ts` | `tx.update` do saldo e emissão | Escritor novo; verificar integração e isolamento |
| `pitangaNewUserBootstrapTransaction.ts` | `tx.create` do saldo inicial | Escritor novo; depende do fence verificado |

Os demais candidatos incluem adaptadores de serviço, migração,
verificação de histórico, gamificação e referências de interface.
A classificação acima **não prova que sejam os únicos escritores ativos**:
a varredura estática não alcança Cloud Functions externas, jobs,
credenciais administrativas, revisões implantadas ou mutações por caminhos
dinâmicos. Não preencher `writersVerified=true` com base apenas nela.

**Próxima ação delimitada:** confrontar os cinco caminhos de mutação
com seus chamadores e com o deploy ativo; inventariar escritores fora
deste repositório antes de autorizar o fence. Não reabrir auditoria
transversal de outros módulos.

## Matriz de evidências exigidas por escritor

Para cada escritor que altere `availableKCoins`, `rewardLedger`, conversões, resgates ou ajustes administrativos, registrar antes do corte:

| Campo | Evidência obrigatória |
| --- | --- |
| Origem | Arquivo/função/rota/job e ambiente de execução |
| Mutação | Coleção/documento afetado e operação (`create`, `update`, `set`, transação) |
| Proteção | Chamada ao guard no **mesmo** contexto transacional, antes da escrita, ou comprovação de desativação |
| Deploy | Commit e versão efetivamente ativos no ambiente de produção |
| Verificação | Teste de escrita permitida com fence `open` e rejeitada com `fencing`/`fenced` |
| Responsável | Revisão independente e aprovação do inventário completo |

**Critério de bloqueio:** qualquer escritor não identificado, não auditado ou com deploy não comprovado impede `writersVerified=true`. O helper, um teste isolado ou o documento de controle não substituem evidência operacional.

## Critérios objetivos de liberação

1. Inventariar cada escritor legado de Pitangas (rotas, jobs, Cloud Functions, ações administrativas, conversões e resgates), identificando arquivo, operação, transação e deploy ativo.
2. Instalar e testar o guard transacional em **todos** os escritores, ou comprovar sua desativação efetiva; somente depois registrar `writersVerified=true` e o epoch.
3. Criar evento durável e confiável de primeiro login no servidor, com idempotência por UID, sem usar `lastSignInTime` como prova exclusiva.
4. Conectar bootstrap e concessão na mesma jornada segura, testando chamadas repetidas e concorrentes, contas históricas, ausência de saldo, recibos parciais e falhas de rede.
5. Validar em ambiente isolado com Firestore real/emulador e confirmar todos os checks de CI antes de autorizar merge/deploy.

## Decisão

**Não ativar** `KYRUB_WELCOME_BONUS_EFFECTIVE_AT` ou `VITE_KYRUB_WELCOME_BONUS_EFFECTIVE_AT` em produção enquanto os itens acima estiverem pendentes. Não migrar contas antigas por inicialização em zero. Não habilitar Pix como parte deste trabalho.
