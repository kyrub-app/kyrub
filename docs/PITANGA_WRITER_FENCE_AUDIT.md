# Pitangas — auditoria de bloqueios antes da ativação (PR #1130)

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

A configuração `firebase.json` referencia `.firebase/firestore.combined.rules` como arquivo de regras Firestore de deploy. Na inspeção desta branch, a leitura desse caminho retornou **404**. O arquivo `firestore.rules` existe, mas **não é suficiente** para provar as permissões efetivas do deploy.

Antes de conectar a emissão de recibos, comprovar a etapa de geração do arquivo combinado, inspecionar as regras resultantes e executar testes de autorização negando escrita de cliente em `users/{uid}/authEvents/first_login_v1`, `users/{uid}/pitangaBalance/balance`, `users/{uid}/rewardLedger/{entryId}` e `systemControl/pitangaLegacyWriterFence`. Validar também eventuais `match` sobrepostos, pois regras Firestore permissivas em qualquer `match` aplicável podem autorizar a operação. Regras de cliente não restringem escritas via Firebase Admin SDK; auditar separadamente credenciais e serviços administrativos.

**Estado:** geração, regras resultantes e testes de autorização ainda não verificados. Não presumir que o 404 significa ausência de regras no ambiente publicado.

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
