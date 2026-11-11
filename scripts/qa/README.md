# Global challenge visual QA (PR #1126)

Disposable test host only; never import it into the product or deploy it as an API.
It requires `KYRUB_VISUAL_QA=1`, project `demo-kyrub-control-plane`, a loopback
Firestore and Auth Emulators and no service account/ADC file configuration. Startup rejects
other configurations before importing Firebase Admin. Guard rejection is covered
by the existing UI test command.

```sh
npm ci
npm --ignore-scripts run build
npm run firestore:compose
KYRUB_VISUAL_QA=1 FIREBASE_PROJECT_ID=demo-kyrub-control-plane \
  npx --yes firebase-tools@15.35.0 emulators:exec \
  --config firebase.security.json --project demo-kyrub-control-plane \
  --only firestore,auth 'node --import tsx scripts/qa/globalChallengeVisualServer.ts'
```

Open `/qa` on port 3000. Use a clean disposable emulator. The host seeds 26 fake
definitions and creates a new test identity in Auth Emulator and its administrative profile per page load. `/qa/receipt` reports the
last successful mutation, audit action names and collection names, without tokens.
The host intentionally exposes fixture sessions to its test browser, so it must
remain disposable and contain only generated test data. Stop the host/emulator
when finished. No credentials or keys are persisted.

The browser loads the real `AdminControlPlaneApp`, accordion, challenge workspace,
HTTP client and compiled application CSS. The QA bundle substitutes only Firebase
browser session/profile transport and unrelated workspaces. The real handler,
JWT signature/project/expiry checks, profile authority, identity revocation lookup, quotas, repository and
Firestore transactions execute against the emulator. RSA keys/certificate response
are generated in memory. This is not a Google OAuth or production Firebase test.
All browser connections are same-origin under CSP. Server fetch only permits the
fixture certificate URL and never makes a real certificate request. For hosted
QA, deny sandbox network egress after installing dependencies/emulator artifacts.
The SDK can emit a blocked metadata lookup warning; no real credentials are used.

Viewport choices use actual iframe CSS viewports (1280x900, 390x844, 320x844) in
Chrome, not a physical phone or Safari simulation. Cases: normal, 20-second GET
loading delay, expired signed token (401), frontend stale admin/server operations
profile (403), seeded real read-quota exhaustion (429). Use cancelled filter for
empty state; duplicate ID `qa-001` for 409; publish expired `qa-002` for 400.

QA sequence: open Challenges; check 20+6 pagination and filters; view details;
create a draft; cancel then accept native publication confirmation; verify the
published state/action removal and receipt (one created, one published event).
Check keyboard focus, labels, alerts, busy and empty states. Measure both document
width and form/control bounds at 320 pixels; a hidden overflow must not be mistaken
for a successful responsive layout. Native confirm screenshots are unavailable in
the review browser, so record its text/type plus the resulting data state.


Non-visual smoke check after building (same clean, disposable demo emulators):

```sh
FIREBASE_PROJECT_ID=demo-kyrub-control-plane \
  npx --yes firebase-tools@15.35.0 emulators:exec \
  --config firebase.security.json --project demo-kyrub-control-plane \
  --only firestore,auth 'node --import tsx scripts/qa/globalChallengeHostSmoke.ts'
```

This starts the existing QA host, obtains its generated test session, verifies a
real API list200, disables that identity through Auth Emulator and requires401
from the same API/token. It never launches a browser or prints the token.
