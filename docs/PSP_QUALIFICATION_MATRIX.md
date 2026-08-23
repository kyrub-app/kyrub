# PSP Qualification Matrix — Kyrub

Updated: 2026-08-23

This document closes the research foundation for official battery items #20 and #21. It records only capabilities evidenced by current official provider documentation. Commercial availability, pricing and production enablement must still be confirmed with each provider before activation.

## Decision summary

For the current MVP path, Mercado Pago remains the preferred first rail for 1:1 marketplace payments because Kyrub already has provider, Pix, webhook, Vault and OAuth foundations and Mercado Pago officially documents seller OAuth plus marketplace fee/application fee for 1:1 split.

Mercado Pago 1:N must remain behind a commercial gate. Current official documentation states that 1:N is available only to sellers with an advised portfolio already in contact with Mercado Pago's commercial team. Therefore no agent may infer that Kyrub is enabled for 1:N from API documentation alone.

PagBank and Pagar.me remain qualified candidates for a future Settlement Adapter because both officially document split payment capabilities, including Pix. They require separate commercial/onboarding validation before production use.

## Matrix

| Capability | Mercado Pago | PagBank | Pagar.me |
| --- | --- | --- | --- |
| Pix | Yes | Yes | Yes |
| Marketplace seller onboarding | OAuth-documented for 1:1 | Seller/receiver onboarding documented; commercial setup may apply | Recipient model documented |
| OAuth | Yes for seller authorization in 1:1 marketplace | Application/seller authorization exists in provider model; exact production flow requires provider confirmation | Not used as the core recipient model in the reviewed split docs; recipient onboarding is the documented primitive |
| 1:1 split | Yes | Yes | Yes |
| 1:N split | Commercially gated; advised portfolio only | Multi-receiver split documented, up to 15 receivers in current Orders/Payments docs | Multiple recipients documented; availability only for PSP clients |
| Pix split | Must be validated against the exact checkout/product selected before launch | Yes | Yes |
| Partial/total refund | Documented for marketplace 1:1 with proportional effects and seller balance caveats | Supported in split flows; exact liability depends on model | Pix refunds can be total or partial; split reconciliation requires provider contract validation |
| Webhook/events | Yes | Yes in Orders/Payments platform | Yes in Orders/API platform |
| KYC / recipient requirements | Seller account KYC 6 documented for MP 1:1 | Receiver/account onboarding required | Recipient identity/bank account data required |
| Sandbox/test | Test accounts documented | Provider test environment must be confirmed for selected split product | Provider test environment must be confirmed for selected PSP contract |
| Production commercial gate | 1:1 requires valid marketplace application + seller OAuth; 1:N requires commercial relationship | Commercial/support contact is explicitly referenced for split details and some features | Split is explicitly available only for PSP clients |

## Provider notes

### Mercado Pago

Official documentation reviewed:
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace

Operational conclusions:
- seller authorization is OAuth-based;
- Checkout Transparente uses seller OAuth access token server-side and `application_fee` for marketplace commission;
- Checkout Pro uses `marketplace_fee`;
- seller KYC 6 is documented as a prerequisite;
- 1:N is not an automatic technical capability for every integration; it is commercially restricted to advised-portfolio sellers already engaged with Mercado Pago commercial staff.

### PagBank

Official documentation reviewed:
- https://developer.pagbank.com.br/docs/servicos-de-pedidos-e-pagamentos
- https://developer.pagbank.com.br/reference/divisao-de-pagamento
- https://developer.pagbank.com.br/reference/como-utilizar-a-divisao-de-pagamento

Operational conclusions:
- split is supported for credit card, boleto and Pix;
- current Orders/Payments documentation states up to 15 receivers;
- fixed or percentage split is supported;
- settlement occurs into PagBank accounts of the receivers;
- commercial/support contact is explicitly referenced for split details and authorization-sensitive capabilities.

### Pagar.me

Official documentation reviewed:
- https://docs.pagar.me/docs/pedidos-com-split
- https://docs.pagar.me/reference/recebedores-1
- https://docs.pagar.me/docs/pix-1

Operational conclusions:
- split supports multiple recipients using amount or percentage rules;
- recipients must be created and associated with banking/settlement data;
- Pix supports split and total/partial refund;
- current documentation explicitly states that Split is available only for PSP clients, so commercial qualification is mandatory.

## Kyrub gate policy

1. MVP marketplace payments target Mercado Pago 1:1 first.
2. No 1:N adapter may be marked `production_ready` until provider commercial approval is documented.
3. No provider capability may be inferred from a generic API feature if the provider documents a contractual/portfolio restriction.
4. Settlement Adapter remains PSP-independent; selecting one PSP must not rewrite Payment/Allocation/Ledger authority.
5. Recipient/seller KYC and onboarding are provider-owned gates and must not be bypassed or simulated by Kyrub.
6. Pricing, MDR, settlement timing, reserves, chargeback liability and support SLA are commercial facts and must be refreshed before production launch.

## Item #21 — Mercado Pago 1:N Commercial Gate

Status: **blocked by commercial qualification, not by code**.

Current official Mercado Pago documentation says 1:N is available only to sellers with an advised portfolio who are already in contact with Mercado Pago's commercial team. The Kyrub implementation must therefore keep 1:N disabled unless a human records provider approval/eligibility evidence.

This gate does not block the MVP 1:1 path.
