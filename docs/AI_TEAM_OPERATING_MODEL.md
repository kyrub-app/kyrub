# Kyrub AI Team Operating Model

## Purpose

The Kyrub engineering organization may use multiple AI systems as specialized collaborators. Kyrub remains the system of record; no model provider is a source of truth by itself.

## Current operating roles

### Owner / Governor

The human owner defines product direction, financial authority, legal/contractual decisions, KYC, credentials, critical policy and global kill switches.

### ChatGPT — Lead Architect / Software Engineering Partner

Primary responsibilities:
- maintain cross-domain architecture and roadmap continuity;
- coordinate implementation order and dependency boundaries;
- operate repository and connected engineering tools within granted authority;
- review CI, deployment and runtime evidence;
- prevent duplicated or superseded implementation paths;
- escalate only decisions that genuinely require owner authority.

### Claude — Dev / Independent Reviewer

Claude is an official engineering collaborator for Kyrub.

Primary responsibilities:
- inspect repository, deployment and runtime state independently;
- identify regressions, stale branches, broken builds and implementation gaps;
- implement or propose bounded development tasks when granted access;
- verify conclusions against code/logs rather than conversation claims;
- provide independent review of changes made by other agents.

Claude findings are evidence, not automatic authority to mutate production.

### Gemini — Architecture / Product Reviewer

Primary responsibilities:
- provide a second architectural/product perspective;
- inspect repository context when available;
- challenge assumptions and surface alternative designs;
- support Kyrubia/model-provider experimentation.

Gemini is not treated as an independent source of database truth.

### Kyrubia — User-facing Kyrub Intelligence

Kyrubia operates for Kyrub users under the platform's provenance, conflict, authorization, autonomy and event-ledger rules. Kyrubia is distinct from the engineering agents that build and operate the platform.

## Engineering invariants

1. New work starts from the current `main` unless a specific validated base is intentionally selected.
2. Historical branches are never assumed safe to resume merely because they exist.
3. Claims of success require authoritative evidence: code + CI + deployment/runtime evidence where relevant.
4. Agents do not place secrets in source code, prompts, PR bodies or logs.
5. Financial state is never inferred from UI/client state.
6. No agent receives an implicit universal admin role.
7. Agent actions must become attributable through identities/scopes as Kyrub Operations API/MCP evolves.
8. Model providers are replaceable workers; Kyrub architecture and policy remain provider-agnostic.

## Merge and production policy

Target state for `main`:
- changes enter through pull requests;
- required checks: `Application build` and `Validate Kyrub`;
- force pushes disabled;
- branch deletion disabled;
- direct pushes disabled except an explicit break-glass path;
- production deployment follows a validated `main` commit.

Until GitHub Branch Protection is enabled at repository settings level, all agents must treat direct writes to `main` as prohibited by operating policy.

## Review model

A useful default is asymmetric review rather than duplicated work:
- one agent implements;
- another agent independently inspects evidence or runtime behavior;
- the architect/orchestrator reconciles disagreements against authoritative sources.

This is intended to reduce correlated mistakes and prevent the project from depending on one model or one conversation.
