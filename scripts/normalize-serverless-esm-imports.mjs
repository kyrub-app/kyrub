import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['api', 'server', 'shared'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

const walk = directory => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [absolute] : [];
  });
};

const resolveRuntimeSpecifier = (fromFile, specifier) => {
  if (!specifier.startsWith('.')) return specifier;
  if (RUNTIME_EXTENSIONS.has(path.extname(specifier))) return specifier;

  const absoluteBase = path.resolve(path.dirname(fromFile), specifier);
  for (const extension of SOURCE_EXTENSIONS) {
    if (fs.existsSync(`${absoluteBase}${extension}`)) return `${specifier}.js`;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    if (fs.existsSync(path.join(absoluteBase, `index${extension}`))) {
      return `${specifier.replace(/\/$/, '')}/index.js`;
    }
  }
  return specifier;
};

const rewriteFile = file => {
  const original = fs.readFileSync(file, 'utf8');
  let updated = original;
  const patterns = [
    /(\bfrom\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    /(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g,
    /(\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
  ];

  for (const pattern of patterns) {
    updated = updated.replace(pattern, (match, prefix, specifier, suffix) => {
      const normalized = resolveRuntimeSpecifier(file, specifier);
      return `${prefix}${normalized}${suffix}`;
    });
  }

  if (updated === original) return false;
  fs.writeFileSync(file, updated);
  return true;
};

const files = SOURCE_ROOTS.flatMap(root => walk(path.join(ROOT, root)));
const changed = files.filter(rewriteFile);

console.log(
  `[serverless-esm] normalized ${changed.length} file(s) across ${files.length} runtime source file(s).`
);
if (changed.length > 0) {
  for (const file of changed.slice(0, 40)) {
    console.log(`[serverless-esm] ${path.relative(ROOT, file)}`);
  }
  if (changed.length > 40) {
    console.log(`[serverless-esm] ... and ${changed.length - 40} more file(s).`);
  }
}
