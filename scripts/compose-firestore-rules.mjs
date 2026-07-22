import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basePath = resolve(root, 'firestore.rules');
const fragmentPaths = [
  resolve(root, 'firestore.store-security.fragment.rules'),
  resolve(root, 'firestore.store-directory-query.fragment.rules'),
  resolve(root, 'firestore.operational-dual-write.fragment.rules'),
  resolve(root, 'firestore.product-dual-write.fragment.rules'),
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

const composedFragment = fragments.map(fragment => fragment.trimEnd()).join('\n\n');
const combinedRules = baseRules.replace(
  marker,
  `${composedFragment}\n\n${marker}`
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, combinedRules, 'utf8');
console.log(`Composed Firestore rules: ${outputPath}`);
