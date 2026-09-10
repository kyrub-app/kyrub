import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const transportPath = new URL('../server/integrations/mercadoLivreListingValidationTransport.ts', import.meta.url);
const listingValidatorPath = new URL('../server/integrations/mercadoLivreOutboundListingValidationService.ts', import.meta.url);

test('listing validator transport captures only sanitized provider rejection fields', async () => {
  const source = await readFile(transportPath, 'utf8');
  assert.match(source, /providerCode/);
  assert.match(source, /providerError/);
  assert.match(source, /providerMessage/);
  assert.match(source, /record\.message \?\? record\.error_description/);
  assert.match(source, /Bearer \[redacted\]/);
  assert.match(source, /\[email\]/);
  assert.match(source, /\[redacted\]/);
  assert.match(source, /\[id\]/);

  const logStart = source.indexOf("console.error('[Mercado Livre listing validation rejection]'");
  const throwStart = source.indexOf('throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${response.status}`)', logStart);
  assert.ok(logStart >= 0);
  assert.ok(throwStart > logStart);
  const loggingBlock = source.slice(logStart, throwStart);
  assert.doesNotMatch(loggingBlock, /payload|body|secret|accessToken|refreshToken|authorization/);
});

test('listing diagnostic transport preserves validator behavior and publication remains outside this boundary', async () => {
  const transport = await readFile(transportPath, 'utf8');
  const validator = await readFile(listingValidatorPath, 'utf8');
  assert.match(transport, /path !== '\/items\/validate'/);
  assert.match(transport, /method: 'POST'/);
  assert.match(transport, /response\.status === 204/);
  assert.match(transport, /response\.status === 401 \|\| response\.status === 403 \|\| response\.status === 429/);
  assert.match(validator, /from '\.\/mercadoLivreListingValidationTransport\.js'/);
  assert.match(validator, /mercadoLivreValidateJson\(storeId, '\/items\/validate', itemPayload\)/);
  assert.match(validator, /executionStatus: 'not_authorized'/);
  assert.doesNotMatch(transport, /\/items['"`]/);
});
