import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreE2ETestService.ts', import.meta.url);
const wizardPath = new URL('../src/components/store/MercadoLivreRequirementsWizard.tsx', import.meta.url);
const workspacePath = new URL('../src/components/store/MercadoLivreE2ETestWorkspace.tsx', import.meta.url);

test('Mercado Livre category inspection preserves variation and catalog semantics', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /allowVariations: tags\.allow_variations === true/);
  assert.match(source, /variationAttribute: tags\.variation_attribute === true/);
  assert.match(source, /catalogRequired: tags\.catalog_required === true/);
  assert.match(source, /providerTags: trueTagNames\(tags\)/);
  assert.match(source, /readOnly: tags\.read_only === true/);
  assert.match(source, /hidden: tags\.hidden === true/);
});

test('requirements wizard exposes staged optional and required provider fields', async () => {
  const source = await readFile(wizardPath, 'utf8');
  assert.match(source, /id: 'configuration'/);
  assert.match(source, /id: 'variations'/);
  assert.match(source, /id: 'required'/);
  assert.match(source, /id: 'additional'/);
  assert.match(source, /id: 'review'/);
  assert.match(source, /Pular etapa/);
  assert.match(source, /Requer atenção/);
  assert.match(source, /Pulada/);
  assert.match(source, /Concluída/);
  assert.match(source, /Validar com Mercado Livre/);
  assert.match(source, /options\.attributes\.filter\(editable\)/);
  assert.doesNotMatch(source, /filter\(attribute =>\s*attribute\.required \|\| attribute\.conditionalRequired/);
});

test('workspace delegates Mercado Livre requirement collection to wizard without weakening validation', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /<MercadoLivreRequirementsWizard/);
  assert.match(source, /configureMercadoLivreE2ERequirements/);
  assert.match(source, /validateMercadoLivreE2EConditionalRequirements/);
  assert.match(source, /validateMercadoLivreE2EListing/);
  assert.match(source, /O Mercado Livre ainda exige estes atributos/);
  assert.match(source, /Autorizar publicação real/);
});
