# Security dependency patch — Vite 6.4.4 (2026-10-21)

Scope: security-only patch on `main` as a **Draft PR**. No `main` merge or production deployment is authorized in this PR.

The current lock resolved Vite `6.4.3`, which npm audit flags HIGH for advisories affecting Windows launch-editor pathways. Pin minimum Vite `^6.4.4` in both original package.json entries (dependencies and devDependencies), and advance only Vite's lock entry to `6.4.4`, with npm registry tarball checksum confirmed independently. No major-version migration, package removals, or application changes.

Prior audit: 1 high (Vite) plus 2 moderate (uuid chain via Firebase Admin Storage/Gaxios). This patch specifically addresses the HIGH gate; do not apply a potentially breaking blanket `uuid` 11 override without compatibility tests. Existing `uuid` moderate finding remains a separate follow-up.

## Required gates

- `npm ci` validates dependency graph and tarball integrity.
- `npm audit --omit=dev --audit-level=high` passes on the updated lock.
- Application build / Validate Kyrub / Phase 10 cross-domain pass.
- New Vercel preview READY only; production stays untouched.
- If any gate fails, no merge. PR #954 and #949 remain separate, and must not inherit unvalidated lock changes.
