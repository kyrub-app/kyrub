import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  '.env.example',
  'api/health.ts',
  'src/components/AppErrorBoundary.tsx',
  'docs/ARCHITECTURE.md',
  'docs/ENVIRONMENT.md',
  'docs/MVP_CLOSURE.md',
  'docs/BETA_TEST_PLAN.md',
  'docs/RELEASE_CHECKLIST.md',
  'docs/INCIDENT_RUNBOOK.md',
  'docs/AI_USAGE_GOVERNANCE.md',
  'docs/PRIVACY_SECURITY_READINESS.md',
  'docs/KYRUBIA.md',
];

const missingFiles = requiredFiles.filter(path => !existsSync(path));
assert.deepEqual(
  missingFiles,
  [],
  `MVP readiness files are missing: ${missingFiles.join(', ')}`
);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const requiredScripts = [
  'lint',
  'prebuild',
  'build',
  'test:rules',
  'test:operational',
  'operations:check',
  'mvp:check',
];

for (const script of requiredScripts) {
  assert.equal(
    typeof packageJson.scripts?.[script],
    'string',
    `package.json is missing script: ${script}`
  );
}

const readme = readFileSync('README.md', 'utf8');
assert.match(readme, /^# Kyrub/m);
assert.doesNotMatch(readme, /Run and deploy your AI Studio app/i);
assert.match(readme, /docs\/RELEASE_CHECKLIST\.md/);
assert.match(readme, /api\/health/);

const mainSource = readFileSync('src/main.tsx', 'utf8');
assert.match(mainSource, /<AppErrorBoundary>/);

const healthSource = readFileSync('api/health.ts', 'utf8');
assert.match(healthSource, /Cache-Control/);
assert.match(healthSource, /capabilities/);
assert.doesNotMatch(healthSource, /GEMINI_API_KEY[^\n]*json/i);

console.log(
  `MVP readiness contract satisfied: ${requiredFiles.length} files and ${requiredScripts.length} scripts validated.`
);
