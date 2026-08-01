import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKyrubHealthPayload,
  type KyrubHealthPayload,
} from '../api/health';

test('production health exposes only safe operational metadata', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousRelease = process.env.KYRUB_RELEASE;
  const previousEnvironment = process.env.VERCEL_ENV;

  process.env.GEMINI_API_KEY = 'secret-value-that-must-not-leak';
  process.env.KYRUB_RELEASE = 'beta-test';
  process.env.VERCEL_ENV = 'preview';

  try {
    const payload: KyrubHealthPayload = buildKyrubHealthPayload(
      new Date('2026-08-01T12:00:00.000Z')
    );

    assert.equal(payload.status, 'ok');
    assert.equal(payload.service, 'kyrub');
    assert.equal(payload.environment, 'preview');
    assert.equal(payload.release, 'beta-test');
    assert.equal(payload.timestamp, '2026-08-01T12:00:00.000Z');
    assert.equal(payload.capabilities.kyrubia, 'configured');
    assert.doesNotMatch(JSON.stringify(payload), /secret-value/);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;

    if (previousRelease === undefined) delete process.env.KYRUB_RELEASE;
    else process.env.KYRUB_RELEASE = previousRelease;

    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  }
});

test('manual Kyrub remains healthy when Kyrubia is not configured', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const payload = buildKyrubHealthPayload(
      new Date('2026-08-01T12:00:00.000Z')
    );
    assert.equal(payload.status, 'ok');
    assert.equal(payload.capabilities.kyrubia, 'unconfigured');
  } finally {
    if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
  }
});
