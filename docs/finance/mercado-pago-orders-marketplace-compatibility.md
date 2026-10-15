# Mercado Pago — Modelo B, escolha Payments vs Orders e habilitação Marketplace

**Decisão revisada em 15/10/2026. Status: plano técnico, sem autorização de criação de aplicativo ou ativação de split.** PR #949 permanece Draft e fora da homologação fixa.

## Evidência de produto e documentação

O cadastro interativo no Mercado Pago Developers para **Checkout Transparente** apresentou o seletor de API `Orders` (padrão) ou `Payments`, com aviso de descontinuação futura para Payments. **Não mostrou opção "modelo Marketplace"** até a última tela; não inferir que selecionar "Plataforma de e-commerce" equivale a habilitação de Marketplace. A aplicação legada `Kyrub` já existente é "integração para sua conta" e processou pagamentos históricos; preservá-la.

A documentação oficial sobre migração, conferida em 15/10/2026, esclarece:
- Payments API **ainda não foi desligada**, está em manutenção de segurança/estabilidade; admite coexistência com Orders API.
- A Orders API suporta Pix, mas exige endpoints, contratos de dados, webhook `orders`, estados, idempotência e reembolsos próprios — **não** substitui diretamente `/v1/payments`.
- Na Payments API, a comissão de marketplace 1:1 usa `application_fee` com OAuth do vendedor. Orders **não documenta campo equivalente**; `integration_data.sponsor.id` não é split.
- A Orders API documenta `splits` para 1:N, mas **somente com habilitação/comunicação comercial**, consentimentos e `receiver_id`; não presumir acesso.
- O guia 1:1 cita pagamentos com saldo disponível entre contas Mercado Pago e restrições a transferências externas. **Verificar expressamente com o MP se comissão 1:1 funciona no Pix que o Kyrub pretende emitir**; não afirmar suporte automaticamente.

## Política Kyrub aprovada — Modelo B

1. Recebedor do pagamento da loja = **lojista OAuth**; plataforma só recebe pela própria assinatura e, futuramente, por comissão aprovada e comprovadamente suportada.
2. Sem split habilitado, a comissão de marketplace é **inexistente**, não 0 estimado; não enviar `application_fee`, `marketplace_fee`, `splits` ou repasses artificiais.
3. Transações externas do MP podem ser **espelhadas**, sem novo Pix nem duplicação de ledger.
4. Pagamentos históricos seguem a API/conta de **origem** para consulta, estorno, reembolso e webhook, mesmo depois de uma eventual migração. Não trocar credor ou ID em retry.
5. Para Orders futura, registrar proveniência canônica por provedor, versão da API (`payments_v1` / `orders_v1`), `providerOrderId`, transação/ID e beneficiário, antes de rotear. Sem construir uma segunda camada de caixa/financeiro.
6. O OAuth atual do Kyrub envia `code_challenge` S256 e `code_verifier`. No aplicativo escolhido, a opção PKCE deve estar habilitada, e o redirect URI cadastrado deve coincidir exatamente com `https://kyrub.com/api/store-connections/mercado-pago/callback`. Não mudar a aplicação histórica sem validar os efeitos.

## Gate para criar nova aplicação

**Não clicar em Criar aplicação ainda:** o formulário novo não apresenta o passo Marketplace previsto no guia de Split 1:1. Pedir confirmação pelo suporte/comercial do Mercado Pago **antes de optar por Payments vs Orders**:
- Como habilitar **aplicação Marketplace com OAuth de terceiros** no dashboard atual, quando o formulário só mostra Checkout Transparente + Payments/Orders e omite o modelo Marketplace?
- Para um Pix emitido na conta OAuth do vendedor, `application_fee` é aceito no split 1:1? Se não, quais meios de pagamento são suportados para split?
- O split 1:1 via Orders está disponível para a conta de integrador? Qual campo/autorização/comercial substitui `application_fee` (se existir)? A documentação pública nega equivalência.
- Há sunset date oficial para `/v1/payments`? Qual orientação para marketplaces que ainda dependem de `application_fee`?
- Para 1:N Orders, qual habilitação comercial, consentimento e prazo provável (sem presumir aprovação)?

Se MP confirmar **Payments API + app Marketplace OAuth** para cenário futuro 1:1, a fundação existente da PR #949 é o caminho mínimo para Modelo B imediato **sem comissão**, com uma evolução futura do mesmo checkout. Se somente Orders estiver disponível, abrir uma **PR distinta de migração** preservando Payments para legados e com webhook `orders`, contratos, reembolso, reconciliação e idempotência próprios. Não ativar modo misto silenciosamente.

## Fontes oficiais
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/split-payments-1-n
- https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
