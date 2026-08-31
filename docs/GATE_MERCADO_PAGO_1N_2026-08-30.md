# Gate Comercial — Mercado Pago Split 1:N

Atualizado em: 2026-08-30

## Estado

**BLOQUEADO CORRETAMENTE POR GATE COMERCIAL.**

A documentação oficial do Mercado Pago informa que o Split 1:N está disponível apenas para vendedores de carteira assessorada que já estejam em contato com a equipe comercial do Mercado Pago.

Fonte oficial:
https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites

## Consequência arquitetural

O Kyrub não deve:

- implementar chamadas de produção supondo que 1:N esteja habilitado;
- representar `deliveryAllocation` ou qualquer outra obligation como dinheiro já repassado;
- usar a conta Kyrub como ponte improvisada para pagar recebedores;
- criar saldo custodial fictício;
- inferir tarifas, limites, KYC ou settlement não formalizados comercialmente.

Enquanto o gate estiver fechado, a arquitetura permanece:

`Payment → Allocation → Obligation → Eligibility → Settlement Adapter → Reconciliation`

O adapter pode possuir contrato provider-agnostic, mas o rail 1:N Mercado Pago permanece indisponível até evidência comercial explícita.

## Evidência necessária para abrir o gate

Antes de implementar/ativar Mercado Pago 1:N, registrar:

1. confirmação formal de elegibilidade da operação Kyrub;
2. produto/conta de integração habilitado para 1:N;
3. modelo de onboarding/KYC dos recebedores;
4. meios de pagamento suportados no contrato específico, incluindo Pix;
5. limites de quantidade/tipo de recebedores;
6. regras de application fee/comissão;
7. política de refund parcial/total;
8. política de chargeback e saldo insuficiente;
9. prazos e mecanismo de settlement;
10. ambiente/contas de homologação e critérios de go-live;
11. custos/tarifas negociados;
12. suporte/SLA e contato comercial responsável.

## Próxima ação do proprietário

Nenhuma ação é necessária agora para o MVP 1:1.

Quando o Kyrub decidir iniciar a qualificação de 1:N com Mercado Pago, o Owner Gate será entrar em contato com a equipe comercial/carteira assessorada e obter confirmação formal das condições acima. Até lá, o desenvolvimento pode continuar com 1:1 e com adapters provider-agnostic.
