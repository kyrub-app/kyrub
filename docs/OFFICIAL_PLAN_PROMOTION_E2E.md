## Evolução condicionada — piloto real via cupom, ainda não liberado (17/11/2026)

A [PR #1159](https://github.com/kyrub-app/kyrub/pull/1159) prepara o mesmo mecanismo comercial para **um** pagamento real, mas exige flags separadas e a aprovação humana final. **Business 1 mês (R$ 397) − cupom ERP fixo R$ 396 = R$ 1**; nenhuma mudança no catálogo. O código/ID real do cupom e UID comprador ficam configurados somente no ambiente protegido depois que o segundo perfil existir, jamais no repositório.

Para impedir que a divulgação na Praça torne a oferta resgatável por qualquer pessoa, o ERP passa a aceitar `specific_user` e limite `1/1`; a listagem de promoções públicas continua filtrando esses registros. Apenas o cupom do piloto oficial habilitado por flag pode receber **projeção pública sanitizada sem UID** para o cartão da Praça. A vitrine encaminha código privado para validação **autenticada**, exclusivamente no plano Business canônico, sem descontar outro item ou ignorar o cupom para emitir Pix cheio. O servidor revalida o código exclusivo ao cotar, reservar e imediatamente antes do provider POST. **Não é autorização de cobrança**.

O contrato/assinatura deve persistir `originalTotalMinor=39700`, `discountMinor=39600`, `totalPaidMinor=100`, `plan=business`, `months=1`, início de vigência na aprovação do PSP e CRM/ledger corretos. Limites de segurança: **um UID, uma reserva, uma emissão**, dois perfis em lojas separadas, nenhum acesso a token ou saldo real em teste isolado, sem Pitangas extras. Documentação de operação e gate: [OFFICIAL_PLAN_PIX_RELEASE.md](OFFICIAL_PLAN_PIX_RELEASE.md).

# PR #1138 — Cupom comercial integrado ao checkout oficial, em homologação

## Implementação canônica, sem checkout paralelo

A PR usa as funções e documentos de `server/payments/officialPlanPixCheckout.ts`:
- `quoteOfficialPlanPix` recebe opcionalmente `promotionCode`, encontra o cupom no ERP da Loja Oficial e retorna o **preço final** sem alterar o preço-base autoritativo do produto.
- `acceptOfficialPlanPix` verifica o total aceito, vincula o digest dos termos e reserva o cupom **na mesma transação Firestore** que aceita o checkout.
- `checkoutOfficialPlanPix` valida a reserva e emite o Pix com o preço final. `validatePayment` reconfirma valor, moeda, método, recebedor, referência e digest.
- `materialize` e `materializePendingStoreActivation` registram o valor efetivamente pago nos **contratos, assinaturas, períodos, pagamentos e ledger canônicos**.
- `finalizeOfficialPlanPromotionReservation` resgata o cupom somente após encontrar pagamento confirmado no repositório financeiro canônico. A rejeição de pagamento libera sua reserva.
- O cupom continua sendo criado pelo ERP da Loja Oficial. Não há catálogo paralelo no Control Plane nem projeção alternativa de benefícios.

## Evidência validada em GitHub Actions

Workflow `Official plan canonical Firestore E2E`, na suíte já existente `tests/firestore-official-plan-pix.test.ts`, **9 testes aprovados e 0 falhas** no commit `4f7ce29c` (execução 43871143302).

O cenário Business promocional verifica:
- Preço-base R$ 397,00, desconto ERP R$ 396,00, Pix simulado R$ 1,00.
- Rejeição de callback de R$ 397,00 quando o aceite é de R$ 1,00.
- Dois quotes concorrentes, uma única reserva por limite e idempotência do aceite.
- Quatro reconciliações simultâneas, apenas um contrato, uma assinatura e um pagamento no Firestore canônico.
- Contrato com total pago de 100 centavos, base mensal 39700 e desconto 39600.
- Ledger financeiro com pagamento de R$ 1,00, entitlement Business ativo e vigência iniciada em `date_approved`.
- Resgate único do cupom e liberação do contador de reservas.
- Rejeição financeira devolve a reserva sem registrar contrato nem benefício.
- Reserva aceita sem Pix expira em transação atômica e devolve capacidade; o próprio comprador reabre uma nova cotação.
- Um **segundo comprador** consegue recuperar uma reserva abandonada do mesmo cupom, sem ultrapassar o limite global.
- Reservas com Pix já emitido **não são liberadas** apenas por prazo, mesmo quando outro comprador disputa o cupom.
- Business pago **antes de criar loja** inicia a vigência na confirmação Pix; criação posterior da loja não rebaixa o benefício para Free.

Os testes anteriores da suíte existente cobrem corrida e recuperação de Pix, replays de efeitos, comprador sem loja e criação Free idempotente. Os testes unitários de descontos/termos e os testes existentes do agendador canônico complementam essa cobertura.

## Handoff visual da Praça para os planos canônicos

A PR utiliza a mesma interface existente `InitialPrepaidSubscriptionCheckout` e o mesmo cliente `src/utils/storeSubscription.ts`. Não há carrinho novo:
- `StorePromotionsManager` compartilha na Praça o link público `/@slug?coupon=CODE`.
- `PublicStorefrontApp` identifica **somente a Loja Oficial e os IDs canônicos Pro/Business** por `shared/officialPlanCanonicalDisplay.ts` (as mesmas constantes usadas pelo backend), consulta as promoções públicas para localizar os produtos associados e apresenta a contratação de planos na vitrine.
- Um plano clicado na vitrine seleciona o checkout pré-pago, sem entrar no carrinho B2C. Produtos e serviços comuns continuam no carrinho; itens oficiais de planos salvos anteriormente são removidos desse carrinho.
- A mesma `official.prepaid.quote` recebe o código opcional `promotionCode` no servidor, e o mesmo componente de aceite/Pix exibe preço original, desconto ERP e total cobrado. Código inválido ou sem produto de plano participante **não é omitido silenciosamente** para cobrar o preço integral.
- Teste de interface em `tests/official-plan-praca-storefront-routing.test.ts`: verifica o roteamento das ligações existentes e renderiza o **card real de contrato pré-pago** com preço-base R$ 397,00, desconto R$ 396,00 e total R$ 1,00, sem chamadas de rede. A suíte canônica Firestore é executada em seguida no mesmo workflow.

**Chromium com clique real no mural — PASS:** [workflow 43887934027](https://github.com/kyrub-app/kyrub/actions/runs/43887934027), commit `77c368d8`. O teste `tests/official-plan-praca-playwright-smoke.mjs` cria um post **fictício** em `social_posts` com a mesma referência `storePromotion` utilizada pelo ERP, autentica usuário fictício no Firebase Auth Emulator, abre o aplicativo pela navegação `Praça`, encontra o **cartão real do cupom**, clica em `Aproveitar cupom` e chega à vitrine oficial com `?coupon=BIZ1`. A descoberta da vitrine, a listagem pública dos cupons e o detalhe do cupom passam pelos endpoints Express reais em localhost; a cotação/aceite/Pix são **respostas fictícias interceptadas somente na fronteira HTTP do checkout**. Também verifica R$ 397 / R$ 396 / R$ 1, token de autenticação na solicitação, aceite de 100 centavos e ausência de pagamento gravado ou Firebase produtivo. [Capturas do mural, desktop e celular](https://github.com/kyrub-app/kyrub/actions/runs/43887934027/artifacts/14235258140).

**Limites:** a vitrine só mostra planos se os produtos canônicos estiverem publicados; produtos reais continuam em rascunho. Não houve publicação, cobrança real ou teste do provedor Mercado Pago neste workflow. O Browser E2E demonstra o caminho social→comercial, e o Firestore E2E separado demonstra a transação financeira canônica.

## Limites e pendências para lançamento

- **Isolamento obrigatório:** Business com cupom R$ 1,00 só é permitido com Firestore Emulator em localhost, `KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST=true`, token fictício `isolated-platform-token` e gates de piloto. Produção mantém somente o piloto Pro sem desconto, e o checkout real permanece desativado até autorização.
- Não testar com pagamento real, não habilitar flags produtivas, não efetuar merge/deploy.
- A navegação clique-a-clique no Chromium, começando na Praça, está validada em **ambiente totalmente isolado**. Os produtos canônicos reais não foram publicados; a regra do servidor continua proibindo vender planos pelo carrinho B2C.
- **Recuperação de reservas:** `quoteOfficialPlanPix` reabre reservas válidas do mesmo comprador ou expira atomicamente a cotação não emitida; `acceptOfficialPlanPix` recupera reservas expiradas de outros compradores quando há nova demanda, usando a consulta indexada em `promotionReservations` (até 125 candidatos por chamada). A confirmação de Pix rejeitado devolve a reserva. **Pagamentos `bound`, `in_flight` ou `outcome_unknown` não são liberados por tempo**: exigem resultado financeiro verificável.
- O mecanismo é **sob demanda**, não uma varredura agendada de todas as campanhas; limpeza operacional global sem novos compradores ainda não foi implementada. O índice composto está declarado em `firestore.indexes.json` para futura implantação autorizada.
- A jornada integrada **primeiro login → 100 Pitangas → Free → primeira publicação → 2 XP → cupom → Business** ainda não está comprovada como um único E2E. O clique no cupom já passou em Chromium; a PR #1137 permanece separada e draft, com pendência de atestação Firebase. Não duplicar writers, ledgers ou lógica de gamificação para fazer essa PR passar.
- Antes de remover o gate isolado, exigir revisão independente do cálculo, do recebedor, da idempotência e dos contratos canônicos.

## Decisão de arquitetura

Não restaurar os adaptadores e coleções `isolated_promotion_*` removidos. O Firebase Emulator simula armazenamento local e a fronteira Mercado Pago; as regras comerciais, as transações e os efeitos de pagamento são os mesmos módulos reais do Kyrub.
