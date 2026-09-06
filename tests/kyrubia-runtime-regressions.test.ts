import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const kyrubiaSource = readFileSync(
  new URL('../api/kyrubia.ts', import.meta.url),
  'utf8'
);
const consultantSource = readFileSync(
  new URL('../api/consultor-kyrub.ts', import.meta.url),
  'utf8'
);

test('Gemini tool roundtrip preserves the original model part and thought signature metadata', () => {
  assert.match(kyrubiaSource, /part: rawPart/);
  assert.match(kyrubiaSource, /parts: \[readCall\.part\]/);
  assert.doesNotMatch(
    kyrubiaSource,
    /parts:\s*\[\{\s*functionCall:\s*\{\s*id:\s*readCall\.id/s
  );
});

test('capability routing forwards headers explicitly into the Kyrubia handler', () => {
  assert.match(consultantSource, /method: request\.method/);
  assert.match(consultantSource, /headers: request\.headers \?\? \{\}/);
  assert.match(consultantSource, /body: withCapabilityPolicy\(body, decision\)/);
  assert.doesNotMatch(
    consultantSource,
    /\{\s*\.\.\.request,\s*body:\s*withCapabilityPolicy\(body, decision\)/
  );
});
