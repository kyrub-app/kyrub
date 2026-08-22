# Kyrub AI Development Team

This file is the repository-level operating contract for AI engineering agents working on Kyrub. Read it before changing code.

## Authority

- The human Owner/Governor defines product direction and retains financial, legal, credential, KYC and break-glass authority.
- ChatGPT acts as Lead Architect / Orchestrator for cross-domain sequencing, dependency management and integration.
- Specialized implementation/review agents operate only inside explicitly assigned scopes.
- Kyrubia is the user-facing intelligence of the product and is not an engineering super-admin.

## Non-negotiable engineering rules

1. Start new work from current `main`, unless the task explicitly names another validated base.
2. Never resume an old branch merely because it exists.
3. One workstream = one bounded branch/PR. Do not mix unrelated features.
4. Do not push directly to `main`. Use a PR and required gates.
5. Do not merge based on conversational claims. Require authoritative evidence from code, tests, CI and deployment/runtime where relevant.
6. Never put secrets, API keys, tokens, credentials or private keys in source, prompts, PR descriptions, comments, fixtures or logs.
7. Never infer financial truth from browser/UI state. PSP/webhook/server-authoritative state owns payment confirmation.
8. Do not bypass Kyrub's official action/policy layers to write directly to deterministic business state.
9. Preserve tenant isolation, provenance, idempotency, conflict handling, event ledger and autonomy policies.
10. Prefer provider adapters and capability contracts over coupling Kyrub to a single PSP, LLM or logistics provider.
11. If a task crosses another active workstream's contract, stop at the boundary and raise the dependency instead of silently redesigning it.
12. Production-affecting work needs a rollback/kill-switch story appropriate to its risk.

## Current workstreams

### A — Payments / Marketplace E2E
Owner: Lead Architect / Payments Agent.

Scope: PaymentIntent, PSP adapters, Pix, webhook authority, allocations/split, refunds, settlement, CustomerOrder materialization, KDS handoff and the X-Burger end-to-end path.

Current priority: critical path.

### B — Admin Integrations / Credentials Vault
Owner: Platform / Secrets Agent.

Scope: `admin.kyrub.com` provider registry, sandbox/production separation, secret references, masked metadata, connection tests, rotation/revocation, audit events and provider kill switches.

Invariant: raw secrets must not be persisted in ordinary Firestore documents or returned to the browser after storage.

### C — Gamification / Clubs
Owner: Gamification Agent.

Scope: Kyrub Clube, Clube da Loja, K-Coins, XP, challenges, evidence, vouchers, Reward Ledger, anti-fraud and sponsored rewards.

Invariant: K-Coins are not money; XP is not K-Coins; store-local loyalty value is not automatically global K-Coins; AI/infrastructure capacity is not K-Coins.

### D — External AI / MCP / Provider Router
Owner: AI Platform Agent.

Scope: external MCP, OAuth/scopes, active connections, user-selected AI providers, BYO-provider and governed external writes through the official Kyrub Action Layer.

Invariant: external agents never receive direct arbitrary Firestore access.

### E — AI Operations / Agent Control Plane
Owner: Lead Architect / Orchestrator.

Scope: agent identities, scopes, task ownership, dependency graph, handoffs, review policy, execution receipts and future persistent/cloud execution.

### F — QA / Security / Infrastructure
Owner: QA/Security Agent; independent review may be performed by Claude or another model.

Scope: CI, Vercel/runtime evidence, Firestore Rules, regressions, dependencies, stale branches/PRs, performance and security posture.

### G — Legal / Compliance / Trust
Owner: Compliance Agent with human/legal review for legal conclusions.

Scope: Terms, Privacy Policy, LGPD, consent/version history, payment/logistics/AI disclosures and drift detection between shipped product behavior and legal documents.

Invariant: AI review does not replace qualified legal review where required.

## Parallel-work protocol

Before implementation, each agent must identify:
- workstream and bounded objective;
- files/contracts expected to change;
- dependencies on other workstreams;
- acceptance criteria;
- tests/gates required;
- whether production behavior changes.

Agents should prefer asymmetric review: one implements, another independently verifies high-risk behavior. Avoid duplicating the same implementation in multiple branches.

## Merge readiness

A PR is not ready merely because code compiles. At minimum:
- relevant tests pass;
- `Application build` and `Validate Kyrub` pass when applicable;
- new behavior has regression coverage appropriate to risk;
- no secret is introduced;
- architecture invariants remain intact;
- production/runtime evidence is checked for production-facing changes;
- superseded branches/PRs are identified rather than left as competing implementations.

## Owner escalation

Escalate to the human Owner/Governor when a decision changes:
- real-money exposure or commercial pricing;
- legal/contractual commitments;
- credentials/KYC/account ownership;
- irreversible production data;
- global autonomy/kill-switch policy;
- product direction with material business consequences.

Do not escalate routine engineering sequencing that is already covered by these rules.

## Source of truth

Kyrub's deterministic state, repository, CI and authoritative runtime evidence outrank any model's memory or narrative. When agents disagree, reconcile against those sources.

See also `docs/AI_TEAM_OPERATING_MODEL.md` for the broader team model.