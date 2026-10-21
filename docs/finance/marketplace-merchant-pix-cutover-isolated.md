# Model B — Pix do lojista (extração isolada)

**Escopo:** nova venda da vitrine usa a conta OAuth autorizada da própria loja. As assinaturas do Kyrub continuam na conta da plataforma. Esta branch é apenas uma PR Draft, sem cobrança nem promoção para produção.

## Autoridade e fluxo
- Pedido marketplace **accepted** e ainda não pago: congelar snapshot comercial antes de criar Pix.
- Resolver conta recebedora canônica e conferir `/users/me` da conta OAuth antes do POST. Conferir o `collector_id` da resposta após criação: divergência impede exposição do QR Code e gravação de vínculo.
- Preservar `X-Idempotency-Key`, valor calculado no servidor, e o vínculo entre `paymentIntentId`, `paymentId`, loja e ID do Mercado Pago.
- **Pix histórico já emitido** sem vínculo continua sendo somente reconsultado com a credencial original da plataforma, sem reemissão. Pix com vínculo é consultado na conta do lojista. Nenhuma tentativa de retomar pagamento já existente cria outro Pix.
- Webhook mantém verificação HMAC; o pagamento vinculado é recuperado usando o vínculo persistido da conta recebedora, com tratamento de duplicados existente. Não mudar ledger, inventário ou status fiscal neste bloco.
- **Preview e desenvolvimento não podem emitir novos Pix marketplace**. Somente `VERCEL_ENV=production` poderá chamar o novo emissor após aprovação e deploy em `main`.
- Quando faltar OAuth válido, falhar fechado, sem recorrer ao token da plataforma para novas vendas. Conta do lojista não coincide? bloquear QR para revisão.

## Split
**Split 1:1**: **DESATIVADO**; sem `application_fee` ou `marketplace_fee` no checkout. **Split 1:N** e **carteira assessorada**: evolução futura independente. A assinatura do plano do próprio Kyrub permanece faturada diretamente pela plataforma.

## Modelo multi-loja e fases de liberação

- O **piloto de uma única loja** é provisório: `KYRUB_MP_MERCHANT_PIX_ENABLED=true` + `KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE=canary` + `KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID` para o primeiro teste financeiro autorizado.
- Após concluir os gates e autorizar a expansão, `KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE=connected_stores` permite a emissão por todas as lojas com **sua própria** autorização Mercado Pago válida. Cada venda usa a conexão vinculada àquela loja, confere `/users/me` e `collector_id` e grava o vínculo ao pagamento daquela loja.
- O estado padrão continua **desativado**; modo omitido ou desconhecido também falha fechado. A aplicação central OAuth pertence ao Kyrub, mas **nenhum token, conta recebedora ou resultado financeiro é compartilhado entre lojistas**.
- **Limite estrutural atual:** o router OAuth exige `identity.uid === storeId` e o escopo canônico exige `credentialScopeId === ownerUserId`. Portanto, a implementação atual suporta a loja principal associada a cada proprietário, mas **não comprova múltiplas lojas distintas pertencentes ao mesmo usuário**. Esse cenário exigirá separar `storeId`/`ownerUid`, autenticação e cofre por loja, com migração e testes de isolamento próprios, antes de ser anunciado como suportado.

## Gates
1. Compilar, rodar testes de contratos de beneficiário, pedido pendente/aprovado, cupom, idempotência, fallback histórico, webhook e conciliação financeira.
2. Preview Vercel READY **não constitui teste financeiro real**.
3. Revisar comissionamento/split desativados, permitir apenas alteração restrita aos adaptadores e testes.
4. Solicitar aprovação explícita antes de merge em produção. Depois, um único teste Pix real controlado com valor/beneficiário/collector_id, webhook, idempotência, CMV/estoque, conciliação e reembolso; **não repetir cobranças cegamente**.

Este recorte não altera senhas, cofre, regras Firestore, checkout dos planos Kyrub nem informações de pedidos antigos.
