import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isKyrubiaCatalogImportText } from '../shared/kyrubiaCatalogImportIntent';

test('catalog import with attachment history is structured before generic note routing', () => {
  assert.equal(
    isKyrubiaCatalogImportText('Cadastre os produtos dessa imagem na minha loja.'),
    true
  );

  const router = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  const attachmentFallback = router.indexOf(
    '!analysisContext && importRequested && hasAttachmentHistory(messages)'
  );
  const capturedAnalysis = router.indexOf(
    'await analyzeCatalogForImmediateImport(request)'
  );
  const genericConsultant = router.lastIndexOf(
    'await handleKyrubia(request, response)'
  );

  assert.ok(attachmentFallback >= 0);
  assert.ok(capturedAnalysis > attachmentFallback);
  assert.ok(capturedAnalysis < genericConsultant);
  assert.match(router, /catalogAnalysis: generatedAnalysis/);
  assert.match(router, /actionProposal: proposal/);
});

test('failed forced catalog analysis never falls through into create_note', () => {
  const router = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    router,
    /if \(captured\.statusCode !== 200 \|\| !isRecord\(captured\.body\)\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    router,
    /if \(!generatedAnalysis\) \{[\s\S]*?AI_UNAVAILABLE[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    router,
    /if \(!importResponse\) \{[\s\S]*?INVALID_REQUEST[\s\S]*?return;[\s\S]*?\}/
  );
});
