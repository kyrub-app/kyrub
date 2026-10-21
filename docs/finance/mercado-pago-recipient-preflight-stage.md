# Mercado Pago — pré-validação na homologação fixa (sem cobrança)

- Escopo: copiar somente o endpoint de pré-validação da PR #949, a autoridade canônica necessária, a interface de Recebimentos e seus testes para a branch `feat/profile-react-rebuild`.
- Sem migração do checkout: `server/payments/mercadoPagoCheckoutBridge.ts`, `paymentIntentRouter.ts`, emissão de Pix, webhook, estoque, ledger e produção `main` permanecem intactos neste bloco.
- `POST /api/store-connections/mercado-pago/:storeId/validate` exige Firebase do dono, consulta o perfil /users/me com OAuth, compara identidade do token com a conta recebedora e resolve a autoridade canônica da loja. Em caso positivo retorna `recipientPreflightReady:true` e **`checkoutActivated:false`**; nunca `checkoutReady:true`.
- O botão `Pré-validar conta recebedora` informa sucesso **somente** para essa checagem de vínculo; nenhum Pix e nenhuma liquidação são afirmados.
- A autorização da conta no ambiente Production NÃO comprova que o Preview tem a chave original nem as credenciais necessárias. A UI evidencia `platformConfigured:false`, impede pré-validação quando ausente e não solicita cópia de segredos Production para Preview efêmero.
- Gate automático específico: `tests/marketplace-mp-checkout-preflight.test.ts`, incluindo preservação do checkout antigo na homologação.
- Gate humano posterior: validar sem emitir Pix no link fixo com uma configuração **segura e autorizada** para este ambiente; se não houver acesso OAuth válido, registrar o bloqueio e não inventar sucesso.
- A PR #949 contém a mudança verdadeira do recebedor na emissão Pix; mantê-la Draft até validação separada de QR, collector_id, webhook e conciliação. Nenhum merge para `main` autorizado por este bloco.
