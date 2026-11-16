import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

/** Uses real Firestore transactions; replaces only Firebase Admin binding. */
export async function loadOfficialPromotionEmulatorFixture(db: unknown) {
  (globalThis as any).__officialPromotionEmulatorDb = db;
  const bundle = await build({
    stdin: {
      contents: "export * from './server/payments/officialPlanPromotionIsolatedAttach.ts'; export * from './server/payments/officialPlanPromotionReservation.ts'; export * from './server/payments/officialPlanPromotionFinalization.ts'; export * from './server/payments/officialPlanPromotionIsolatedConfirmation.ts'; export * from './server/payments/officialPlanPromotionIsolatedActivation.ts';",
      resolveDir: process.cwd(), sourcefile: 'official-promotion-emulator-entry.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
    packages: 'external',
    plugins: [{
      name: 'emulator-firestore-only',
      setup(b) {
        b.onResolve({ filter: /firebaseAdmin\.js$/ }, a => ({ path: a.path, namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: 'export const adminDb=globalThis.__officialPromotionEmulatorDb;',
        }));
      },
    }],
  });
  const path = new URL(`../.official-promotion-emulator-${randomUUID()}.mjs`, import.meta.url);
  await writeFile(path, bundle.outputFiles[0].text);
  try { return await import(path.href); }
  finally { await unlink(path); }
}
