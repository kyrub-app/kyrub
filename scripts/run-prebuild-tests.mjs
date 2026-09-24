import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const prebuildScript = String(packageJson.scripts?.prebuild ?? '');
const testFiles = prebuildScript
  .split(/\s+/)
  .filter(token => token.startsWith('tests/'));

if (testFiles.length === 0) {
  throw new Error('Nenhum teste do prebuild foi encontrado no package.json.');
}

const chunkSize = 25;
const testConcurrency = 4;

for (let offset = 0; offset < testFiles.length; offset += chunkSize) {
  const chunk = testFiles.slice(offset, offset + chunkSize);
  const block = Math.floor(offset / chunkSize) + 1;
  console.log(`[prebuild] Bloco ${block}: ${chunk.length} arquivo(s)`);

  const result = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-concurrency=${testConcurrency}`,
      '--import',
      'tsx',
      ...chunk,
    ],
    {
      stdio: 'inherit',
      env: process.env,
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
