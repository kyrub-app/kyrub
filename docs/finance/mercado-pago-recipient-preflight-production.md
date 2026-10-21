# Mercado Pago — pré-validação do beneficiário em produção (PR isolada)

**Data:** 21/10/2026. **Destino pretendido:** `main` após aprovação específica. **Sem merge/autorização de cobrança nesta preparação.**

## Motivação

O usuário autorizou a conta Mercado Pago da sua loja e validou em produção `/users/me`. A homologação fixa usa metadados Firestore compartilhados, mas não tem acesso ao cofre OAuth protegido da produção. Não copiar a master key ou os tokens para preview.

## Mudanças propostas, restritas ao fluxo existente

- A rota **existente** `POST /api/store-connections/mercado-pago/:storeId/validate` continua exigindo Firebase do proprietário `uid === storeId`. Após `validateMercadoPagoStoreConnection(storeId)` (perfil MP ao vivo), confronta a autoridade canônica `resolveCommercialRecipientAuthority({context:'store_sale',canonicalStoreId:storeId})`: identidade do dono, escopo da credencial, conta recebedora e modo de comissão separada. Divergências falham com 409, sem cobrança.
- Apenas sucesso retorna `{ok:true,recipientPreflightReady:true,checkoutActivated:false,externalAccountId}`; a resposta não promete que Pix foi pago, emitido ou conciliado.
- Permite leitura de loja primária persistida em `users/{uid}/stores/{uid}` quando a cópia `stores/{uid}` não existe, com identidade e escopo explicitamente iguais. Não cria lojas, vinculações ou credenciais.
- Reutiliza o cartão **Recebimentos → Mercado Pago** para apresentar `Pré-validar conta recebedora` e separa o status conectado do resultado do preflight.
- Vercel Preview com Firestore compartilhado passa a ser **read-only** para OAuth. Callback, authorize, validate (pode renovar token) e disconnect são negados fora de `VERCEL_ENV=production`; a interface oculta desconexão nesses ambientes.
- Nenhuma comissão, split, `application_fee`, nova API de pagamentos ou credencial adicional é introduzida.

## Fora do escopo / gates

- **NÃO alterar** `server/payments/mercadoPagoCheckoutBridge.ts`, `mercadoPagoStoreScopedProvider.ts`, `paymentIntentRouter.ts`, os serviços de webhook, pedido, inventário, reembolso, ledger, dados Firestore ou pagamentos históricos.
- **NÃO mergear** em `main` até aprovação humana específica e testes de CI/review. A preview de PR será usada apenas para validar UI/compilação; jamais para chamar endpoints capazes de renovar tokens de Production.
- O endpoint pode atualizar o **token OAuth da mesma conta** somente se o Mercado Pago exigir renovação; não gera Pix nem alteração financeira. Teste real só após autorização de promoção para produção e clique do proprietário autenticado.
- PR #949 (cutover de Pix para token OAuth do lojista) permanece Draft e independente; não promover sem teste Pix controlado com collector, webhook, conciliação e idempotência.
