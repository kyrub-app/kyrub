import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  evaluateOperationsReadiness,
  formatOperationsReadiness,
} from '../scripts/validate-operations-readiness.mjs';

const schedulerSource = readFileSync(
  'infra/cloud-scheduler/apply-kyrub-operations.sh',
  'utf8'
);
const ttlSource = readFileSync(
  'infra/firestore/enable-integration-ingress-ttl.sh',
  'utf8'
);
const runbookSource = readFileSync(
  'docs/production-operations-runbook.md',
  'utf8'
);

describe('production operations readiness', () => {
  test('approves a valid managed production environment', () => {
    const report = evaluateOperationsReadiness({
      PUBLIC_APP_URL: 'https://app.kyrub.com',
      FIREBASE_PROJECT_ID: 'kyrub-b8d0e',
      K_SERVICE: 'kyrub-api',
      INTEGRATION_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
      INTEGRATION_CRON_SECRET: 'c'.repeat(48),
      SCHEDULER_LOCATION: 'southamerica-east1',
      NINETY_NINE_FOOD_POLL_SCHEDULE: '*/5 * * * *',
    });

    assert.equal(report.ready, true);
    assert.deepEqual(report.issues, []);
    assert.equal(report.authentication, 'application-default-credentials');
    assert.equal(
      report.endpoints.deliveryFallback,
      'https://app.kyrub.com/api/delivery-opportunities/internal/escalate'
    );
    assert.equal(report.schedules.ingressDrain, '* * * * *');
  });

  test('blocks unsafe URLs, projects, secrets and missing server identity', () => {
    const report = evaluateOperationsReadiness({
      PUBLIC_APP_URL: 'http://localhost:3000',
      FIREBASE_PROJECT_ID: 'wrong-project',
      INTEGRATION_MASTER_KEY: 'short',
      INTEGRATION_CRON_SECRET: 'short',
    });

    assert.equal(report.ready, false);
    assert.equal(report.issues.length, 5);
    assert.match(formatOperationsReadiness(report), /BLOQUEADA/);
    assert.match(formatOperationsReadiness(report), /Bloqueios:/);
  });

  test('accepts a structurally valid service account JSON', () => {
    const report = evaluateOperationsReadiness({
      PUBLIC_APP_URL: 'https://app.kyrub.com',
      FIREBASE_PROJECT_ID: 'kyrub-b8d0e',
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'kyrub-b8d0e',
        client_email: 'server@example.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      }),
      INTEGRATION_MASTER_KEY: 'ab'.repeat(32),
      INTEGRATION_CRON_SECRET: 's'.repeat(40),
    });

    assert.equal(report.ready, true);
    assert.equal(report.authentication, 'service-account-json');
    assert.equal(report.warnings.length, 2);
  });

  test('scheduler installer upserts the three protected minute-level jobs', () => {
    assert.match(schedulerSource, /scheduler jobs describe/);
    assert.match(schedulerSource, /scheduler jobs "\$\{action\}" http/);
    assert.match(schedulerSource, /kyrub-99food-ingress-drain/);
    assert.match(schedulerSource, /kyrub-99food-poll-all/);
    assert.match(schedulerSource, /kyrub-delivery-fallback/);
    assert.match(schedulerSource, /X-Cron-Secret=/);
    assert.match(schedulerSource, /--max-retry-attempts=3/);
    assert.match(schedulerSource, /"\* \* \* \* \*"/);
  });

  test('TTL installer targets integrationIngress.expiresAt', () => {
    assert.match(ttlSource, /firestore fields ttls update expiresAt/);
    assert.match(ttlSource, /--collection-group=integrationIngress/);
    assert.match(ttlSource, /--enable-ttl/);
    assert.match(ttlSource, /firestore fields ttls list/);
  });

  test('runbook includes activation, mode shadow, health checks and rollback', () => {
    assert.match(runbookSource, /Piloto em modo sombra/);
    assert.match(runbookSource, /Critérios de ativação/);
    assert.match(runbookSource, /Rollback/);
    assert.match(runbookSource, /scheduler jobs pause/);
    assert.match(runbookSource, /Saúde do sistema/);
    assert.match(runbookSource, /operations:check/);
  });
});
