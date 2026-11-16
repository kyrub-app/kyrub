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

**Limites:** a vitrine só mostra planos se os produtos canônicos estiverem publicados; publicação de produtos de produção não foi feita. A própria API mantém os cupons de planos bloqueados fora do Firebase Emulator com token fictício. O teste de roteamento/renderização ainda não é uma prova de clique-a-clique em navegador real.

## Limites e pendências para lançamento

- **Isolamento obrigatório:** Business com cupom R$ 1,00 só é permitido com Firestore Emulator em localhost, `KYRUB_OFFICIAL_PROMOTION_ISOLATED_PIX_TEST=true`, token fictício `isolated-platform-token` e gates de piloto. Produção mantém somente o piloto Pro sem desconto, e o checkout real permanece desativado até autorização.
- Não testar com pagamento real, não habilitar flags produtivas, não efetuar merge/deploy.
- O roteamento e o card de contratação na vitrine já estão implementados e cobertos por teste de interface; ainda falta a verificação **clique-a-clique em navegador** e a publicação de produtos em ambiente de homologação. A regra do servidor continua proibindo vender planos pelo carrinho B2C.
- **Recuperação de reservas:** `quoteOfficialPlanPix` reabre reservas válidas do mesmo comprador ou expira atomicamente a cotação não emitida; `acceptOfficialPlanPix` recupera reservas expiradas de outros compradores quando há nova demanda, usando a consulta indexada em `promotionReservations` (até 125 candidatos por chamada). A confirmação de Pix rejeitado devolve a reserva. **Pagamentos `bound`, `in_flight` ou `outcome_unknown` não são liberados por tempo**: exigem resultado financeiro verificável.
- O mecanismo é **sob demanda**, não uma varredura agendada de todas as campanhas; limpeza operacional global sem novos compradores ainda não foi implementada. O índice composto está declarado em `firestore.indexes.json` para futura implantação autorizada.
- Falta validar a jornada de primeiro login (100 Pitangas, dependente da PR #1137), publicação da primeira loja (2 XP) e clique no cupom pela interface.
- Antes de remover o gate isolado, exigir revisão independente do cálculo, do recebedor, da idempotência e dos contratos canônicos.

## Decisão de arquitetura

Não restaurar os adaptadores e coleções `isolated_promotion_*` removidos. O Firebase Emulator simula armazenamento local e a fronteira Mercado Pago; as regras comerciais, as transações e os efeitos de pagamento são os mesmos módulos reais do Kyrub.
