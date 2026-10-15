# Runbook: habilitação OAuth Mercado Pago para recebimentos — Modelo B

Data de auditoria: 14/10/2026 (Brasil). Escopo: projeto Vercel `prj_X7hpqaftcikyA8jAK7Iec8HOkqqp`, homologação `feat/profile-react-rebuild` e PR Draft #949. Nenhuma credencial foi lida, criada ou alterada nesta verificação.

## Estado observado
Em **Recebimentos → Mercado Pago**, a loja exibe "Não conectado" e a mensagem genérica de indisponibilidade. O backend devolve `platformConfigured: false` quando `resolveMercadoPagoPlatformOauthConfig` não encontra simultaneamente `clientId`, `clientSecret` e `redirectUri`.

A lista de **nomes de variáveis Vercel** (sem decrypt, preview + produção) não contém:
- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_REDIRECT_URI`
- `INTEGRATION_MASTER_KEY`
- `PUBLIC_APP_URL`
- `MERCADO_PAGO_WEBHOOK_SECRET`

Existe `APP_URL`, mas **o retorno OAuth consulta `PUBLIC_APP_URL`**, não `APP_URL`. A ausência de variáveis não prova inexistência de documentos no cofre Firestore; todavia, sem `INTEGRATION_MASTER_KEY` o código não consegue descriptografar credenciais previamente guardadas. Se existir material criptografado antigo, **recuperar a chave original**, não gerar outra silenciosamente.

## Configuração administrativa — nenhum lojista precisa informar token manualmente
1. Administrador do Kyrub: acessar a conta de desenvolvedor do **Mercado Pago**, encontrar/criar uma aplicação Marketplace (Checkout API) e obter `Client ID` e `Client Secret` da própria aplicação. Estes dados nunca ficam no browser ou em chats.
2. Escolher um **hostname estável do ambiente** para OAuth. Registrar no Mercado Pago a URL exata `https://<host-autorizado>/api/store-connections/mercado-pago/callback`. O endereço deve resolver para o transporte serverless da loja, e o `redirect_uri` configurado no backend precisa ser **exatamente igual** ao cadastrado no provedor. Não usar URL de deployment temporário para callback.
3. No projeto Vercel, configurar **separadamente no target preview** (e, posteriormente, production com autorização própria) `MERCADO_PAGO_CLIENT_ID`, `MERCADO_PAGO_CLIENT_SECRET`, `MERCADO_PAGO_REDIRECT_URI` e `PUBLIC_APP_URL` (homepage estável com `?app=1` se necessário para o runtime). Alternativamente, configurar `client_id`, `client_secret` e `redirect_uri` no cofre administrativo `platformIntegrationCredentials/mercado_pago__production`, **somente se** a chave existente `INTEGRATION_MASTER_KEY` estiver disponível ao backend e o cofre for governado. Evitar segredos duplicados e configurações divergentes entre vault e env.
4. Confirmar como o servidor obterá **a chave original** `INTEGRATION_MASTER_KEY` para criptografar as autorizações OAuth individuais; mesmo com as três variáveis explícitas do OAuth, o fluxo `beginMercadoPagoStoreAuthorization` e `saveMercadoPagoStoreTokenSecret` precisa dessa chave. Não ativar sem isso.
5. Para liquidação por webhook, configurar no ambiente seguro o segredo oficial `MERCADO_PAGO_WEBHOOK_SECRET` ou a alternativa governada no cofre; habilitar notificação do provedor para `/api/payments/webhooks/mercado-pago`. **Não** utilizar a credencial central histórica para emitir novos Pix dos lojistas.
6. Aplicar a configuração por **novo deployment Vercel após alteração das variáveis**, confirmar READY e versão/URL exata. O botão deve passar de `platformConfigured:false` para `true`. Confirmar autenticação, fluxo OAuth e status da conexão antes de qualquer cobrança.
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
- Documentação oficial: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- OAuth: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
