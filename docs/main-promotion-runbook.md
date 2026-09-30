# Runbook de promoção da homologação para `main`

## Objetivo

Promover uma versão já validada em `feat/profile-react-rebuild` para `main` sem perder rastreabilidade entre código, Vercel, Firestore, testes e rollback.

Este runbook complementa `docs/RELEASE_CHECKLIST.md` e `docs/INCIDENT_RUNBOOK.md`. Ele não substitui os runbooks específicos de integrações externas.

## Princípios

1. `main` nunca recebe promoção se tiver commits exclusivos que ainda não foram reconciliados com a homologação.
2. O SHA promovido deve ser identificável antes, durante e depois da release.
3. CI verde, deployment Vercel `READY` e regras Firestore validadas são evidências diferentes.
4. Uma exceção de gate precisa ser explícita, documentada e limitada; um gate vermelho nunca vira verde por interpretação informal.
5. Mudanças de dados devem ser idempotentes, retomáveis e independentes do carregamento normal da UI.
6. Nenhum rollback pode depender de apagar evidências financeiras, filas, auditorias ou eventos de provedor.
7. A promoção só começa com uma versão anterior conhecida e restaurável.

## 1. Congelar o candidato

Antes de abrir a promoção:

- interromper merges concorrentes em `feat/profile-react-rebuild`;
- registrar o SHA atual de `main` como `PREV_MAIN_SHA`;
- registrar o SHA candidato da homologação como `CANDIDATE_SHA`;
- registrar o deployment Vercel de produção atualmente saudável como `PREV_PROD_DEPLOYMENT`;
- registrar o deployment Vercel `READY` que corresponde exatamente a `CANDIDATE_SHA`;
- registrar quais regras/índices Firebase fazem parte da release.

Não use apenas o nome da branch como evidência: branch é ponteiro móvel.

## 2. Confirmar ancestralidade

A comparação `main...feat/profile-react-rebuild` deve demonstrar:

- `behind_by == 0` para a homologação;
- o merge-base corresponde ao `PREV_MAIN_SHA` esperado;
- não existem commits exclusivos de produção a reconciliar.

Se `main` tiver avançado, interromper a promoção. Primeiro integrar `main` novamente na homologação, repetir os gates e gerar novo `CANDIDATE_SHA`.

## 3. Gates obrigatórios do candidato

### 3.1 Application build

Deve passar no SHA candidato. O workflow cobre, entre outros pontos:

- `npm run prebuild`;
- contratos críticos adicionais;
- bundle da aplicação;
- normalização do grafo Serverless;
- TypeScript final.

### 3.2 Validate Kyrub

No PR de promoção para `main`, exigir o workflow `Validate Kyrub`, que executa:

- composição das regras Firestore;
- captura de `.firebase/firestore.combined.rules` como artefato;
- `npm run mvp:check`;
- TypeScript;
- contratos selecionados;
- `npm run prebuild`;
- bundle;
- validação do grafo Serverless normalizado.

### 3.3 Store security rules

Quando a release tocar Firestore, segurança de loja, migrações ou arquivos alcançados pelo workflow de regras:

- executar a suíte completa do Emulator Suite;
- executar as suítes dedicadas aplicáveis;
- confirmar que a regra testada é a regra composta usada por `firebase.json`, não apenas `firestore.rules` bruto.

### 3.4 Phase 10 integrated validation

O PR para `main` deve executar:

- `cross-domain-contract`;
- auditoria de dependências de produção.

Se a auditoria de dependências permanecer vermelha por um achado previamente conhecido, a promoção continua bloqueada por padrão. Qualquer exceção precisa registrar:

- advisory/pacote exato;
- motivo pelo qual o risco não foi introduzido ou agravado pela release;
- mitigação existente;
- responsável;
- prazo de remoção da exceção.

Nunca usar “já falhava antes” como aprovação automática.

## 4. Preview e smoke antes da promoção

O deployment usado para validar a homologação precisa estar `READY` e apontar exatamente para `CANDIDATE_SHA`.

Validar no mínimo:

1. `/api/health`;
2. login e restauração da sessão;
3. abertura do app mobile e desktop;
4. navegação dos módulos alterados;
5. rotas Serverless alteradas;
6. ausência de erros novos nos logs de Preview;
7. isolamento de tenant para qualquer mudança de autorização;
8. fluxo financeiro/operacional afetado pela release.

Para releases financeiras, anexar a matriz E2E financeira vigente antes de promover.

## 5. Abrir PR de promoção

Abrir PR:

- **base:** `main`;
- **head:** `feat/profile-react-rebuild`;
- incluir `PREV_MAIN_SHA` e `CANDIDATE_SHA` na descrição;
- incluir links/IDs dos workflows e deployment Vercel validados;
- listar explicitamente mudanças de Firestore, índices, variáveis ou integrações;
- registrar plano de rollback antes do merge.

Não adicionar correções novas diretamente ao PR de promoção. Qualquer correção volta para uma branch própria, é integrada à homologação e reinicia os gates do novo SHA.

## 6. Ordem de código, Vercel e Firestore

A ordem precisa ser definida por compatibilidade, não por conveniência.

### Regras aditivas e backward-compatible

Quando o novo código precisa de uma permissão/índice adicional e a mudança é segura para a versão atual:

1. validar regra/índice no Emulator Suite;
2. publicar a mudança compatível;
3. validar o estado atual;
4. promover o código;
5. executar smoke pós-release.

