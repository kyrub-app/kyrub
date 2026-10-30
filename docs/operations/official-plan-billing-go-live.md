# Kyrub — ativação controlada das assinaturas oficiais

Este procedimento distingue **código publicado** de **cobrança real homologada**. Não ativar o checkout pago só porque o deploy está READY.

## 1. Pré-condições

- Confirmar o último deploy de produção da `main` como READY na Vercel.
- Confirmar no painel administrativo a identidade canônica da **Loja Oficial Kyrub** e o catálogo publicado de produtos de assinatura Free, Pro e Business.
- Verificar que apenas Pro e Business geram checkout pago. Free não deve criar cobrança.
- Confirmar a conta Mercado Pago **da plataforma** que receberá os planos Kyrub; não utilizar credenciais OAuth dos lojistas.

## 2. Variáveis de ambiente (somente pelo painel seguro da Vercel)

Configurar para o ambiente apropriado, sem inserir valores neste repositório:

| Variável | Finalidade |
| --- | --- |
| `KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN` | Credencial da conta recebedora dos planos Kyrub |
| `KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET` | Verificação da assinatura das notificações |
| `KYRUB_PLAN_BILLING_WEBHOOK_URL` | Endpoint HTTPS público de notificações da assinatura oficial |
| `KYRUB_PLAN_BILLING_RETURN_URL` | Retorno do cliente após autorização (opcional; confirmar domínio vigente) |

O serviço `server/admin/paidPlanSubscriptionService.ts` só declara `available: true` quando as três primeiras variáveis existem. Sem elas, o checkout responde `PLAN_BILLING_NOT_CONFIGURED` (HTTP 503). **Não contornar esse bloqueio.**

Após qualquer mudança de ambiente, realizar um novo deploy controlado e verificar a disponibilidade via `GET /api/plan-control?op=plans.billing`, sem expor tokens no navegador ou em logs.

## 3. Rotas e isolamento financeiro

- Plano Kyrub: `/api/plan-control?op=subscription.webhook`, ou a URL compartilhada de webhook com dispatch de eventos de assinatura para `handlePaidPlanProviderWebhook`.
- Assinaturas vendidas por lojistas: `/api/plan-control?op=merchant.subscription.webhook`, com validação de vínculo da conta recebedora.
- Produtos e serviços comuns: manter o fluxo existente do checkout do vendedor. Não redirecionar suas receitas à conta da plataforma.
- Se a URL compartilhada for usada, validar que eventos de pagamento comuns continuam sendo tratados pelo processador existente; nunca cadastrar duas URLs concorrentes sem justificar a necessidade.

## 4. Homologação sem cobrança real

1. Executar os testes automatizados de checkout, roteamento de planos, reservas, webhooks e contratos comerciais.
2. Verificar que ausência de configuração bloqueia o checkout pago e que o plano Free não cria pagamento.
3. Simular notificações válidas, inválidas, repetidas e fora de ordem; verificar assinatura, idempotência e conciliação.
4. Conferir que autorização da assinatura **não** ativa benefício antes de pagamento aprovado e creditado.
5. Verificar cancelamento e atualização do direito de uso, sem afetar contratos de outras lojas.

## 5. Homologação financeira controlada

Somente após autorização explícita para uma transação real, com conta e ambiente definidos:

1. Criar contratação Pro ou Business pela vitrine da Loja Oficial, com preço obtido do catálogo administrativo.
2. Conferir no Mercado Pago o recebedor, a referência externa, a assinatura e a fatura.
3. Confirmar que o direito de uso só é ativado após comprovação do pagamento creditado.
4. Validar notificação duplicada e reconciliação sem gerar benefício ou receita duplicados.
5. Confirmar registro comercial no CRM da Loja Oficial e preservação dos CRMs individuais dos lojistas.
6. Documentar evidências, horários, IDs de teste (sem segredos) e eventual estorno/cancelamento.

## Critério de conclusão

**READY na Vercel + CI verde não equivalem a E2E financeiro aprovado.** Marcar cobrança como homologada somente depois das etapas 2–5 e evidências do recebimento, da conciliação e do entitlement.
