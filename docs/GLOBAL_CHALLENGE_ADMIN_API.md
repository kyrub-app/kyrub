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
  The existing Admin Auth SDK's `getUser` checks disabled/deleted identities and
  `auth_time` against `tokensValidAfterTime` on every request. No token role claim,
  cached identity state or second signature-verification implementation is used.
- `assertKyrubChallengeDefinition` and `globalChallengeLifecycle` remain the canonical
  definition and lifecycle validators. Extended runtime definition checks; the new
  input parser only restricts writable fields and the global-draft contract.
- `globalChallengeAdminRepository` remains the only global challenge write path.
  It now reads current admin authority inside each write transaction and retry.
- Reuse the administrative serverless multiplexer and an Express adapter pointing
  to the same handler; no additional Vercel function or collection was introduced.
- The existing composed rules deny browser access to `global_challenges`, its audit
  descendants and writes to admin profiles. Emulator coverage verifies these denials.
  The same default-deny boundary covers the server-only rate-limit records.
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
creation or repeated publication 409; missing payload length evidence 411; payload
above 32 KiB 413; non-JSON content 415; quota exhaustion 429 (with `Retry-After`);
unexpected backend failure 503. Responses
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
so a revocation committed before the business transaction reads authority prevents
that write. On an ABORTED attempt, the SDK rolls back staged challenge/audit writes
and re-reads the profile on retry. A revocation waiting behind a pessimistic read
lock does not retroactively cancel an earlier transaction that commits first;
Firestore's serial order determines which operation wins.

## Validation

Run `npm run test:global-challenges` with Java 21 and the repository's Node 22 runtime.
It starts Firestore and Auth Emulators using the isolated `demo-global-challenges` project,
uses the real handlers, transactions, composed rules, role checks and Firebase token
verifier, and supplies locally signed RSA test tokens and a fixture certificate.
No real Firebase identity or production credential is used. It covers HTTP and the
serverless multiplexer, malformed/expired/forged tokens, non-admin and inactive
profiles, input validation, duplicate/concurrent requests, audit provenance, atomic
rollback and direct browser write denials. The suite refuses to run without a local
Firestore and Auth Emulators. CI runs this command under `Validate Kyrub`.

Local validation also includes `npm run prebuild`, the related gamification tests,
`npm --ignore-scripts run build`, serverless ESM normalization, `npm run lint`, and
`scripts/check-vercel-function-budget.mjs`.

## HTTP protections and reuse

Search included `server.ts`, `server/fiscal/fiscalStoreOnboardingServerlessTransport.ts`,
`server/integrations/storeConnectionsServerlessTransport.ts`, `api/admin`, and
repository rate-limit/quota implementations. The existing 2 MB general Express
parser did not protect this small write API appropriately, and existing rate
middleware did not cover this endpoint. Reused Express JSON parsing and
`express-rate-limit`'s MemoryStore; no new runtime dependency was introduced.

| Protection | Bound | Enforcement |
| --- | --- | --- |
| Payload | 32,768 UTF-8 bytes | Dedicated Express parser before the general parser; shared handler checks wire-length evidence and serialized parsed body |
| Ingress | 300 POSTs per 60 seconds per process | One constant MemoryStore key, before authentication; no spoofable forwarded-IP or token key |
| Authenticated writes | 30 valid operation attempts per UID per 60 seconds | Firestore transaction shared across instances, creation/publication and both transports |

Both quota responses return 429, `Retry-After` and no-store. The per-process ingress
cap is a load guard, not a cross-instance DDoS guarantee. The UID quota is distributed,
so a cold start or switching aliases cannot reset it. It counts valid duplicate and
conflicting attempts as well as successful writes. Invalid inputs and unauthorized
identities do not allocate UID records. The quota admission transaction precedes
the business transaction: a denied/revoked business operation can consume quota,
but cannot create a challenge/audit transition.

The new `kyrub_admin/control_plane/rate_limits/global-challenges-<sha256(uid)>`
record is necessary because no reusable distributed request limiter exists in the
repository. It stores only count/resetAt, one document per administrator, and is
server-only. Expired windows are reused; malformed persisted counters fail closed.
No token or client IP is stored. It does not replace any business collection.

On Express, byte limits include whitespace and chunked bodies and apply before
parsing. Compressed bodies are refused by the dedicated parser. On the Vercel
multiplexer, the platform parses JSON before this handler: the handler enforces
Content-Length (or raw bytes if supplied) plus serialized-body size, and refuses
pre-parsed bodies without length evidence with 411. This does not claim a 32 KiB
pre-parser memory bound inside Vercel's runtime. There is no arbitrary change to
the other transports' parser configuration.

## Final security evidence

