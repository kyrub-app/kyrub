import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const resolver = readFileSync('server/ai/userAiProviderResolver.ts', 'utf8');

test('provider resolver never hides a hardcoded provider preference', () => {
  assert.match(resolver, /status: 'selection_required'/);
  assert.match(resolver, /selection: 'explicit'/);
  assert.match(resolver, /selection: 'single_available'/);
  assert.doesNotMatch(resolver, /google-gemini[\s\S]{0,100}\?\?/);
});

test('one available provider may be selected without extra user friction', () => {
  assert.match(resolver, /availableProviders\.length === 1/);
  assert.match(resolver, /provider: availableProviders\[0\]/);
});

test('multiple available providers require explicit selection when no preference exists', () => {
  assert.match(resolver, /if \(preferred && availableProviders\.includes\(preferred\)\)/);
  assert.match(
    resolver,
    /return \{\s*status: 'selection_required',\s*availableProviders,\s*\}/
  );
});

test('resolver only obtains decrypted keys from the server-side credential resolver', () => {
  assert.match(resolver, /resolveAuthorizedUserAiProviderSecret/);
  assert.doesNotMatch(resolver, /firebase\/firestore/);
  assert.doesNotMatch(resolver, /localStorage|sessionStorage/);
});
