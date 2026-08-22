# Kyrub AI Agent Control Plane

Status: Phase 0 operating specification.

This document operationalizes `AGENTS.md`. It defines agent identities, workstream ownership, contract boundaries, task envelopes, handoffs and execution receipts so multiple agents can work in parallel without silently redefining one another's domains.

## 1. Agent Registry

| Agent ID | Role | Primary workstream | May implement | Independent review | Owner gate |
| --- | --- | --- | --- | --- | --- |
| `lead-orchestrator` | Lead Architect / Orchestrator | E / cross-domain | Architecture, integration, bounded implementation | Yes | Escalates material business decisions |
| `payments-agent` | Payments Engineer | A | Payment/PSP/E2E scope | May review adjacent integration | Real money, credentials, pricing |
| `platform-secrets-agent` | Platform / Secrets Engineer | B | Provider registry, vault integration, secret lifecycle | Security review required | Real credentials, production activation |
| `gamification-agent` | Gamification Engineer | C | Reward/club/challenge foundations | May review product contracts | Economic value/redemption policy changes |
| `ai-platform-agent` | AI Platform Engineer | D | MCP/provider router/BYO provider | Security review required | New external authority or paid provider |
| `qa-security-agent` | QA / Security Reviewer | F | Tests, diagnostics, security fixes in bounded scope | Primary independent reviewer | Destructive/production remediation |
| `compliance-agent` | Compliance Drift Reviewer | G | Technical compliance docs/checks | Primary legal-drift reviewer | Legal conclusions/publication |

External models such as Claude or Gemini may act as independent reviewers when explicitly assigned. They do not acquire repository authority merely by being consulted.

## 2. Workstream Registry

### A — Payments / Marketplace E2E
Priority: `P0 / critical path`.

Owned contracts:
- PaymentIntent lifecycle and payment authority semantics;
- PSP adapter/capability contracts;
- Pix checkout/webhook/refund/settlement semantics;
- marketplace allocations/split representation;
- payment-to-CustomerOrder/KDS handoff.

Must coordinate with B for credential references and provider activation. Must coordinate with F for payment regression/security evidence.

### B — Admin Integrations / Credentials Vault
Priority: `P0 parallel foundation`.

Owned contracts:
- provider registry and environment state;
- secret references and metadata;
- connection validation;
- rotation, revocation and kill switches;
- administrative audit events for integrations.

Does not own PaymentIntent semantics or provider-specific business economics.

### C — Gamification / Clubs
Priority: `P1 parallel foundation`.

Owned contracts:
- Reward Ledger;
- K-Coins/reward accounting;
- XP/levels/badges;
- challenges/evidence;
- Kyrub Clube and Clube da Loja boundaries;
- voucher/reward redemption and anti-fraud contracts.

Does not reinterpret K-Coins as cash, payment balance or AI credits.

### D — External AI / MCP / Provider Router
Priority: `P1`.

Owned contracts:
- external MCP auth/scopes;
- user AI connections and provider routing;
- BYO-provider metadata;
- governed external writes through official Kyrub actions.

Does not grant arbitrary direct datastore access.

### E — AI Operations / Agent Control Plane
Priority: `P0 foundation`.

Owned contracts:
- agent registry;
- workstream registry;
- task ownership/dependencies;
- handoffs/execution receipts;
- agent policy and future persistent execution.

### F — QA / Security / Infrastructure
Priority: `continuous`.

Owned contracts:
- independent validation strategy;
- CI/runtime/deployment evidence;
- security/regression diagnostics;
- infrastructure health and stale-work detection.

Review authority does not imply authority to silently redesign another workstream.

### G — Legal / Compliance / Trust
Priority: `continuous / release-sensitive`.

Owned contracts:
- product/legal drift detection;
- technical consent/versioning requirements;
- privacy/payment/logistics/AI disclosure tracking.

Legal publication and legal conclusions remain human/legal gates.

## 3. Ownership Matrix

Legend: `O` owns contract; `I` may implement within owned scope; `R` independent reviewer; `C` must be consulted when boundary changes; `G` Owner/Governor gate.

| Domain | Lead | Payments | Secrets | Gamification | AI Platform | QA/Sec | Compliance | Human |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Payment lifecycle | C | O/I | C |  |  | R | C | G for real-money policy |
| PSP credentials | C | C | O/I |  |  | R | C | G for real secret/production activation |
| Reward Ledger | C |  |  | O/I |  | R | C | G for material economic policy |
| MCP external authority | C |  | C |  | O/I | R | C | G for material authority expansion |
| Agent control plane | O/I | C | C | C | C | R | C | G for global autonomy policy |
| CI/security evidence | C | C | C | C | C | O/I/R | C | G for destructive production action |
| Legal/public policy | C | C | C | C | C | C | O technical review | G / qualified legal review |

