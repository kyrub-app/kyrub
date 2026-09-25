import fs from 'node:fs';
import { spawn } from 'node:child_process';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const prebuild = packageJson?.scripts?.prebuild;
if (typeof prebuild !== 'string') throw new Error('package.json does not define scripts.prebuild');

const testFiles = [...new Set(
  [...prebuild.matchAll(/tests\/[A-Za-z0-9._/-]+\.(?:ts|mjs|js)/g)].map(match => match[0]),
)];
if (testFiles.length === 0) throw new Error('No test files found in scripts.prebuild');

const concurrency = Math.max(1, Number.parseInt(process.env.DIAGNOSTIC_CONCURRENCY ?? '4', 10) || 4);
const results = new Array(testFiles.length);
let cursor = 0;

const runOne = (file) => new Promise(resolve => {
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--import', 'tsx', file], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => resolve({ file, status: 1, stdout, stderr: `${stderr}\n${error.stack ?? error.message}`.trim() }));
  child.on('close', code => resolve({ file, status: code ?? 1, stdout, stderr }));
});

const worker = async () => {
  for (;;) {
    const index = cursor++;
    if (index >= testFiles.length) return;
    const result = await runOne(testFiles[index]);
    results[index] = result;
    console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${result.file}`);
  }
};

await Promise.all(Array.from({ length: Math.min(concurrency, testFiles.length) }, () => worker()));

const failures = results.filter(result => result.status !== 0);
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  failures: failures.map(({ file, status, stdout, stderr }) => ({ file, status, stdout, stderr })),
};

fs.mkdirSync('diagnostics', { recursive: true });
fs.writeFileSync('diagnostics/prebuild-test-failures.json', JSON.stringify(report, null, 2));
fs.writeFileSync(
  'diagnostics/prebuild-test-failures.txt',
  failures.length === 0
    ? `All ${results.length} prebuild test files passed.\n`
    : failures.map(({ file, status, stdout, stderr }) => [
        `===== ${file} (exit ${status}) =====`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join('\n')).join('\n\n'),
);

console.log(`Prebuild diagnostic: ${report.passed}/${report.total} files passed; ${report.failed} failed.`);
process.exit(failures.length === 0 ? 0 : 1);
