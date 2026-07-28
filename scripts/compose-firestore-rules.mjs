import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basePath = resolve(root, 'firestore.rules');
const fragmentPaths = [
  resolve(root, 'firestore.admin-control-plane.fragment.rules'),
  resolve(root, 'firestore.store-security.fragment.rules'),
  resolve(root, 'firestore.store-directory-query.fragment.rules'),
  resolve(root, 'firestore.marketplace.fragment.rules'),
  resolve(root, 'firestore.note-invitations.fragment.rules'),
  resolve(root, 'firestore.product-inventory.fragment.rules'),
  resolve(root, 'firestore.profile-social-hub.fragment.rules'),
  resolve(root, 'firestore.social-feed.fragment.rules'),
  resolve(root, 'firestore.operational-dual-write.fragment.rules'),
  resolve(root, 'firestore.product-dual-write.fragment.rules'),
  resolve(root, 'firestore.cash-ledger.fragment.rules'),
  resolve(root, 'firestore.cash-sessions.fragment.rules'),
  resolve(root, 'firestore.cash-movements.fragment.rules'),
];
const outputPath = resolve(root, '.firebase/firestore.combined.rules');
const marker = '    // --- Kyrub Social Connections & Feed ---';
const legacyDeliveryRules = `    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn(); // Qualquer usuário ou lojista logado pode solicitar
      allow update, delete: if isSignedIn();
    }`;
const secureDeliveryRules = `    // --- Guia Renda: Entregas Solicitadas/Disponíveis ---
    // Esta coleção é uma projeção server-authoritative. O Firebase Admin SDK
    // publica e atualiza as oportunidades sem passar pelas regras de cliente.
    match /hub/renda/deliveries/{deliveryId} {
      allow read: if isSignedIn();
      allow create, update, delete: if false;
    }`;

const [baseRules, ...fragments] = await Promise.all([
  readFile(basePath, 'utf8'),
  ...fragmentPaths.map(fragmentPath => readFile(fragmentPath, 'utf8')),
]);

if (!baseRules.includes(marker)) {
  throw new Error(`Firestore rules marker not found: ${marker.trim()}`);
}

if (!baseRules.includes(legacyDeliveryRules)) {
  throw new Error('Legacy Kyrub delivery rules block was not found.');
}

if (baseRules.includes('// --- Canonical Stores, Members and Operations ---')) {
  throw new Error('Canonical store rules are already present in firestore.rules.');
}

const hardenedBaseRules = baseRules.replace(
  legacyDeliveryRules,
  secureDeliveryRules
);
const composedFragment = fragments.map(fragment => fragment.trimEnd()).join('\n\n');
const combinedRules = hardenedBaseRules.replace(
  marker,
  `${composedFragment}\n\n${marker}`
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, combinedRules, 'utf8');
console.log(`Composed Firestore rules: ${outputPath}`);
