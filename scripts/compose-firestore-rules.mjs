import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const basePath = resolve(root, 'firestore.rules');
const fragmentPath = resolve(root, 'firestore.store-security.fragment.rules');
const outputPath = resolve(root, '.firebase/firestore.combined.rules');
const marker = '    // --- Kyrub Social Connections & Feed ---';

const [baseRules, fragment] = await Promise.all([
  readFile(basePath, 'utf8'),
  readFile(fragmentPath, 'utf8'),
]);

if (!baseRules.includes(marker)) {
  throw new Error(`Firestore rules marker not found: ${marker.trim()}`);
}

if (baseRules.includes('// --- Canonical Stores, Members and Operations ---')) {
  throw new Error('Canonical store rules are already present in firestore.rules.');
}

const combinedRules = baseRules.replace(
  marker,
  `${fragment.trimEnd()}\n\n${marker}`
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, combinedRules, 'utf8');
console.log(`Composed Firestore rules: ${outputPath}`);