### Regras restritivas

Quando a regra remove acesso legado:

1. provar por testes e Preview que o código candidato não depende do acesso removido;
2. manter registrada a versão anterior das regras;
3. promover/publicar na ordem definida para a release;
4. executar imediatamente os testes de autorização e os fluxos afetados.

Se código e regra não forem backward-compatible nos dois sentidos, usar uma transição em duas releases; não fazer corte atômico baseado em timing manual.

### Deploy Firestore

O repositório compõe a regra efetiva antes do deploy. Para regras apenas:

```bash
npm run deploy:firestore-security
```

Antes de executar, confirmar projeto `kyrub-b8d0e`, credencial administrativa correta e SHA do checkout.

Para rollback de regras, usar o código do `PREV_MAIN_SHA`, recompor e republicar a regra correspondente. Não reconstruir manualmente uma regra antiga a partir de memória.

## 7. Promoção da aplicação

O `vercel.json` habilita deployment Git para `main`, portanto o merge pode disparar um novo deployment de produção.

Após o merge:

1. registrar o merge commit real de `main`;
2. identificar o deployment Vercel criado para esse commit;
3. confirmar `READY`;
4. confirmar que domínio/alias de produção aponta para a release esperada;
5. consultar logs recentes antes de iniciar testes destrutivos ou financeiros.

Quando for usada promoção explícita de um deployment já validado, registrar o deployment ID/URL promovido. Não promover um deployment cujo SHA difira do commit aprovado.

## 8. Smoke pós-produção

Executar imediatamente:

1. `GET /api/health` e conferir release/commit quando expostos;
2. autenticação com conta controlada;
3. abertura e recuperação da sessão;
4. fluxo principal afetado pela release;
5. autorização entre tenants quando houver mudança de dados/regras;
6. logs de produção para erros novos;
7. verificação de webhooks/filas quando a release tocar pagamentos ou integrações;
8. conferência de que nenhum job, retry ou webhook foi duplicado.

Para alterações financeiras, o smoke não substitui a matriz E2E completa.

## 9. Evidências mínimas da release

Registrar em um único comentário de release/PR:

- `PREV_MAIN_SHA`;
- `CANDIDATE_SHA`;
- merge commit final de `main`;
- PRs incorporados;
- IDs e conclusões dos workflows obrigatórios;
- resultado/justificativa formal de qualquer exceção;
- deployment Preview validado;
- deployment Production atual;
- deployment Production anterior para rollback;
- hash ou artefato da regra Firestore composta quando aplicável;
- resultado das suítes de regras;
- resultado do `/api/health`;
- resumo do smoke/E2E;
- identificadores operacionais necessários para auditoria, sem segredos ou dados pessoais completos.

## 10. Critérios de rollback imediato

Executar rollback quando houver qualquer um dos seguintes:

- mistura ou exposição de dados entre tenants;
- autorização incorreta;
- pagamento, estorno, caixa, CMV ou estoque com efeito duplicado/incorreto;
- falha ampla de autenticação;
- perda ou duplicação de pedido;
- quebra do fluxo principal sem alternativa segura;
- aumento novo e sustentado de erros de produção;
- divergência entre commit aprovado e deployment servido.

## 11. Rollback da aplicação

Manter `PREV_PROD_DEPLOYMENT` registrado antes da promoção.

Quando a conta/ambiente oferecer rollback de deployment, apontar produção de volta para esse deployment conhecido. A Vercel também permite promover um deployment existente para produção; usar somente um deployment cujo commit e estado tenham sido previamente verificados.

Depois do rollback:

1. confirmar domínio de produção na versão anterior;
2. repetir `/api/health`;
3. verificar logs;
4. validar o fluxo que motivou o rollback;
5. abrir incidente e preservar evidências.

Não “consertar por cima” em produção antes de restabelecer uma versão conhecida quando houver risco financeiro ou de dados.

## 12. Rollback Firestore

Se a causa estiver nas regras:

1. interromper novas mudanças concorrentes;
2. usar `PREV_MAIN_SHA` ou outro SHA explicitamente registrado como última regra aprovada;
3. instalar as dependências correspondentes;
4. executar `npm run firestore:compose`;
5. executar os testes de regras daquele estado quando operacionalmente possível;
6. republicar as regras do projeto correto;
7. validar acesso próprio e negação cross-tenant.

Rollback de regra não reverte dados já escritos. Qualquer escrita indevida exige contenção e reconciliação separadas, preservando auditoria.

## 13. Migrações e backfills

Backfills não devem rodar como efeito colateral de um GET normal da UI nem depender de uma única execução longa.

Antes da produção, cada backfill precisa definir:

- cursor estável;
- tamanho de batch;
- idempotência;
- checkpoint/retomada;
- limite de concorrência;
- métrica de progresso;
- forma de interromper com segurança;
- reconciliação final;
- estratégia de compensação quando não houver rollback reversível.

A promoção de código não é autorização automática para iniciar um backfill.

## 14. Encerramento da release

A release só é considerada encerrada quando:

- produção serve o commit aprovado;
- Vercel está estável;
- regras/índices esperados estão publicados;
- smoke e E2E aplicáveis passaram;
- logs não mostram regressão nova;
- evidências e rollback ficaram registrados;
- branches/PRs temporários podem ser encerrados sem perder a trilha de auditoria.

Se qualquer uma dessas condições não puder ser demonstrada, a release permanece em observação ou deve ser revertida.
