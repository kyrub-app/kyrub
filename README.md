# Kyrub isolated Firebase attestation preview

Authorized diagnostic only, branch diagnostic/firebase-attestation-20261115.
This branch contains ONLY the diagnostic package, not the Kyrub application.
Canonical signer reused unchanged from PR #1137 commit 6d817040.
Preparation base: local commit 5d564c07. Workstream C/F; no business changes.

The API refuses production, another project, or another branch before any Firebase credential read.
Every invocation requires a short-lived Ed25519 operator-signed request.
Only the operator PUBLIC key is committed. The private key remains local.
Signature verification precedes any Firebase signing; metadata action never reads the credential.
No Firebase SDK, database calls, user data reads/writes, background jobs or logs.
All errors are sanitized; only explicit metadata or a domain-separated proof are returned.

Six new focused local tests passed for authentication, tampering, expiry, context binding,
production rejection before credential access, and compatibility with canonical Firebase proof verification.
No old tests/workflows were rerun. Deployment uses existing GitHub/Vercel integration.
Branch-only vercel.json overrides apply to this preview; main/PR/project settings are unchanged.
If Vercel Authentication also blocks the operator, it must be completed by the owner;
never disable protection or export credentials to work around it.

A preview key proof establishes only this preview's identity, not production coverage.
No flags, Firebase credentials, writersVerified or balances may be changed by this package.
After collection the owner can retire the preview/branch separately; do not promote it.
manifest.json records the source hashes of the reviewed package.