## 4. Boundary Rules

1. An agent may edit shared code only when the task envelope names the shared contract and its owner/dependency.
2. Changing an owned contract from another workstream requires an explicit dependency/handoff; do not smuggle redesign into a feature PR.
3. Shared primitives should remain provider/domain-neutral where possible.
4. UI state never becomes payment authority.
5. Secret metadata may be shared; raw secret material may not.
6. Reward value and financial settlement remain separate domains unless a future approved contract explicitly bridges them.
7. External AI writes must traverse Kyrub's governed action/policy layer.
8. QA may block readiness with evidence; it should not replace product ownership with an unrelated implementation.

## 5. Task Envelope

Every delegated engineering task should carry this minimum contract:

```yaml
task_id: KYRUB-<workstream>-<sequence>
workstream: A|B|C|D|E|F|G
owner_agent: <agent-id>
objective: <bounded outcome>
base_ref: main
base_sha: <resolved at task start>
branch: <new isolated branch>
contracts_touched:
  - <owned/shared contract>
expected_files:
  - <paths or bounded areas>
dependencies:
  - <task/workstream or none>
acceptance_criteria:
  - <observable criterion>
gates:
  - Application build
  - Validate Kyrub
risk: low|medium|high|critical
production_behavior_change: true|false
owner_gate: <reason or none>
```

A task is not authorized to expand itself merely because the agent discovers an interesting adjacent improvement. Record follow-up work instead.

## 6. Agent Handoff

When ownership passes between agents, provide:

```yaml
task_id: <id>
from_agent: <agent-id>
to_agent: <agent-id>
status: ready_for_review|blocked|dependency_ready|superseded
base_sha: <starting sha>
head_sha: <result sha>
contracts_changed:
  - <contract>
evidence:
  tests: <authoritative results>
  ci: <authoritative results or pending>
  runtime: <authoritative results or n/a>
open_dependencies:
  - <dependency or none>
risks:
  - <known risk or none>
next_action: <bounded instruction>
```

Conversation summaries may accompany a handoff but never replace the evidence fields.

## 7. Execution Receipt

Completed/reviewed work should be reducible to an auditable receipt:

```yaml
receipt_id: <stable id>
task_id: <task id>
agent_id: <agent-id>
workstream: <id>
base_sha: <sha>
head_sha: <sha>
pr: <number/url>
result: passed|failed|blocked|superseded
tests:
  - name: <test/gate>
    result: <result>
deployment:
  environment: none|preview|production
  result: <result or n/a>
secret_exposure_check: passed|failed
cross_domain_dependencies:
  - <dependency or none>
recorded_at: <timestamp supplied by authoritative system when available>
```

Do not fabricate timestamps, CI states or deployment evidence.

## 8. Conflict Resolution Protocol

When agents disagree:

1. Freeze the disputed contract; do not merge competing interpretations.
2. Identify the owning workstream and exact invariant in dispute.
3. Compare repository state, tests, CI, authoritative runtime and external provider documentation where relevant.
4. QA/Security independently verifies high-risk factual claims.
5. Lead Orchestrator reconciles engineering/architecture conflicts.
6. Escalate only material business/legal/financial/autonomy decisions to the human Owner/Governor.
7. Record superseded work so stale branches do not later re-enter the release path.

## 9. Branch and PR Convention

Preferred branch prefix by workstream:
- `codex/payments-*`
- `codex/platform-secrets-*`
- `codex/gamification-*`
- `codex/ai-platform-*`
- `codex/ai-ops-*`
- `codex/qa-security-*`
- `codex/compliance-*`

Every new task resolves current `main` at task start. Parallel branches are integrated through explicit PRs, never by treating another agent's unmerged branch as implicit truth.

## 10. Initial Delegation Queue

Once this control-plane foundation is merged/accepted, the first parallel wave is:

1. `payments-agent`: Mercado Pago / marketplace Pix E2E, continuing the validated current payment path rather than reviving stale branches.
2. `platform-secrets-agent`: Credentials Vault foundation in `admin.kyrub.com`; Mercado Pago is the first provider contract, but no real credential is inserted by an agent.
3. `gamification-agent`: domain foundation first — Reward Ledger, K-Coins/XP separation, challenge/reward contracts and anti-fraud invariants before broad UI work.
4. `qa-security-agent`: independent review across the three streams, with special attention to secrets, payment authority, tenant isolation, CI and deploy evidence.

The Lead Orchestrator owns dependency reconciliation and cross-stream integration.
