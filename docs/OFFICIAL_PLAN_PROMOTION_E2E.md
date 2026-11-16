# PR #1138 — Integração de cupom ao checkout canônico (pendente)

## Correção de rumo
Os adaptadores de confirmação Pix, anexação e ativação Business **paralelos**, suas coleções de contratos/benefícios simulados e o workflow que os exercitava foram removidos desta branch. Passar nesses testes não comprovava o funcionamento de `officialPlanPixCheckout.ts`.

## Código reaproveitável ainda nesta PR
- Cotação e leitura dos cupons comerciais existentes no ERP da Loja Oficial.
- Snapshot imutável dos termos comerciais aceitos, validação do valor do provedor.
- Helpers transacionais de reserva e finalização do cupom.
- Testes unitários dessas regras.

**Esses helpers ainda não estão integrados ao checkout canônico; não publicar nem realizar merge.**

## Integração necessária no código já utilizado
O fluxo autoritativo é `server/payments/officialPlanPixCheckout.ts`: `quoteOfficialPlanPix`, `acceptOfficialPlanPix`, `checkoutOfficialPlanPix`, `validatePayment`, `reconcileLoaded` e `materialize`. Hoje ele calcula, aceita, cobra e registra `d.offer.quote.totalMinor`, e o gate de piloto permite somente Pro mensal integral.

1. Resolver o cupom do ERP no servidor e incorporá-lo ao snapshot/digest da **oferta canônica**, preservando separadamente preço-base e total final.
2. Propagar o **mesmo total final aceito** para aceite, corpo Pix, verificação do provedor, pagamento canônico, contrato e ledger; rejeitar divergências. Não permitir caminho genérico do Marketplace para planos oficiais.
3. Integrar reserva e consumo do cupom às transações existentes, com idempotência, liberação de reservas e proteção contra reuso do pagamento.
4. Testar **as funções reais acima** no Firebase Emulator, com o provedor Mercado Pago simulado na fronteira de rede, sem projetar contratos em coleções alternativas.
5. Confirmar no serviço canônico a vigência iniciada na aprovação do pagamento, inclusive comprador sem loja, e ausência de contratos duplicados.

## Limites e segurança
Não habilitar `KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED`, não ampliar o piloto Business R$1 em produção, não alterar credenciais, não criar lojas reais, não fazer cobranças reais e não efetuar merge/deploy. A PR #1137 (100 Pitangas) mantém sua atestação independente. A jornada visual Praça/Free/2 XP não foi comprovada nesta PR.
