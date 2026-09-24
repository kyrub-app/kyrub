import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API_ROOT = 'api';
const VERCEL_HOBBY_FUNCTION_LIMIT = 12;
const KYRUB_RESERVED_FUNCTION_SLOTS = 1;
const KYRUB_MAX_ACTIVE_FUNCTIONS =
  VERCEL_HOBBY_FUNCTION_LIMIT - KYRUB_RESERVED_FUNCTION_SLOTS;

const isFunctionFile = (name) =>
  /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/.test(name) && !name.endsWith('.d.ts');

const collectFunctions = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFunctions(path);
    return isFunctionFile(entry.name) ? [path] : [];
  });

const functions = collectFunctions(API_ROOT)
  .map((path) => relative('.', path).split(sep).join('/'))
  .sort();

const headroom = VERCEL_HOBBY_FUNCTION_LIMIT - functions.length;

console.log(
  `[Vercel function budget] ${functions.length}/${VERCEL_HOBBY_FUNCTION_LIMIT} active; ` +
  `${headroom} slot${headroom === 1 ? '' : 's'} free; ` +
  `${KYRUB_RESERVED_FUNCTION_SLOTS} reserved.`
);
for (const path of functions) console.log(` - ${path}`);

if (functions.length > VERCEL_HOBBY_FUNCTION_LIMIT) {
  console.error(
    `[Vercel function budget] HARD LIMIT EXCEEDED: Hobby allows ${VERCEL_HOBBY_FUNCTION_LIMIT}.`
  );
  process.exit(1);
}

if (functions.length > KYRUB_MAX_ACTIVE_FUNCTIONS) {
  console.error(
    `[Vercel function budget] Reserved headroom consumed. Kyrub permits at most ` +
    `${KYRUB_MAX_ACTIVE_FUNCTIONS} active functions so one Hobby slot remains available. ` +
    `Reuse an existing multiplexer or explicitly review this budget before adding a function.`
  );
  process.exit(1);
}
