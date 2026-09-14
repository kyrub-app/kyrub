import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requirementsPath = new URL(
  '../server/integrations/mercadoLivreCommercialRequirementsService.ts',
  import.meta.url
);
const transportPath = new URL(
  '../server/integrations/mercadoLivreCommercialReadTransport.ts',
  import.meta.url
);

test('Mercado Livre commercial readiness reads use the dedicated diagnostic transport', async () => {
  const requirements = await readFile(requirementsPath, 'utf8');
  assert.match(requirements, /mercadoLivreCommercialGetJson/);
  assert.doesNotMatch(requirements, /mercadoLivreGetJson/);
  assert.match(requirements, /category_sale_terms/);
  assert.match(requirements, /seller_shipping_preferences/);
  assert.match(requirements, /category_shipping_preferences/);
});

test('commercial readiness diagnostics expose provider status without leaking credentials', async () => {
  const transport = await readFile(transportPath, 'utf8');
  assert.match(transport, /Mercado Livre commercial readiness rejection/);
  assert.match(transport, /status: response\.status/);
  assert.match(transport, /providerCode/);
  assert.match(transport, /providerError/);
  assert.match(transport, /providerMessage/);
  assert.match(transport, /Bearer \[redacted\]/);
  assert.match(transport, /\[email\]/);
  assert.match(transport, /MERCADO_LIVRE_API_FAILED:HTTP_/);
  assert.doesNotMatch(transport, /console\.(?:log|error)\([^\n]*accessToken/);
});
