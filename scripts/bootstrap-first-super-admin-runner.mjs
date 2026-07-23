import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'scripts', 'bootstrap-first-super-admin.mjs');
const env = { ...process.env };

if (process.platform === 'win32') {
  // Use a repository-relative path without spaces. The proxy itself quotes the
  // real Google Cloud SDK installation path before invoking gcloud.cmd.
  env.GCLOUD_CMD = 'scripts\\gcloud-windows-proxy.cmd';
}

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Não foi possível iniciar o bootstrap administrativo: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
