import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const prebuild = packageJson?.scripts?.prebuild;

if (typeof prebuild !== 'string') {
  console.error('package.json does not define scripts.prebuild');
  process.exit(1);
}

const testFiles = [...new Set(
  [...prebuild.matchAll(/tests\/[A-Za-z0-9._/-]+\.(?:ts|mjs|js)/g)].map((match) => match[0]),
)];

const chunkIndex = Number.parseInt(process.env.CHUNK_INDEX ?? '', 10);
const chunkCount = Number.parseInt(process.env.CHUNK_COUNT ?? '', 10);

if (
  !Number.isInteger(chunkIndex) ||
  !Number.isInteger(chunkCount) ||
  chunkCount < 1 ||
  chunkIndex < 0 ||
  chunkIndex >= chunkCount
) {
  console.error(`Invalid chunk selection: CHUNK_INDEX=${process.env.CHUNK_INDEX} CHUNK_COUNT=${process.env.CHUNK_COUNT}`);
  process.exit(1);
}

if (testFiles.length === 0) {
  console.error('No test files found in scripts.prebuild');
  process.exit(1);
}

const start = Math.floor((testFiles.length * chunkIndex) / chunkCount);
const end = Math.floor((testFiles.length * (chunkIndex + 1)) / chunkCount);
const selected = testFiles.slice(start, end);

console.log(`Running prebuild diagnostic chunk ${chunkIndex + 1}/${chunkCount}`);
console.log(`Selected ${selected.length} of ${testFiles.length} test files (${start + 1}-${end})`);
for (const file of selected) console.log(` - ${file}`);

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=4', '--import', 'tsx', ...selected],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
