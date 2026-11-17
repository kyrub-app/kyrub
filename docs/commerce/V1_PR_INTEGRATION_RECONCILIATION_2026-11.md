# Kyrub V1 — Reconciliação de integração: catálogo, Pix oficial e reembolsos

**Data de vistoria:** 17/11/2026. **Escopo:** PRs [#1139](https://github.com/kyrub-app/kyrub/pull/1139), [#1146](https://github.com/kyrub-app/kyrub/pull/1146), [#1138](https://github.com/kyrub-app/kyrub/pull/1138), com relação à [#1147](https://github.com/kyrub-app/kyrub/pull/1147). Este documento complementa a [lista-mãe](../../ROADMAP_PROXIMOS_AJUSTES.md) e não autoriza merge, deploy ou cobranças.

## 1. Fonte verificada e estado de cada candidato

**Base comum confirmada pela comparação GitHub:** `main` em `008c6078435a312e05358a583ece6b148614a04e`. As três PRs estão à frente da mesma base, sem commits ausentes de `main` na vistoria. Sucesso isolado de CI **não é** prova da combinação.

| PR | HEAD | Diferença vs main | Testes GitHub do próprio HEAD | Estado |
| --- | --- | --- | --- | --- |
| #1139 — ERP → Marketplace | `eefa999bb08e03fed05f62cd7629e142756c46e2` | 20 arquivos, 14 commits | 4 workflows aprovados; Vercel reportou sucesso no commit | Aberta, não integrada |
| #1146 — reembolso integral vs parcial | `5096f18f1dc0d560f93540e614ee47f4902c5b21` | 6 arquivos, 6 commits | 5 workflows aprovados; Vercel com falha | Draft, não integrada |
| #1138 — cupom Loja Oficial, Pix canônico | `42cda94b9d3a7d130453a1b0612147dc12bf42c7` | 31 arquivos, 151 commits | 7 workflows aprovados, incluindo Chromium e E2E isolados; Vercel com falha | Aberta, não integrada |
| #1147 — auditoria split/settlement | `d132bcb59e974be3b51cde6ac4e6886108af4b31` | Documentação, domínio de split | 4 checks aprovados na vistoria anterior | Draft; **não** executa split |

**Atenção aos 151 commits da #1138:** comparar **o diff efetivo de 31 arquivos**, não tratar todo o histórico de commits como 151 funcionalidades independentes. Não fazer reset/rebase destrutivo nas branches existentes.

## 2. Mapa de sobreposição — conclusão da vistoria de arquivos

- **#1139 × #1138:** exatamente **4 arquivos compartilhados**:
  1. `server/payments/paymentIntentRouter.ts`
  2. `src/components/PublicStorefrontApp.tsx`
  3. `src/utils/marketplaceCheckout.ts`
  4. `tests/public-storefront-routing.test.ts`
- **#1146 × #1139:** **nenhum arquivo compartilhado**; há dependência semântica de pedidos e pagamentos, portanto teste cruzado continua necessário.
- **#1146 × #1138:** **nenhum arquivo compartilhado**; não compartilhar arquivo não é certificado de compatibilidade comportamental.
- **#1147 × #1148:** ambas alteram `ROADMAP_PROXIMOS_AJUSTES.md`, com conteúdos úteis diferentes. A integração **deve preservar** tanto a priorização V1 da #1148 quanto as conclusões financeiras da #1147.

### Conciliação obrigatória nos quatro arquivos da #1139 × #1138

**`paymentIntentRouter.ts`:**
- Preservar **da #1139** o catálogo publicado e validado da primeira loja canônica, personalizações/cotações rechecadas em transação Firestore, sem confiar nos preços do cliente nem aceitar produto retirado.
- Preservar **da #1138** a exceção específica de consulta pública `GET /api/payments/promotions?storeId=...` para a Loja Oficial canônica, verificando **`stores/{id}.publicationStatus === published`**. A consulta de promoções das outras lojas continua passando por `loadPublishedCatalog(storeId)`.
- Não modificar o bloqueio servidor que impede planos oficiais de entrar no carrinho B2C ou em intenções Pix genéricas.
- **Risco concreto de integração:** substituir a rota especial da #1138 pela versão da #1139 faria a Loja Oficial passar novamente pela leitura B2C de `tenants/{id}` na rota de promoções; isso poderia impedir a descoberta do cupom na Praça, mesmo com o contrato Pix correto.

**`PublicStorefrontApp.tsx`:**
- Preservar **da #1139** `reconcilePublishedStorefrontCart`: atualizar preço/estoque pela vitrine publicada e retirar do carrinho produtos despublicados.
- Preservar **da #1138** a separação planos oficiais → `InitialPrepaidSubscriptionCheckout` (sem carrinho B2C), painel de cupom informado e mensagem explícita em caso de cupom inválido.
- Testar ordem dos efeitos de reidratação do carrinho, troca de sessão e novo catálogo; **nenhuma cobrança integral silenciosa** quando cupom oficial aceito não existir mais.

**`marketplaceCheckout.ts`:**
- Preservar **da #1139** as seleções de opções e observações do item enviadas como **IDs/identidade**, nunca preço calculado pelo navegador.
- Preservar **da #1138** a chamada **GET** existente para listar promoções (a implementação anterior usava POST incompatível).
- Carrinho comum e cupom da Loja Oficial seguem trilhos contratuais distintos.

**`tests/public-storefront-routing.test.ts`:**
- Manter asserções de carrinho retomado/reprecificado, itens despublicados e opções da #1139, juntamente com asserções de navegação/estado de sessão da #1138.
- Não resolver conflito apagando testes de uma das PRs. Reexecutar os casos no **SHA combinado**.

## 3. Reembolso integral vs parcial: revisão de fronteiras

**Evidência específica:** o job `134047930758` do GitHub Actions executou no Firebase Emulator **269/269 testes, 0 falhas**, incluindo os **cinco casos** de `tests/firestore-refund-history-safety.test.ts` (intenção parcial transacional, estados incertos, parcial confirmado, 51 tentativas e histórico vazio). Os cinco casos **não simulam um POST real de reembolso integral concorrente contra o PSP**; isso permanece gate de integração e piloto financeiro.\n\n**#1146** reforça três pontos realmente observados no código:
1. `partialRefundSafetyService.ts` limita a consulta a 51 para detectar histórico acima de 50 e bloquear por revisão humana, além de estados `required`, `processing`, `failed` e desconhecidos.
2. `orderItemCancellationService.ts` grava a intenção de reembolso parcial na **mesma transação** que altera o pedido; não informa ao PSP que dinheiro foi devolvido por apenas registrar a intenção.
3. `paymentRefundService.ts` volta a verificar o histórico antes de `preparePaymentForRefund`, inclusive para chamadores que não passam pelo roteador; o HTTP expõe 409 explícito.

**Gate de aceitação adicional (não declarar já executado):** no SHA candidato que reunir o fluxo de pedidos da #1139 e a segurança da #1146, rodar fixtures de uma mesma compra com cancelamento parcial seguido de tentativa de reembolso integral, respostas concorrentes/incertas do PSP, callbacks duplicados e histórico acima do limite. Confirmar uma única obrigação financeira e nenhuma dupla devolução. Se uma concorrência sobreviver à verificação inicial, avaliar barreira transacional compartilhada antes de liberação real; **a leitura antecipada isolada não equivale, por si só, a prova de serialização de operações financeiras concorrentes**. Não afirmar um defeito financeiro adicional sem reprodução.

## 4. Sequência segura proposta (sem novas implementações duplicadas)

1. **Reconciliação de base:** manter snapshots exatos de #1139/#1146/#1138, `main` e matriz de arquivos. Identificar correções já publicadas que possam ser sobrescritas.
2. **Integrar/validar segurança de reembolso (#1146)** como bloco isolado primeiro, com teste real de Firestore Emulator e revisão independente. Isso não aciona PSP real nem libera checkout.
3. **Integrar/validar catálogo e pedidos (#1139)** preservando os contratos canônicos de autenticação, publicação, preço, estoque, customização, espelho ERP, KDS e CRM.
4. **Combinar #1138 ao catálogo/pedidos**, aplicando explicitamente a matriz de 4 arquivos acima. Executar os testes oficiais de Pix de plano **simulado**, inclusive cupom Business R$ 1 sem pagamento real, vigência imediata, callback idempotente, comprador sem loja, cupom inválido e plano fora do carrinho B2C.
5. **E2E transversal em branch isolada com os mesmos módulos**: usuário autenticado → vitrine → item configurado → pedido → aprovação → Pix **simulado** → webhook → KDS/estoque/CRM → cancelamento/reembolso parcial/integral com guardas → ledger. Não considerar separadamente `npm run test:rules` suficiente para a integração das três.
6. **Release Gate:** código e teste conjunto no HEAD exato, verificar que o Vercel preview corresponde ao HEAD, revisar flags de checkout, recebedor e termos comerciais, autorização explícita para lançamento, somente então merge/deploy e smoke em produção.
7. **Dinheiro real fica em gate separado**: um único piloto autorizado do comprador, conta recebedora exata, Pix e webhook oficiais, políticas legais/reembolso; a resposta comercial de split/frete não é requisito para apenas revisar ou testar os três blocos.

## 5. Critério de encerramento do presente diagnóstico

- [x] Identificar commits e estado das três PRs.
- [x] Comparar caminhos alterados e confirmar sobreposição exata.
- [x] Auditar os trechos relevantes dos quatro arquivos comuns e o gate de histórico parcial.
- [x] Verificar CI individual das três PRs.
- [x] Construir candidato **#1139 + #1146** sem merge em main — [PR #1149](https://github.com/kyrub-app/kyrub/pull/1149), branch `integration/v1-catalog-refund-isolated-2026-11`, HEAD `e0bee3203631eb709821214a4e383955be0f288b` (exatamente 6 arquivos originais da #1146 aplicados sobre a #1139). **Aprovação conjunta depende do CI desse HEAD.**
- [ ] Concluir CI da **#1149** para catálogo/pedidos + reembolso na mesma árvore.
- [ ] Combinar a **#1138** preservando quatro arquivos sobrepostos e executar teste cruzado de preço, estoque, cupom oficial, pedidos e reembolso no novo SHA.
- [ ] Homologação visual/Android e primeira compra real autorizada quando os respectivos gates permitirem.

**Resultado:** diagnóstico de compatibilidade **concluído**; integração conjunta e homologação cruzada **pendentes**. Não há código de runtime alterado por este documento e a Vercel pode continuar bloqueada sem impedir preparação/revisão em branch isolada.

## 6. Gate V0 identificado na primeira combinação — segurança de dependências

**Candidato integrado:** [PR #1149](https://github.com/kyrub-app/kyrub/pull/1149), SHA `e0bee3203631eb709821214a4e383955be0f288b` (código da #1139 + **seis arquivos idênticos** da #1146). O diff adicional frente à #1139 é exatamente a cobertura de proteção de reembolso. Não houve nenhuma mudança de produção.

- **Resultado do CI da #1149 no HEAD exato:** **4/5 workflows aprovados** (`Application build`, `Validate Kyrub`, `Store security rules`, `Identity security rules`); a **Phase 10 integrated validation** reprovou somente no job `production-dependency-security` (run `44151759920`, job `134281687780`) pelo `npm audit --omit=dev --audit-level=high`. O job `cross-domain-contract` **PASSOU**.
- Auditoria do grafo de dependências de produção: **11 ocorrências (4 altas, 6 moderadas, 1 baixa)** no log; auditoria geral de `npm audit`: **13 ocorrências (6 altas)**. Pacotes que exigem triagem incluem `picomatch@4.0.5`, `path-to-regexp@6.1.0` (subárvore de `@vercel/routing-utils`), `qs@6.16.0` e `fast-xml-parser@5.11.2`, além de cadeias de dependências indiretas. Alguns são de dev; conferir **exatamente** a alcançabilidade no runtime antes de classificar impacto real.
- **Evidência de origem:** o blob do `package-lock.json` é **idêntico** na `main` e na candidata: `f164b893fb6179b122dddc1bedf0bf2ea97ab6f5`. A candidata não criou novo grafo de dependências. Essa falha não demonstra conflito funcional das PRs, **mas impede a aprovação do Beta Gate**.
- Não executar `npm audit fix --force` sem análise: o próprio npm alerta sobre mudanças disruptivas, especialmente ferramentas de roteamento. Fazer remediação **isolada**, com upgrades específicos compatíveis e `package-lock` regenerado, revisão do grafo `--omit=dev`, teste TypeScript, suíte de segurança e prebuild, e validação da preview no HEAD correto quando possível.
- **Ordem:** remediar/auditar vulnerabilidades V0; repetir Phase 10 no SHA conjunto; depois completar a composição com a #1138, sem antecipar Pix real.

**Status deste gate:** `BLOQUEADO_V0_SEGURANCA_DEPENDENCIAS`; **não apto a merge/deploy enquanto persistir a falha**.


## 7. Atualização de execução — 17/11/2026 (substitui o status temporal da seção 6)

### Correção do bloqueio V0

- A falha inicial do `npm audit --omit=dev --audit-level=high` estava no escopo de dependências herdado da `main`: `vite` e ferramentas de build/teste incluídas em `dependencies` em vez de `devDependencies`. O servidor ainda importava Vite estaticamente em runtime.
- [PR #1150](https://github.com/kyrub-app/kyrub/pull/1150), HEAD `6a7d5c99`, corrige as classificações sem mudar versões, carrega Vite apenas no ramo de desenvolvimento e preserva a auditoria. Resultado: **8/8 workflows GitHub Actions PASS**; audit produtivo **0 altas/críticas**, ainda **1 baixa e 6 moderadas**. O audit completo segue com altos de tooling e não deve ser omitido da triagem.
- [PR #1149](https://github.com/kyrub-app/kyrub/pull/1149) atualizada no HEAD `d5d3c61a`: correção reaplicada diretamente sobre #1139 + #1146, **8/8 workflows PASS**, incluindo build, validação geral, regras de segurança, browser smoke e Phase 10. Ainda sem merge/deploy.

### Combinação da PR #1138 aos contratos de catálogo e reembolsos

- [PR #1151](https://github.com/kyrub-app/kyrub/pull/1151), branch `integration/v1-commerce-plans-refunds-2026-11`, criada a partir do HEAD corrigido da #1149. Incorporados os **31 arquivos** alterados pela #1138: 27 blobs preservados literalmente e os quatro arquivos sobrepostos reconciliados sem suprimir checkout B2C, proteção de preço/personalizações ou checkout oficial pré-pago.
- Primeiro SHA `ac25937f`: **Phase 10 PASS** e **E2E de gamificação cruzada PASS**; o job `Official plan canonical Firestore E2E` falhou antes de executar o Firestore, na etapa de teste DOM, porque o stub virtual de `storefrontOriginContext` não exportava a nova função `reconcilePublishedStorefrontCart` da #1139 (erro de `esbuild`).
- Correção restrita ao mock do teste `tests/official-plan-praca-interactive-dom.test.ts` no HEAD `865b012d`, sem alteração de cobrança, catálogo ou contrato. **11/11 workflows GitHub Actions concluídos com sucesso (0 falhas)** no SHA exato, incluindo validação geral/prebuild, regras de loja, emulador Firestore financeiro, Chrome Praça, Playwright primeira loja, cross-PR gamificação, segurança e build.

### Situação e próximos critérios

- [x] Candidato #1149 integrado ERP/reembolsos validado no SHA de segurança corrigida.
- [x] Composição de código com #1138 e reconciliação dos quatro pontos de sobreposição realizada no #1151.
- [x] Finalizar e conferir **todos os 11/11 workflows GitHub Actions** da #1151 no HEAD `865b012d` (0 falhas), sem desativar asserts financeiros.
- [ ] Homologar jornada cruzada pedido varejo → aprovação → Pix simulado → KDS/estoque → refund/ledger sob o mesmo SHA, além dos E2E específicos do plano oficial.
- [ ] Confirmar release authority, visual mobile/Android, configuração de recebedores e PSP, LGPD e autorização do proprietário antes de qualquer Pix real, merge ou deploy.

**Estados:** #1150, #1149 e #1151 `TESTADO_ISOLADO` (CI integrado verde, sem release); #1151 ainda requer cenário transversal varejo/KDS/reembolso e gates de produção/financeiro; primeira compra comercial e dinheiro real continuam `OWNER_GATE`. A lista-mãe mantém os 67 itens intactos e a governança de V0/V1/V1-ENTREGAS/V2.

## 8. E2E transversal varejo/KDS/estoque/reembolso — concluído em emulador

- **Candidata #1151 / SHA `d0e87e4d37b65a91e24837cc34b23eec94e13ec5`: 11/11 GitHub Actions PASS, 0 FAIL.** Workflow Firestore [run 44157965322](https://github.com/kyrub-app/kyrub/actions/runs/44157965322), job `134303714800`: **279/279 testes principais + 3/3 + 5/5 complementares aprovados**. Novos subtestes 74 e 75 executados de verdade no Firebase Emulator.
- No **subteste 74**, pedido é criado pelo serviço canônico, o lojista aceita, o KDS aguarda a confirmação Pix assinada simulada, três callbacks concorrentes só registram um pagamento válido, o estoque de ingrediente cai exatamente 125g quando começa o preparo (sem dupla baixa em replay) e retorna ao nível anterior no cancelamento. Espelho ERP acompanha o pedido; nenhum reembolso automático é emitido como efeito colateral da mudança de status.
- No **subteste 75**, evento pago validado antes do aceite não abre o KDS, cancelamento parcial do pedido ainda pendente registra obrigação de devolução transacional e idempotente, e um pedido posteriormente encerrado **não consegue** solicitar reembolso integral ao PSP enquanto houver histórico parcial incerto. Nenhuma solicitação real alcança o provedor.
- **Estado:** `TESTADO_ISOLADO` para a cadeia varejista integrada; **não** significa reembolso Pix realmente executado, corrida simultânea de full+partial em PSP, split/liquidação do entregador, migração/prod, UI Android/GPS ou Beta Gate. Esses gates permanecem abertos e independentes.
- A PR #1151 continua em Draft; a lista-mãe com os 67 itens e a distinção V0/V1/V1-ENTREGAS/V2 permanecem válidos. Próxima frente técnica da V1: conferir sobreposições de Praça/Comunidades (#1144) e gamificação (#1137) com este exato SHA; escritor Firebase ainda `OWNER_GATE` e não pode conceder recompensas reais.

## 9. Reconciliação da Praça, Comunidades e Kyrubia Educadora — candidata #1152

- **Candidata** [PR #1152](https://github.com/kyrub-app/kyrub/pull/1152), commit `0cfc15dbebb5c98f5171138e34982af979ec49e2`: código da #1151 (`d0e87e4d`) + **11 arquivos da #1144**. Nove arquivos/blob de origem preservados e dois reconciliados: `package.json` (mantém o escopo de build e testes reembolso; adiciona teste educacional) e `src/components/tabs/KyrubTab.tsx` (mantém reparo de imagens da Praça/cupom + filtragem de post público/expiração de Status em 24h).
- **Resultado no HEAD exato: 11/11 GitHub Actions PASS, 0 FAIL.** O Firestore Emulator [run 44158992160](https://github.com/kyrub-app/kyrub/actions/runs/44158992160) aprovou **279/279**, mais **3/3 + 5/5**; a validação [run 44158992241](https://github.com/kyrub-app/kyrub/actions/runs/44158992241) aprovou **2.273/2.273 prebuild**, **244/244 renewal**, **33/33 prepaid initial** e **40/40 official plan Pix**, todos isolados. Playwright da primeira loja e Chromium da Praça também passaram na candidata acumulada.
- **Regras mantidas:** um post só aparece na Praça se sua visibilidade for pública; Status de 24h expira; a mudança de comunidade ignora snapshots anteriores. Kyrubia Educadora usa o chat existente com objetivos editáveis — não cria inscrição automática em cursos nem negócio paralelo de cobrança.
- **Próximo gate de código:** #1137 gamificação. São **68 arquivos** próprios da PR e apenas **dois caminhos comuns** com a candidata atual (`server.ts`, `src/components/tabs/KyrubTab.tsx`). O segundo tem conflito localizado de estado XP/Selos vs novo cálculo de posts da Praça e exige merge intencional para preservar ambos. **Não habilitar 100 Pitangas/2 XP ou conversão 1.000:1 na produção** enquanto faltar atestação dos escritores Firebase e o gate humano de ativação.
- **Ainda aberto:** preview Vercel do SHA novo, Android autenticado, operador/recebedor real PSP, execução/reserva de frete, elegibilidade de reembolso real, revisão LGPD e autoridade de release. Os 67 itens da lista-mãe continuam preservados.

## 10. Gamificação integrada sem ativação — candidata #1153

- A [PR #1153](https://github.com/kyrub-app/kyrub/pull/1153) foi criada em **Draft** sobre a candidata comercial/social #1152 no commit **`617e88bbc42dff6952a9109f5df791c6743c49fc`**. Todos os **68 arquivos** da #1137 (origem `3ba801678b81fb3950aca9cfbef1399c85971bb4`) foram incorporados: 66 blobs originais idênticos, e dois arquivos reconciliados manualmente (`server.ts` e `src/components/tabs/KyrubTab.tsx`). Comparação de SHA com main comprovou inexistência de sobreposição fora desses dois.
- **Integração de UI:** a tela `PitangaAccount` e a rota local `/api/pitangas` substituem consultas legadas de Selos/XP; o filtro `selectPublicSquarePosts`, expiração de Status 24h, cupons/vitrine e o bootstrap Vite apenas em desenvolvimento foram preservados. No Vercel, a rota é transportada pelo multiplexador já existente, sem novo endpoint serverless autônomo.
- **Provas sobre o SHA exato:** **13/13 workflows GitHub Actions PASS, 0 FAIL**. `Store security rules` [run 44160727981](https://github.com/kyrub-app/kyrub/actions/runs/44160727981): **279/279 Firestore**, mais **3/3 + 5/5** complementares, incluindo os subtestes 74/75 comerciais. `Validate Kyrub` [run 44160727676](https://github.com/kyrub-app/kyrub/actions/runs/44160727676): **2.273/2.273 prebuild**, **244/244 renovação**, **33/33 pré-pago inicial** e **40/40 Pix oficial**.
- `Welcome 100 Pitangas isolated contracts` [run 44160727603](https://github.com/kyrub-app/kyrub/actions/runs/44160727603): **48/48** contratos, **26/26** transações Firestore e **6/6** integração de cadastro `Auth/Functions Emulator`. O `pitanga-release-gate` permanece **skipped** no PR porque somente `workflow_dispatch` o executa, e foi projetado para reprovar um release enquanto o inventário real não for provado. `Firebase key attestation` [run 44160727833](https://github.com/kyrub-app/kyrub/actions/runs/44160727833) testou o verificador local de assinaturas; **não** atestou identidades implantadas.
- **Gates remanescentes específicos:** inventariar **todas** as revisões e identidades escritoras Firebase (inclusive externas), provar que transações legadas estão bloqueadas ou aposentadas, validar checkpoint e reconciliação do saldo, definir data de corte, homologar o gatilho em staging implantado. `writersVerified:true` e flags de welcome/conversão não foram habilitados. A regra **1.000 Pitangas = 1 XP**, os **100 Pitangas por primeiro cadastro elegível** e os **2 XP da primeira publicação** seguem contratos configurados, **não recompensa liberada em produção**.
- **Decisão de lançamento:** `TESTADO_ISOLADO` para código da V1 acumulada, **`BLOQUEADO_PRODUCAO`** para economia/gamificação e Beta Gate real. Não houve merge, publicação, conta de produção criada, pagamento real nem mudança de Firestore. A #1152 continua candidata isolada homologada sem adicionar a nova superfície de saldos se a ativação da #1153 precisar ser adiada.

## 11. Entregas e retorno econômico integrados apenas para homologação — candidata #1154

- [PR #1154](https://github.com/kyrub-app/kyrub/pull/1154), SHA `1ec349afb01f09ab159a97a7ae6ecfd38580ac38`: reúne a candidata acumulada #1153 (sem deploy e sem liberação de gamificação) e os **94 arquivos** da #1145 (HEAD `4824007c306a4c828b15508036171be21fc475a4`). **92 blobs originais inalterados**, e somente `package.json` + `src/LegacyApp.tsx` reconciliados. Nenhum outro caminho sobreposto com a main foi sobrescrito.
- Mantidos os testes existentes de catálogo, reembolso, Pix, Kyrubia/social e gamificação; adicionados ao comando oficial **7 cenários Firestore** de entregas/retornos/responsabilidade e **19 testes de prebuild** de aceite, suporte, compatibilidade de carga/veículo, GPS, mapas, privacidade e economia da devolução. `LegacyApp` sanitiza o cache de entregas antigas em leitura e escrita, sem gravar endereço do comprador em lista pública.
- **Resultado no SHA acumulado: 13/13 workflows PASS, 0 FAIL**. [Run 44162111218](https://github.com/kyrub-app/kyrub/actions/runs/44162111218), job `134318379550`: **317/317 Firestore Emulator**, mais **3/3 + 5/5**; os subtestes de comércio/estorno guardado continuam aprovados (110 e 111). [Run 44162111341](https://github.com/kyrub-app/kyrub/actions/runs/44162111341), job `134318379828`: **2.360/2.360 prebuild**, **244/244 renovação**, **33/33 assinatura inicial** e **40/40 Pix oficial**, além de 155/155 e 72/72 grupos preparatórios.
- **NÃO é lançamento do módulo Entregas:** oferta pública mascarada e rota privada exigem **release coordenado** de regras Firestore, backend e app; GPS real Android/iOS, geofence física, cadastros e revisão de veículo, critérios de motofrete, custo Maps, funcionalidade em segundo plano e retorno supervisionado carecem de E2E em aparelho. **Split/recebimento de frete 1:N e repasses reais seguem sem suporte PSP atestado** conforme #1147. Política econômica de espera, cancelamento e retorno continua proposta inicial **com atribuição humana auditada**, sem débitos/culpas automatizados.
- **Separação intencional:** #1153 permanece candidata da **V1 comercial**; #1154 é um **incremento V1-ENTREGAS preparado em Draft** e não deve atrasar a versão comercial se operação de entrega não puder ser liberada. Da mesma forma, #1137 não habilita saldos de produção por estar presente na #1154. **Nenhum merge/deploy/efetivação financeira real**.

## 12. Praça confiável, conexões e denúncias — #1155 e #1156

- **Achado de segurança em produção/source main:** `src/components/ConnectedContactsPanel.tsx` permitia "Denunciar usuário" mas gravava apenas uma lista em `localStorage`, mostrando uma confirmação de encaminhamento que não correspondia a recebimento administrativo. `src/components/PublicSocialFeedPanel.tsx` possuía curtir/comentar/salvar, porém não menu contextual por publicação; `social_post_reports` existia nas regras sem uso pela UI, e o Control Plane só listava posts recentes.
- [PR #1155](https://github.com/kyrub-app/kyrub/pull/1155), HEAD `ba6452f9`: correção isolada do menu Conectar/Conversar/Denunciar, gravação real e imutável de denúncia por usuário/post em Firestore e triagem humana no Control Plane. Permissões reforçadas contra `authorId` falsificado, denúncia própria e leitura privada alheia. Usuário/autor não recebe crédito em Pitangas por publicar nem por denunciar. Revisão administrativa exige justificativa; remoção de post conserva denúncia e registra auditoria.
- A #1155 usa como base o grafo de dependências da `main` anterior à correção #1150: **Phase 10 audit produtivo FAIL (4 high pré-existentes)**. Suíte Firebase Emulator da fonte [run 44171390391](https://github.com/kyrub-app/kyrub/actions/runs/44171390391): **266/266 principais + 3/3 + 5/5**; não confundir "código corrigido" com gate V0 liberado nessa PR isolada.
- [PR #1156](https://github.com/kyrub-app/kyrub/pull/1156) recompõe essa correção sobre #1153, HEAD **`cfbfad521492b6ac2869c519da6b35c40139bd4c`**. Oito blobs da #1155 foram preservados e o único arquivo sobreposto (`src/components/tabs/KyrubTab.tsx`) reconciliado mantendo filtro da Praça, PitangaAccount, cupom e ERP.
- **No HEAD combinado: 13/13 workflows CI PASS, 0 FAIL**. Firebase [run 44171914333](https://github.com/kyrub-app/kyrub/actions/runs/44171914333): **281/281 Firestore**, mais **3/3 e 5/5**, incluindo novos testes imutáveis de denúncia/autoria/visibilidade de post e denunciado. `Validate Kyrub` [run 44171914083](https://github.com/kyrub-app/kyrub/actions/runs/44171914083): **2.273/2.273 prebuild**, **244/244 renovação**, **33/33 pré-pago inicial**, **40/40 Pix oficial**, sem regressões; Phase 10, Chromium Praça, primeira loja e auth emulator passaram.
- **Próxima lacuna real (avaliações ↔ Praça):** a versão `src/LegacyApp.tsx` ainda cria `MomentsModal` e um `SocialPost` associado em estado local, com IDs separados e sem vinculação comprovada com as coleções `social_posts`/`social_post_likes`. Não há prova de que a curtida no feed seja a mesma exibida na avaliação da loja, nem publicação canônica em outro dispositivo. Priorizar avaliação única (uma fonte de verdade) vinculada ao post, autorizada pelo servidor, com regras de acesso/remoção e contagem consistente. Não mascarar a lacuna como pronta.
- **Estado:** #1156 `TESTADO_ISOLADO`; #1155 `IMPLEMENTADO_PR` com V0 herdado falho; `main` não foi alterada, sem deploy das regras, sem remuneração de Pitangas/XP, sem uso de moderação real. Release requer autorização expressa e backend/frontend/regras coordenados.

## 13. Avaliações canônicas na loja e Praça — #1157

- [PR #1157](https://github.com/kyrub-app/kyrub/pull/1157), HEAD `2dd057f4c305a90480d84e8eb5cc660d6580ebb7` (Draft, ainda fora da `main`), integra sobre #1156 a ligação entre o sistema de avaliação da loja e as publicações e curtidas da Praça.
- **Diagnóstico:** o antigo `LegacyApp` publicava `momentos` e posts em `localStorage`. O `ProfileRecoveredActionsBridge` mantinha um segundo escritor local que acionava `kyrub-social-posts-updated`. Foram descobertos e eliminados **ambos os caminhos de falsa publicação**, sem apagar histórico antigo.
- **Fonte única:** `store_reviews/{storeId}/reviews/{authorUid}` (autoria autenticada, uma avaliação por usuário/loja, loja publicada, sem autoavaliação) + `social_posts/review_{storeId}_{authorUid}` opcional, criado na **mesma operação batch**. Firestore Rules validam integridade bidirecional com `getAfter`. UI `MomentsModal`, ponte de perfil e vitrine `/@slug` usam o mesmo publicador. A contagem de curtidas vem de `social_post_likes`, também usada no feed; sem duplicação de saldo ou contador.
- **Moderação:** a operação humana `removeModeratedPost` oculta a avaliação original ao remover um post associado, sem eliminar a denúncia/auditoria. Remover apenas a avaliação por pedido de seu autor exige respeitar a referência ao post.
- **Testes:** [Store security run `44177131913`](https://github.com/kyrub-app/kyrub/actions/runs/44177131913), job `134371370707`: **287/287 Firestore principais**, **3/3 + 5/5** extras. [Validate Kyrub run `44177131879`](https://github.com/kyrub-app/kyrub/actions/runs/44177131879), job `134371426929`: **2.278/2.278 prebuild**, **244/244 renewal**, **33/33 prepaid**, **40/40 Pix oficial simulado**. **13/13 CI workflows PASS**, incluindo Phase 10, Application build, Chromium Praça e E2E existentes, no SHA acima.
- **Limites:** não houve teste Android autenticado real com dois usuários curtindo e conferindo a mesma contagem; a review não prova compra verificada e não pode alimentar reputação premiada sem provas; denúncias de review somente na loja (sem post) e resposta do lojista são novos itens a fechar. Nada em produção; requer publicação conjunta de regras/clientes após autorização.
