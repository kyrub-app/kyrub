# Global challenge administrative API

Workstream: Gamification / Clubs. Continuation of PR #1124, based on `29f5c15f`.
No UI, public catalog endpoint, payment change, deployment or merge is included.

## Reuse and boundaries

Searched `server/admin`, `server/ai`, `server/gamification`, `shared/*Challenge*`,
`shared/gamification.ts`, `api/admin/operations/health.ts`, `server.ts`,
`firestore*.rules`, `tests/*gamification*` and `tests/*challenge*`.

- `authorizeIntegrationReadiness` owns the existing active Super Admin check:
  verified Firebase signature/project/email and the server-owned Control Plane profile.
  Reused as-is; client roles and token role claims cannot grant access.
- `verifyFirebaseIdToken` is the existing certificate-based verifier. This write
  boundary additionally rejects expired tokens even within its clock-skew tolerance.
- `assertKyrubChallengeDefinition` and `globalChallengeLifecycle` remain the canonical
  definition and lifecycle validators. Extended runtime definition checks; the new
  input parser only restricts writable fields and the global-draft contract.
- `globalChallengeAdminRepository` remains the only global challenge write path.
  It now reads current admin authority inside each write transaction and retry.
- Reuse the administrative serverless multiplexer and an Express adapter pointing
  to the same handler; no additional Vercel function or collection was introduced.
- The existing composed rules deny browser access to `global_challenges`, its audit
  descendants and writes to admin profiles. Emulator coverage verifies these denials.
  No rules change/deployment is needed for this server-only API.
- Store challenge services, reward issuance, XP/coin ledgers and payments are outside
  this change. The API does not grant rewards or accept completion evidence.

## Requests

Both operations require `Authorization: Bearer <Firebase ID token>` and JSON.

`POST /api/admin/global-challenges` (or `?operation=create`):

```json
{
  "id": "first-community",
  "title": "Create your first community",
  "description": "Community creation verified by the server",
  "status": "draft",
  "validationMode": "deterministic",
  "rewardKCoins": 0,
  "rewardXp": 10,
  "maxCompletionsPerUser": 1,
  "sponsorType": "kyrub"
}
```

Optional fields: `startsAt`, `endsAt` (ISO date/time with timezone),
`maxCompletions` (positive safe integer). Unknown fields, client audit metadata,
non-global sponsors and non-draft initial states are rejected. Title and description
are required, limited to 200 and 5,000 characters. Rewards are nonnegative safe
integers. Completion limits must be positive safe integers.

`POST /api/admin/global-challenges?operation=publish`:

```json
{ "challengeId": "first-community" }
```

Creation returns HTTP 201; publication returns 200. Both return `{ "challenge": ... }`.
Unsupported methods return 405; invalid/missing/expired token 401; unauthorized role
or unverified email 403; malformed input 400; missing challenge 404; duplicate
creation or repeated publication 409; unexpected backend failure 503. Responses
have `Cache-Control: no-store`; backend exception details are not returned.

## Persistence and retries

Creation atomically creates the draft and `audit/created`. Publication validates the
stored draft and atomically updates status/provenance and creates `audit/published`.
Author and timestamps originate in the authenticated server operation. Existing
creation provenance is preserved. Publication refuses ended or invalid periods.
The transaction checks the stored challenge ID against its document ID.

The challenge ID is the stable creation identity. Concurrent or repeated requests
produce one successful transition; subsequent requests receive 409 without new
effects. A client receiving an ambiguous network failure can retry the same ID:
409 indicates the transition cannot be performed again; it does not issue another
challenge/reward. This API deliberately does not return successful replay receipts.
Audit failure aborts the entire transaction. Authority is re-read transactionally,
so concurrent role changes cause retry/rejection rather than stale authorization.

## Validation

Run `npm run test:global-challenges` with Java 21 and the repository's Node 22 runtime.
It starts Firestore Emulator using the isolated `demo-global-challenges` project,
uses the real handlers, transactions, composed rules, role checks and Firebase token
verifier, and supplies locally signed RSA test tokens and a fixture certificate.
No real Firebase identity or production credential is used. It covers HTTP and the
serverless multiplexer, malformed/expired/forged tokens, non-admin and inactive
profiles, input validation, duplicate/concurrent requests, audit provenance, atomic
rollback and direct browser write denials. The suite refuses to run without a local
Firestore Emulator. CI runs this command under `Validate Kyrub`.

Local validation also includes `npm run prebuild`, the related gamification tests,
`npm --ignore-scripts run build`, serverless ESM normalization, `npm run lint`, and
`scripts/check-vercel-function-budget.mjs`.

## Remaining gates

Wait for the PR's `Application build` and `Validate Kyrub` checks and review the
security/transaction changes before marking the draft ready. No merge is authorized.
Control Plane UI, public Recompensas integration and a real verified completion event
are subsequent work. No UI or production runtime validation is claimed by this API
change. The existing Vercel Git configuration disables this feature branch.
