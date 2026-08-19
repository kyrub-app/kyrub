import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKyrubiaProviderDiagnostic } from '../shared/kyrubiaProviderDiagnostics.js';

test('classifies Gemini quota exhaustion as retryable quota failure', () => {
  const result = classifyKyrubiaProviderDiagnostic({
    httpStatus: 429,
    providerStatus: 'RESOURCE_EXHAUSTED',
    quotaMetrics: ['generativelanguage.googleapis.com/generate_content_free_tier_requests'],
    retryDelay: '20s',
  });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.failureClass, 'quota');
  assert.equal(result.retryable, true);
  assert.equal(result.retryDelay, '20s');
});

test('classifies aborted provider call as timeout', () => {
  const result = classifyKyrubiaProviderDiagnostic({ aborted: true });
  assert.equal(result.failureClass, 'timeout');
  assert.equal(result.retryable, true);
});

test('classifies thought signature failure as tool call failure', () => {
  const result = classifyKyrubiaProviderDiagnostic({
    httpStatus: 400,
    message: 'Function call is missing thought_signature',
  });
  assert.equal(result.failureClass, 'tool_call');
  assert.equal(result.retryable, false);
});

test('classifies successful provider response without failure metadata', () => {
  const result = classifyKyrubiaProviderDiagnostic({ httpStatus: 200 });
  assert.equal(result.outcome, 'success');
  assert.equal(result.failureClass, null);
  assert.equal(result.retryable, false);
});
