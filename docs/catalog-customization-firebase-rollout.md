# Catalog customization — controlled Firebase rollout

## Verified prerequisites

- Owner-only rule lives at `users/{uid}/private_store/catalog_customization` in `firestore.rules`.
- `npm run test:rules` composes `.firebase/firestore.combined.rules` and runs the security emulator suite.
- GitHub Actions Store security rules run 40367001251 completed successfully for commit `ba65f1d`.
- The private migration and writer exist but are not invoked by the editor.
- The storefront still reads `tenants/{storeId}.catalogCustomizationDefaults`.

## Firebase rules deployment (explicit approval required)

1. Use a trusted operator environment authenticated to Firebase project `kyrub-b8d0e`; confirm the active project explicitly.
2. Check out the validated homologation commit and run `npm ci` and `npm run test:rules`.
3. Review the generated `.firebase/firestore.combined.rules` against the currently deployed rules; check for unrelated rule changes. A successful emulator run does not prove this is a safe rules-only production diff.
4. With approval and a rollback copy of current deployed rules, run `npx firebase-tools deploy --project kyrub-b8d0e --only firestore:rules --config firebase.json`. Do not deploy indexes or storage rules.
5. Verify deployment success in Firebase Console and repeat an authorized owner/other-user access smoke test against a non-sensitive test document. Remove test data when done.
6. Only after rules are verified, enable owner migration behind a controlled rollout; verify a legacy store's defaults survive intact. Do not switch public storefront reads to the owner-only document.

## Compatibility and privacy gates

- Do not remove `tenants` reads or writes until the public storefront has a sanitized projection and operational settings have a separate private path.
- Do not expose `private_store/catalog_customization` to shoppers or widen its owner-only rules.
- Do not silently switch editor writes to the private path while the storefront still relies on legacy defaults: the customer-facing view would become stale.
- Do not enable a global migration before verifying historic store identifiers and ownership mappings.

## Rollback

If authorization or storefront behavior regresses, restore the previously saved Firebase rules. The editor and storefront continue to use legacy customization defaults until the explicit migration gate is enabled.
