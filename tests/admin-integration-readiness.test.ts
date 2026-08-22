import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseAdminIntegrationReadiness } from '../src/utils/adminIntegrationReadiness';

const serverSource = readFileSync(
  'server/admin/integrationReadinessService.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/adminIntegrationReadiness.ts',
  'utf8'
);
const workspaceSource = readFileSync(
  'src/components/admin/AdminIntegrationsWorkspace.tsx',
  'utf8'
);
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites?: Array<{ source?: string; destination?: string }>;
};

test('integration readiness is server-authorized for active super_admin only', () => {
  assert.match(serverSource, /clean\(profile\?\.role\) !== 'super_admin'/);
  assert.match(serverSource, /clean\(profile\?\.status\) !== 'active'/);
  assert.match(serverSource, /verifyFirebaseIdToken/);
  assert.match(serverSource, /emailVerified !== true/);
});

test('readiness reports booleans/counts without returning credential material', () => {
  assert.match(serverSource, /Boolean\(process\.env\.INTEGRATION_MASTER_KEY\?\.trim\(\)\)/);
  assert.match(serverSource, /isMercadoPagoPixConfigured/);
  assert.match(serverSource, /isMercadoPagoWebhookConfigured/);
  assert.doesNotMatch(serverSource, /process\.env\.MERCADO_PAGO_ACCESS_TOKEN/);
  assert.doesNotMatch(serverSource, /encryptedCredentials\s*:/);
  assert.doesNotMatch(serverSource, /secretRef\s*:/);
  assert.doesNotMatch(serverSource, /ciphertext\s*:/);
});

test('99food is configured only when every discovered connection is connected', () => {
  assert.match(serverSource, /ninetyNine\.connected === ninetyNine\.total/);
  assert.match(serverSource, /ninetyNine\.attention === 0/);
  assert.match(serverSource, /: 'partial'/);
});

test('client parser allowlists public detail fields and drops secret-shaped extras', () => {
  const parsed = parseAdminIntegrationReadiness({
    generatedAt: '2026-08-22T00:00:00.000Z',
    vault: {
      legacyEnvelopeConfigured: true,
      googleSecretManagerAdapterEnabled: false,
      googleSecretManagerState: 'disabled',
      secretRef: 'must-not-pass',
    },
    providers: [{
      id: 'mercado_pago',
      title: 'Mercado Pago',
      category: 'payments',
      state: 'configured',
      credentialAuthority: 'environment',
      details: {
        pixCheckoutConfigured: true,
        webhookConfigured: true,
        accessToken: 'must-not-pass',
        secretRef: 'must-not-pass',
      },
    }],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.providers[0]?.details, {
    pixCheckoutConfigured: true,
    webhookConfigured: true,
  });
  assert.equal('secretRef' in parsed.vault, false);
});

test('admin workspace submits Mercado Pago credentials one-way through server operations', () => {
  assert.match(workspaceSource, /type=["']password["']/i);
  assert.match(workspaceSource, /saveAdminMercadoPagoCredentials/);
  assert.match(workspaceSource, /testAdminMercadoPagoConnection/);
  assert.match(workspaceSource, /setAccessToken\(''\)/);
  assert.match(workspaceSource, /setWebhookSecret\(''\)/);
  assert.match(workspaceSource, /metadados mascarados/);
  assert.doesNotMatch(workspaceSource, /setDoc\(|addDoc\(|updateDoc\(/);
  assert.match(clientSource, /profile\.role !== 'super_admin'/);
});

test('integration status alias reuses the existing Vercel admin function', () => {
  const rewrite = vercelConfig.rewrites?.find(
    candidate => candidate.source === '/api/admin/integrations/status'
  );
  assert.deepEqual(rewrite, {
    source: '/api/admin/integrations/status',
    destination: '/api/admin/operations/health?transport=integration-readiness',
  });
  assert.match(clientSource, /\/api\/admin\/operations\/health\?transport=integration-readiness/);
});
