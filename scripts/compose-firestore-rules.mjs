import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hardenKyrubArtifactRules,
  hardenKyrubDeliveryRules,
  hardenKyrubFreelanceRules,
} from './firestore-rule-composition.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basePath = resolve(root, 'firestore.rules');
const fragmentPaths = [
  resolve(root, 'firestore.admin-control-plane.fragment.rules'),
  resolve(root, 'firestore.identity-eligibility.fragment.rules'),
  resolve(root, 'firestore.identity-verification.fragment.rules'),
  resolve(root, 'firestore.store-security.fragment.rules'),
  resolve(root, 'firestore.omnichannel.fragment.rules'),
  resolve(root, 'firestore.store-directory-query.fragment.rules'),
  resolve(root, 'firestore.marketplace.fragment.rules'),
  resolve(root, 'firestore.note-invitations.fragment.rules'),
  resolve(root, 'firestore.product-inventory.fragment.rules'),
  resolve(root, 'firestore.profile-social-hub.fragment.rules'),
  resolve(root, 'firestore.contact-groups.fragment.rules'),
  resolve(root, 'firestore.communities.fragment.rules'),
  resolve(root, 'firestore.community-debate-comment-query.fragment.rules'),
  resolve(root, 'firestore.social-feed.fragment.rules'),
  resolve(root, 'firestore.kyrubia-conversations.fragment.rules'),
  resolve(root, 'firestore.operational-dual-write.fragment.rules'),
  resolve(root, 'firestore.product-dual-write.fragment.rules'),
  resolve(root, 'firestore.cash-ledger.fragment.rules'),
  resolve(root, 'firestore.cash-sessions.fragment.rules'),
  resolve(root, 'firestore.cash-movements.fragment.rules'),
];
const outputPath = resolve(root, '.firebase/firestore.combined.rules');
const marker = '    // --- Kyrub Social Connections & Feed ---';

const [baseRules, ...fragments] = await Promise.all([
  readFile(basePath, 'utf8'),
  ...fragmentPaths.map(fragmentPath => readFile(fragmentPath, 'utf8')),
]);

if (!baseRules.includes(marker)) {
  throw new Error(`Firestore rules marker not found: ${marker.trim()}`);
}

if (baseRules.includes('// --- Canonical Stores, Members and Operations ---')) {
  throw new Error('Canonical store rules are already present in firestore.rules.');
}

const hardenedBaseRules = hardenKyrubArtifactRules(
  hardenKyrubFreelanceRules(
    hardenKyrubDeliveryRules(baseRules)
  )
);
const composedFragment = fragments.map(fragment => fragment.trimEnd()).join('\n\n');

// Use a replacement callback so regular-expression anchors and other dollar
// sequences inside rule fragments remain literal. A plain replacement string
// treats sequences such as `$'` specially and can corrupt the generated rules.
const combinedRules = hardenedBaseRules.replace(
  marker,
  () => `${composedFragment}\n\n${marker}`
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, combinedRules, 'utf8');
console.log(`Composed Firestore rules: ${outputPath}`);
