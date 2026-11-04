# Mission: prepaid renewal PR #1064

You are a bounded coding executor for Kyrub. Read AGENTS.md first.
Work only on the checked-out branch feat/subscription-renewal-offer-contract.
Goal: verify and complete the merchant prepaid-renewal buyer flow:
merchant proposal -> authenticated buyer acceptance -> safe Pix checkout
-> trusted provider verification -> atomic renewal activation -> UI feedback.

Search before creating. Reuse existing canonical code and tests, especially
server/payments/prepaidRenewal*, api/plan-control.ts,
src/utils/storeSubscription.ts and customer/merchant UI.
Do not duplicate payment flows or change commercial policy.

This pilot is strictly read-only. Produce a detailed audit report with exact files, evidence, prioritized fixes, test plan and blockers. Do not modify repository files or invoke network-connected business systems.
Do not call live Mercado Pago, Firebase production, or Vercel production.
Never deploy, merge, modify production data, send real payments, or read secrets.
Do not change workflows, AGENTS.md, config/secrets, or unrelated modules.
Do not claim a passing test without actual execution evidence.
Stop when the scoped task is validated, or report an explicit blocker.
If a change would require a new real-money integration, external credentials,
production permission, or policy decision, leave it unexecuted and document it.
