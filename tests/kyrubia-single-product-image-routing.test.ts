import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isKyrubiaCatalogImportText } from '../shared/kyrubiaCatalogImportIntent';
import { classifyKyrubiaCapability } from '../shared/kyrubiaCapabilityRouter';

const singleProductWithMultipleReferences =
  'Kyrubia, estas três imagens são referências visuais do MESMO produto, não são três produtos diferentes. ' +
  'Quero criar um único produto chamado Chaveiro Kyrub na minha Loja Kyrub. ' +
  'Use as três imagens apenas como referências visuais do design e da identidade Kyrub. ' +
  'Cadastre o Chaveiro Kyrub inicialmente como rascunho. Depois quero preparar esse mesmo produto para venda também no Mercado Livre.';

test('multiple images explicitly describing one product do not enter bulk catalog import', () => {
  const decision = classifyKyrubiaCapability(singleProductWithMultipleReferences);

  assert.equal(decision.primary, 'create_products');
  assert.equal(decision.mutation, 'products');
  assert.equal(isKyrubiaCatalogImportText(singleProductWithMultipleReferences), false);
  assert.equal(
    isKyrubiaCatalogImportText(
      'Cadastre um produto chamado Chaveiro Kyrub usando estas três imagens como referência.'
    ),
    false
  );
  assert.equal(
    isKyrubiaCatalogImportText(
      'Crie o mesmo produto usando essas fotos como referências visuais.'
    ),
    false
  );
});

test('real bulk catalog and menu imports keep the existing deterministic import path', () => {
  assert.equal(
    isKyrubiaCatalogImportText('Cadastre os produtos dessa imagem na minha loja.'),
    true
  );
  assert.equal(
    isKyrubiaCatalogImportText('Cadastre os itens desse cardápio anexado.'),
    true
  );
  assert.equal(
    isKyrubiaCatalogImportText('Crie os produtos desta lista na Loja Kyrub.'),
    true
  );
});

test('consultor router keeps bulk import ahead of generic flow without forcing single-product references into it', () => {
  const router = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  const importGate = router.indexOf('const importRequested =');
  const immediateBulkAnalysis = router.indexOf('analyzeCatalogForImmediateImport(request)');
  const genericFallback = router.indexOf('await runGenericWithCapabilityGuard(request, response, body, decision)');

  assert.ok(importGate >= 0);
  assert.ok(immediateBulkAnalysis > importGate);
  assert.ok(genericFallback > immediateBulkAnalysis);
  assert.match(router, /latestUserRequestsCatalogImport\(messages\)/);
  assert.match(router, /isKyrubiaCatalogImportText\(latestUser\.content\)/);
});
