import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, 'api');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node', '.wasm']);

const toPosix = value => value.split(path.sep).join('/');

const walk = directory => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [absolute] : [];
  });
};

const resolveRelativeSource = (fromFile, specifier) => {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const explicitExtension = path.extname(specifier);
  if (explicitExtension) return null;

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { source: candidate, runtimeSpecifier: `${specifier}.js` };
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const slash = specifier.endsWith('/') ? '' : '/';
      return { source: candidate, runtimeSpecifier: `${specifier}${slash}index.js` };
    }
  }

  return null;
};

const SPECIFIER_PATTERNS = [
  /(\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?)(['"])(\.{1,2}\/[^'"\n]+)(\2)/g,
  /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)(\2)(\s*\))/g,
];

const collectRelativeSpecifiers = content => {
  const matches = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content))) {
      matches.push(match[3]);
    }
  }
  return [...new Set(matches)];
};

const entryPoints = walk(API_ROOT);
const reachable = new Set();
const queue = [...entryPoints];

while (queue.length > 0) {
  const file = queue.pop();
  const normalized = path.resolve(file);
  if (reachable.has(normalized)) continue;
  reachable.add(normalized);

  const content = fs.readFileSync(normalized, 'utf8');
  for (const specifier of collectRelativeSpecifiers(content)) {
    if (!specifier.startsWith('.')) continue;
    if (RUNTIME_EXTENSIONS.has(path.extname(specifier))) continue;
    const resolved = resolveRelativeSource(normalized, specifier);
    if (resolved && !reachable.has(resolved.source)) queue.push(resolved.source);
  }
}

let changedFiles = 0;
let changedSpecifiers = 0;
const unresolved = [];

for (const file of [...reachable].sort()) {
  const original = fs.readFileSync(file, 'utf8');
  let content = original;

  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    content = content.replace(pattern, (...args) => {
      const fullMatch = args[0];
      const prefix = args[1];
      const quote = args[2];
      const specifier = args[3];
      const closingQuote = args[4];
      const suffix = args[5] ?? '';

      if (RUNTIME_EXTENSIONS.has(path.extname(specifier))) return fullMatch;
      const resolved = resolveRelativeSource(file, specifier);
      if (!resolved) {
        unresolved.push(`${toPosix(path.relative(ROOT, file))}: ${specifier}`);
        return fullMatch;
      }
      changedSpecifiers += 1;
      return `${prefix}${quote}${resolved.runtimeSpecifier}${closingQuote}${suffix}`;
    });
  }

  if (content !== original) {
    fs.writeFileSync(file, content);
    changedFiles += 1;
  }
}

const remaining = [];
for (const file of [...reachable].sort()) {
  const content = fs.readFileSync(file, 'utf8');
  for (const specifier of collectRelativeSpecifiers(content)) {
    if (!specifier.startsWith('.')) continue;
    if (RUNTIME_EXTENSIONS.has(path.extname(specifier))) continue;
    if (resolveRelativeSource(file, specifier)) {
      remaining.push(`${toPosix(path.relative(ROOT, file))}: ${specifier}`);
    }
  }
}

console.log(`[serverless-esm] traced ${reachable.size} modules from ${entryPoints.length} API entry points`);
console.log(`[serverless-esm] normalized ${changedSpecifiers} specifiers across ${changedFiles} files`);

if (unresolved.length > 0) {
  console.warn(`[serverless-esm] ${new Set(unresolved).size} relative specifiers were not local TS modules and were left unchanged`);
}

if (remaining.length > 0) {
  console.error('[serverless-esm] extensionless local ESM imports remain:');
  for (const item of [...new Set(remaining)]) console.error(`- ${item}`);
  process.exit(1);
}
