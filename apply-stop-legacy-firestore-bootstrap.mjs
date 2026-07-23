import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const legacyPath = path.join(root, 'src', 'LegacyApp.tsx');
const notesPath = path.join(root, 'src', 'hooks', 'useProductivityNotes.ts');
const testPath = path.join(root, 'tests', 'legacy-firestore-bootstrap.test.ts');
const packagePath = path.join(root, 'package.json');

for (const requiredPath of [legacyPath, notesPath, packagePath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Arquivo não encontrado: ${requiredPath}`);
  }
}

const normalize = value => value.replace(/\r\n/g, '\n');

let legacy = normalize(fs.readFileSync(legacyPath, 'utf8'));
let notes = normalize(fs.readFileSync(notesPath, 'utf8'));

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Não encontrei o bloco esperado: ${label}. Nenhum arquivo foi salvo.`);
  }

  return source.replace(pattern, replacement);
}

legacy = replaceRequired(
  legacy,
  /import \{ saveDocLWW, listenCollection, syncOfflineBatch, resolveConflictLWW \} from '\.\/utils\/syncEngine';/,
  "import { listenCollection, resolveConflictLWW } from './utils/syncEngine';",
  'importações do syncEngine'
);

legacy = replaceRequired(
  legacy,
  /import \{ classifyFirestoreFailure \} from '\.\/utils\/firestoreFailure';\n/,
  '',
  'importação de classifyFirestoreFailure'
);

legacy = replaceRequired(
  legacy,
  /const logBackgroundSyncFailure = \([\s\S]*?\n\};\n\nconst getUserStoreCacheKey/,
  'const getUserStoreCacheKey',
  'logger da sincronização legada'
);

function keepLocalOnly(key, variable) {
  const pattern = new RegExp(
    String.raw`  useEffect\(\(\) => \{\n    if \(!isLoggedIn\) return;\n    localStorage\.setItem\(STORAGE_KEYS\.${key}, JSON\.stringify\(${variable}\)\);[\s\S]*?\n  \}, \[${variable}, isLoggedIn\]\);`
  );

  const replacement =
`  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.${key}, JSON.stringify(${variable}));
  }, [${variable}, isLoggedIn]);`;

  legacy = replaceRequired(
    legacy,
    pattern,
    replacement,
    `persistência local de ${key}`
  );
}

keepLocalOnly('TENANTS', 'tenants');
keepLocalOnly('PRODUCTS', 'products');
keepLocalOnly('ORDERS', 'orders');
keepLocalOnly('POSTS', 'posts');
keepLocalOnly('DELIVERIES', 'deliveries');
keepLocalOnly('FREELANCE_JOBS', 'freelanceJobs');
keepLocalOnly('MOMENTOS', 'momentos');
keepLocalOnly('NOTES', 'notes');

legacy = replaceRequired(
  legacy,
  /        try \{\n          triggerToast\('Conectando e sincronizando dados com Firestore\.\.\.', 'info'\);[\s\S]*?\n        \}\n      \} else \{/,
  '      } else {',
  'bootstrap global executado após o login'
);

legacy = replaceRequired(
  legacy,
  /  \/\/ Real-time Firestore Snapshot subscriptions\n  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[isLoggedIn\]\);\n\n  useEffect\(\(\) => \{\n    const checkAlarms/,
`  // Keep only the authorized signed-in user directory listener.
  useEffect(() => {
    if (!isLoggedIn) return;

    const unsubscribeUsers = listenCollection('users', docs => {
      setDbUsers(docs);
    });

    return () => {
      unsubscribeUsers();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    const checkAlarms`,
  'listeners globais de coleções legadas'
);

legacy = legacy.replace(
  '// Firebase auth state listener and global Initial Sync',
  '// Firebase auth state listener and authorized profile/store initialization'
);

notes = replaceRequired(
  notes,
  /import \{ db \} from '\.\.\/utils\/firebase';\n/,
  '',
  'importação do Firestore no hook de notas'
);

notes = replaceRequired(
  notes,
  /import \{ doc, deleteDoc \} from 'firebase\/firestore';\n/,
  '',
  'operações Firestore no hook de notas'
);

notes = replaceRequired(
  notes,
  /    console\.log\(`\[Firestore\] Deletando documento em 'tasks\/\$\{noteId\}'`\);\n    deleteDoc\(doc\(db, 'tenants\/tenant_default\/tasks', noteId\)\)\n      \.catch\(err => console\.error\("Error deleting note in Firestore:", err\)\);\n\n/,
  "    // Notes remain local until the private per-user sync is implemented.\n",
  'exclusão de nota no tenant fixo'
);

notes = notes.replaceAll('[Firestore]', '[Local]');

const contractTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyApp = fs.readFileSync('src/LegacyApp.tsx', 'utf8');
const productivityNotes = fs.readFileSync(
  'src/hooks/useProductivityNotes.ts',
  'utf8'
);

test('legacy bootstrap does not write unsupported Firestore collections', () => {
  assert.doesNotMatch(legacyApp, /saveDocLWW/);
  assert.doesNotMatch(legacyApp, /syncOfflineBatch/);
  assert.doesNotMatch(legacyApp, /tenant_default/);

  for (const collectionPath of [
    'social_feed',
    'posts',
    'momentos',
    'delivery_jobs',
    'deliveries',
    'freelance_jobs',
    'social_tasks',
    'shared_notes'
  ]) {
    assert.equal(
      legacyApp.includes(\`listenCollection('\${collectionPath}'\`),
      false,
      \`unsupported listener remained for \${collectionPath}\`
    );
  }
});

test('authorized user directory listener remains active', () => {
  assert.match(legacyApp, /listenCollection\\('users'/);
});

test('notes no longer delete from the fixed legacy tenant', () => {
  assert.doesNotMatch(productivityNotes, /tenant_default/);
  assert.doesNotMatch(productivityNotes, /deleteDoc/);
  assert.doesNotMatch(productivityNotes, /from 'firebase\\/firestore'/);
});
`;

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const testCommand = 'tests/legacy-firestore-bootstrap.test.ts';

if (!packageJson.scripts?.prebuild) {
  throw new Error('Script prebuild não encontrado no package.json.');
}

if (!packageJson.scripts.prebuild.includes(testCommand)) {
  packageJson.scripts.prebuild += ` ${testCommand}`;
}

fs.writeFileSync(legacyPath, legacy, 'utf8');
fs.writeFileSync(notesPath, notes, 'utf8');
fs.writeFileSync(testPath, contractTest, 'utf8');
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log('Correção aplicada com sucesso.');
console.log('- bootstrap global legado removido');
console.log('- listeners não autorizados removidos');
console.log('- módulos antigos mantidos apenas no armazenamento local');
console.log('- diretório real de usuários preservado');
console.log('- teste de contrato adicionado ao prebuild');
