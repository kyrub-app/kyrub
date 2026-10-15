# Runbook: habilitação OAuth Mercado Pago para recebimentos — Modelo B

Data de auditoria: 14/10/2026 (Brasil). Escopo: projeto Vercel `prj_X7hpqaftcikyA8jAK7Iec8HOkqqp`, homologação `feat/profile-react-rebuild` e PR Draft #949. Nenhuma credencial foi lida, criada ou alterada nesta verificação.

**Revisão de 15/10/2026:** a aplicação Kyrub de Checkout Transparente + Payments já existe. Reaproveitá-la antes de considerar outra; a menção a “Marketplace” em guias legados não comprova a existência de um seletor obrigatório no painel novo. Revisão apenas documental: nenhuma credencial ou cobrança alterada.

## Estado observado
Em **Recebimentos → Mercado Pago**, a loja exibe "Não conectado" e a mensagem genérica de indisponibilidade. O backend devolve `platformConfigured: false` quando `resolveMercadoPagoPlatformOauthConfig` não encontra simultaneamente `clientId`, `clientSecret` e `redirectUri`.

A inspeção de 14/10 dos **nomes de variáveis de projeto Vercel** (sem decrypt, preview + produção) não encontrou:
- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_REDIRECT_URI`
- `INTEGRATION_MASTER_KEY`
- `PUBLIC_APP_URL`
- `MERCADO_PAGO_WEBHOOK_SECRET`

Existe `APP_URL`, mas **o retorno OAuth consulta `PUBLIC_APP_URL`**, não `APP_URL`. Verificação posterior identificou `INTEGRATION_MASTER_KEY` em variáveis **Shared de Production**, fora da lista inicial de variáveis do projeto; isso **não comprova** sua disponibilidade em Preview. A ausência na listagem não prova inexistência de credenciais no cofre Firestore. **Preservar a chave original** usada para criptografar tokens; nunca gerar outra silenciosamente.

## Configuração administrativa — nenhum lojista precisa informar token manualmente
1. Administrador do Kyrub: em Mercado Pago Developers, **localizar e reaproveitar primeiro a aplicação Kyrub existente** (Checkout Transparente + Payments API). Conferir em Configuração avançada Redirect URI, PKCE S256 e escopos `read`, `offline_access`, `write`. Não criar outra aplicação apenas porque não existe um seletor “Marketplace”. Informar Client ID/Secret exclusivamente no painel administrativo autenticado, nunca no chat ou em logs.
2. Em Production, conferir a URL de retorno exata `https://kyrub.com/api/store-connections/mercado-pago/callback`, sem parâmetros. O `redirect_uri` do backend deve coincidir exatamente com o cadastrado no Mercado Pago. Para testes em Preview, exigir host estável e autorizado com configuração própria; não usar URL de deployment temporário como callback.
3. Em **Production**, preferir `admin.kyrub.com → Integrações & Infraestrutura → Mercado Pago · OAuth de lojistas` para cadastrar a aplicação existente no cofre `platformIntegrationCredentials/mercado_pago__production`, após verificar disponibilidade da **chave original** `INTEGRATION_MASTER_KEY` no backend. Quando necessário, as variáveis explícitas `MERCADO_PAGO_CLIENT_ID`, `MERCADO_PAGO_CLIENT_SECRET`, `MERCADO_PAGO_REDIRECT_URI` e `PUBLIC_APP_URL` podem ser usadas com governança, sem fontes divergentes. Em **Preview**, não presumir acesso ao vault nem copiar a master key de Production para deploys efêmeros; qualquer configuração de teste precisa de isolamento e autorização próprios.
4. Confirmar como o servidor obterá **a chave original** `INTEGRATION_MASTER_KEY` para criptografar as autorizações OAuth individuais; mesmo com as três variáveis explícitas do OAuth, o fluxo `beginMercadoPagoStoreAuthorization` e `saveMercadoPagoStoreTokenSecret` precisa dessa chave. Não ativar sem isso.
5. Para liquidação por webhook, configurar no ambiente seguro o segredo oficial `MERCADO_PAGO_WEBHOOK_SECRET` ou a alternativa governada no cofre; habilitar notificação do provedor para `/api/payments/webhooks/mercado-pago`. **Não** utilizar a credencial central histórica para emitir novos Pix dos lojistas.
6. Após qualquer **alteração de variáveis Vercel**, executar novo deployment do target correto e confirmar READY, SHA e URL exata. Caso a configuração ocorra somente no cofre, validar o status diretamente antes de presumir a necessidade de redeploy. Confirmar `platformConfigured:true`, autorização OAuth e status da conexão antes de cobrar.
7. Verificar com a ferramenta de pré-verificação da PR #949 (apenas na preview da PR) se `/users/me` coincide com a conta de beneficiário resolvida para a loja, sem pagamento. Só então executar **um** cenário Pix controlado, com aprovação explícita, verificando collector, binding, evento assinado, conciliação e idempotência.
8. Manter PR #949 Draft e produção intacta até gates manuais da conta recebedora; split 1:1 permanece DESATIVADO.

## Fluxos que não devem ser confundidos
- **Mercado Livre**: catálogo/anúncios/pedidos externos; configuração separada.
- **Pix próprio**: emissão de QR pela chave Pix cadastrada pelo lojista, sem autorizar a conta via OAuth do Mercado Pago. Não equivale à conciliação MP.
- **Mercado Pago OAuth do lojista**: autorização para emitir cobrança Pix na conta do vendedor, validar o collector e consultar evidências.

## Referências técnicas
- `server/integrations/mercadoPagoStoreOauthService.ts`, `resolveMercadoPagoPlatformOauthConfig` e `beginMercadoPagoStoreAuthorization`.
- `server/integrations/secretVault.ts` (`INTEGRATION_MASTER_KEY`).
- `server/integrations/mercadoPagoStoreRouter.ts` (`PUBLIC_APP_URL` e callback).
- `server/integrations/storeConnectionsServerlessTransport.ts` (roteamento do callback).
- Fluxo marketplace com OAuth: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/how-tos/integrate-marketplace
- Guia legado com seletor “Marketplace” (divergência documental): https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- OAuth: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
