import { build } from 'esbuild';

await build({
  entryPoints: ['functions/index.ts'], outfile: 'functions/lib/index.cjs',
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  packages: 'external',
});