The emulator suite now includes 12 revocation scenarios (create/publish × role
reduction/disabled/deleted × before transactional read/after aborted first attempt).
Tests interpose on the real SDK callback only to schedule the profile change and
inject a deterministic retryable ABORTED error after both writes are staged. The
actual SDK handles rollback and automatic retry against the emulator; no fake
transaction store or manually invoked retry loop is used. Every retry case asserts
two attempts, 403, no publication metadata and no new challenge/audit transition.
The repository's authority check already met these requirements; no bypass or
production test hook was added.

HTTP tests cover a body exactly at the byte bound, oversized whitespace/chunked/
parsed bodies, missing length evidence, invalid JSON/media type, concurrent quota
admission, cross-transport quota sharing, expiry/reset, corrupt-counter fail-closed,
conflict accounting and ingress floods with changing forged forwarding headers.

The routing check reads the real `vercel.json` rewrite and compiles it with pinned
`@vercel/routing-utils` 6.6.1. A loopback HTTP adapter applies the compiler output,
merges destination and incoming query parameters using Vercel CLI's documented
local-router source semantics, and invokes the real administrative multiplexer and
handler. POST creation followed by `?operation=publish` produces draft then published
state with exactly two audit entries. It is an offline configuration/handler
integration test, not a hosted Vercel edge/runtime test. No production URL is used.
The rewrite required no change. Routing tools and minimatch are dev dependencies.

The earlier preview was consistent with minimatch semantics: `*` does not match a
slash-containing branch such as `feat/global-challenge-admin-repository`; unspecified
branches default to enabled. The PR now adds an explicit false rule for this exact
branch, with a test that no matching rule permits a deploy. Other branch rules are
preserved. Reference: https://vercel.com/docs/project-configuration/git-configuration
Local router reference:
https://github.com/vercel/vercel/blob/vercel%4048.10.0/packages/cli/src/util/dev/router.ts

## Local validation results for security finalization

| Check | Result |
| --- | --- |
| `npm run test:global-challenges` | 40 passed, zero failures/skips; includes the 12 revocation cases |
| Related challenge/gamification regression suite | 45 passed |
| `npm run prebuild` | 2,561 passed |
| `npm run lint` | Passed |
| `npm --ignore-scripts run build` | Passed; existing CJS `import.meta` and chunk-size warnings remain |
| Function budget | 11 active, one reserved slot preserved |

Local runtime: Node 24.22.1 and Java 21. CI uses the project's Node 22 runtime.
CI status for the new commit is recorded in the PR rather than inferred from these
local results. No merge, deploy, payment, store activation or production API access
is part of this validation.

## Review verdict and remaining gates

The three requested security checks have automated coverage. With the emulator,
build, TypeScript and updated CI passing, this API is ready for final code/security
review. This is not authorization to merge or deploy. The PR remains a draft.
Control Plane UI, public Recompensas integration and a real verified completion event
remain separate work. No hosted-runtime or production validation is claimed.


## Final independent review - 2026-11-11

The review of `e128888` found two reproducible issues before integration:

1. Firebase Auth disable/delete/revokeRefreshTokens did not invalidate an otherwise
   signed token while the Control Plane profile stayed active. Original requests
   returned 201 instead of 401. The feature now calls the existing `adminAuth.getUser`
   after canonical verification and checks disabled/missing identity and the SDK's
   auth_time/tokensValidAfterTime cutoff. Backend failure is sanitized 503 with no
   business writes. This is scoped to challenges; other services are unchanged.
2. Express parser errors (invalid JSON/oversize) skipped ingress admission. A malformed
   flood never reached 429. Admission now occurs before the parser, with a private
   WeakSet preventing double counting in the shared handler; direct Vercel calls
   remain covered. Tests cover both malformed floods and one slot per request.

The real Auth Emulator tests accept the same captured token before disabling,
removing or revoking its identity, then require 401 and unchanged draft/audit.
Revocation advances the test clock across the SDK's whole-second cutoff and checks
that reauthentication permits a fresh session. Firestore role revocation/retry,
concurrency and rollback tests remain unchanged. Emulator endpoints must be local;
no production credentials or real certificate/identity requests are used.

Auth revocation is checked at request authorization; there is no distributed atomic
transaction between Firebase Auth and Firestore. Immediate business authorization
revocation remains the server-owned Firestore profile, read in the business
transaction and on every SDK retry. A concurrent revocation ordered after a prior
commit does not undo that commit. Network/platform limits and cross-instance DDoS
protection are not promised by the per-process ingress budget; an anonymous client
can exhaust that shared budget and temporarily deny requests to administrators.

Detailed evidence, merge ordering and final CI links are recorded in the PR review.
No client rules, production flags, commercial code or reward issuance changed.
