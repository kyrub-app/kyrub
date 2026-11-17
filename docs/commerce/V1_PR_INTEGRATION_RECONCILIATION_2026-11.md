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

- **Phase 10 integrated validation:** run `44151759920`, job `production-dependency-security` (`134281687780`) **FALHOU** no `npm audit --omit=dev --audit-level=high`. O job `cross-domain-contract` **PASSOU**.
- Auditoria do grafo de dependências de produção: **11 ocorrências (4 altas, 6 moderadas, 1 baixa)** no log; auditoria geral de `npm audit`: **13 ocorrências (6 altas)**. Pacotes que exigem triagem incluem `picomatch@4.0.5`, `path-to-regexp@6.1.0` (subárvore de `@vercel/routing-utils`), `qs@6.16.0` e `fast-xml-parser@5.11.2`, além de cadeias de dependências indiretas. Alguns são de dev; conferir **exatamente** a alcançabilidade no runtime antes de classificar impacto real.
- **Evidência de origem:** o blob do `package-lock.json` é **idêntico** na `main` e na candidata: `f164b893fb6179b122dddc1bedf0bf2ea97ab6f5`. A candidata não criou novo grafo de dependências. Essa falha não demonstra conflito funcional das PRs, **mas impede a aprovação do Beta Gate**.
- Não executar `npm audit fix --force` sem análise: o próprio npm alerta sobre mudanças disruptivas, especialmente ferramentas de roteamento. Fazer remediação **isolada**, com upgrades específicos compatíveis e `package-lock` regenerado, revisão do grafo `--omit=dev`, teste TypeScript, suíte de segurança e prebuild, e validação da preview no HEAD correto quando possível.
- **Ordem:** remediar/auditar vulnerabilidades V0; repetir Phase 10 no SHA conjunto; depois completar a composição com a #1138, sem antecipar Pix real.

**Status deste gate:** `BLOQUEADO_V0_SEGURANCA_DEPENDENCIAS`; **não apto a merge/deploy enquanto persistir a falha**.

