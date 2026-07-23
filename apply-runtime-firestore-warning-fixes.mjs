import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marketplacePath = path.join(root, 'src', 'components', 'tabs', 'KyrubTab.tsx');
const retailerPath = path.join(root, 'src', 'components', 'LegacyRetailerPanel.tsx');
const legacyMarketplacePath = path.join(
  root,
  'src',
  'components',
  'tabs',
  'LegacyKyrubTab.tsx'
);
const packagePath = path.join(root, 'package.json');
const testPath = path.join(root, 'tests', 'runtime-firestore-warnings.test.ts');

for (const requiredPath of [
  marketplacePath,
  retailerPath,
  legacyMarketplacePath,
  packagePath,
]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Arquivo não encontrado: ${requiredPath}`);
  }
}

const normalize = value => value.replace(/\r\n/g, '\n');

function replaceRequired(source, search, replacement, label) {
  const found = typeof search === 'string' ? source.includes(search) : search.test(source);
  if (!found) {
    throw new Error(`Não encontrei o bloco esperado: ${label}. Nenhum arquivo foi salvo.`);
  }

  return source.replace(search, replacement);
}

let marketplace = normalize(fs.readFileSync(marketplacePath, 'utf8'));
let retailer = normalize(fs.readFileSync(retailerPath, 'utf8'));
let legacyMarketplace = normalize(
  fs.readFileSync(legacyMarketplacePath, 'utf8')
);

marketplace = replaceRequired(
  marketplace,
  "type KyrubTabProps = React.ComponentProps<typeof LegacyKyrubTab>;\n",
  `type KyrubTabProps = React.ComponentProps<typeof LegacyKyrubTab>;

const CANONICAL_MARKETPLACE_READ_ENABLED =
  import.meta.env.VITE_ENABLE_CANONICAL_MARKETPLACE_READ === 'true';
`,
  'controle da leitura canônica do marketplace'
);

marketplace = replaceRequired(
  marketplace,
  /      const canonicalQuery = query\([\s\S]*?      \);\n\n      const fallbackQuery/,
  `      if (CANONICAL_MARKETPLACE_READ_ENABLED) {
        const canonicalQuery = query(
          collection(db, getMarketplaceListingsCollectionPath()),
          where('publicationStatus', '==', 'published')
        );
        unsubscribeCanonical = onSnapshot(
          canonicalQuery,
          snapshot => {
            const stores = snapshot.docs.flatMap(snapshotDocument => {
              const listing = snapshotDocument.data() as MarketplaceListingDocument;
              return listing.listingType === 'store'
                ? [canonicalListingToStore(listing)]
                : [];
            });
            setCanonicalStores(stores);
          },
          error => {
            console.warn('Canonical marketplace listings are unavailable.', error);
            setCanonicalStores([]);
          }
        );
      }

      const fallbackQuery`,
  'listener canônico do marketplace'
);

retailer = replaceRequired(
  retailer,
  "import { db } from '../utils/firebase';\nimport { doc, runTransaction, deleteDoc } from 'firebase/firestore';\nimport { listenCollection, saveDocLWW } from '../utils/syncEngine';\n",
  '',
  'importações Firestore do painel legado'
);

retailer = replaceRequired(
  retailer,
  'const erpDB = new DexieERPDB();\n',
  `const erpDB = new DexieERPDB();

const getLegacyActiveTicketsStorageKey = (storeId: string): string =>
  \`kyrub_legacy_active_tickets_\${storeId}\`;
`,
  'chave local dos atendimentos legados'
);

retailer = replaceRequired(
  retailer,
  '  const [activeTickets, setActiveTickets] = useState<any[]>([]);\n',
  `  const [activeTickets, setActiveTickets] = useState<any[]>([]);
  const [activeTicketsCacheStoreId, setActiveTicketsCacheStoreId] =
    useState('');
`,
  'estado dos atendimentos legados'
);

retailer = replaceRequired(
  retailer,
  /  useEffect\(\(\) => \{\n    const tenantId = activeRetailerId \|\| 'tenant_default';[\s\S]*?\n  \}, \[activeRetailerId\]\);/,
  `  useEffect(() => {
    if (!activeRetailerId) {
      setActiveTickets([]);
      setActiveTicketsCacheStoreId('');
      return;
    }

    try {
      const saved = localStorage.getItem(
        getLegacyActiveTicketsStorageKey(activeRetailerId)
      );
      const parsed = saved ? JSON.parse(saved) : [];
      setActiveTickets(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.warn('Falha ao ler atendimentos locais da loja:', error);
      setActiveTickets([]);
    }

    setActiveTicketsCacheStoreId(activeRetailerId);
  }, [activeRetailerId]);

  useEffect(() => {
    if (
      !activeRetailerId ||
      activeTicketsCacheStoreId !== activeRetailerId
    ) {
      return;
    }

    localStorage.setItem(
      getLegacyActiveTicketsStorageKey(activeRetailerId),
      JSON.stringify(activeTickets)
    );
  }, [activeRetailerId, activeTickets, activeTicketsCacheStoreId]);`,
  'listener remoto dos atendimentos legados'
);

retailer = replaceRequired(
  retailer,
  '  const handleOpenTicket = async () => {',
  '  const handleOpenTicket = () => {',
  'abertura de atendimento local'
);

retailer = replaceRequired(
  retailer,
  '    setActiveTickets([newTicket, ...activeTickets]);',
  '    setActiveTickets(previous => [newTicket, ...previous]);',
  'atualização local dos atendimentos'
);

retailer = replaceRequired(
  retailer,
  /\n    \/\/ Dual-write to Firestore in background\n    const tenantId = activeRetailerId \|\| 'tenant_default';\n    await saveDocLWW\(`tenants\/\$\{tenantId\}\/active_sessions`, id, newTicket\);/,
  '',
  'dual-write de active_sessions'
);

retailer = replaceRequired(
  retailer,
  /  const handleCheckoutTicket = async \(ticketId: string\) => \{[\s\S]*?\n  \};\n\n  const handleManualProductAddition/,
  `  const handleCheckoutTicket = (ticketId: string) => {
    const ticket = activeTickets.find(item => item.id === ticketId);
    if (!ticket) return;

    // This legacy attendance card stays local until it is replaced by the
    // canonical table and order workflow rendered by RetailerPanel.tsx.
    registerFiscalIntegrationPending();
    setActiveTickets(previous =>
      previous.filter(item => item.id !== ticketId)
    );
    triggerToast(
      \`Atendimento \${ticket.id} fechado neste dispositivo. Emissão fiscal ainda não configurada.\`,
      'success'
    );
  };

  const handleManualProductAddition`,
  'fechamento remoto dos atendimentos legados'
);

retailer = replaceRequired(
  retailer,
  /                          onClick=\{async \(\) => \{[\s\S]*?                            triggerToast\('Atendimento cancelado\.', 'info'\);\n                          \}\}/,
  `                          onClick={() => {
                            setActiveTickets(previous =>
                              previous.filter(item => item.id !== ticket.id)
                            );
                            triggerToast('Atendimento cancelado.', 'info');
                          }}`,
  'exclusão remota dos atendimentos legados'
);

legacyMarketplace = replaceRequired(
  legacyMarketplace,
  `                        <img 
                          src={store.logo} 
                          alt={store.name} 
                          className="w-8.5 h-8.5 object-cover rounded-xl border border-slate-800 bg-slate-900 shadow-md" 
                          referrerPolicy="no-referrer" 
                        />`,
  `                        {store.logo ? (
                          <img
                            src={store.logo}
                            alt={store.name}
                            className="w-8.5 h-8.5 object-cover rounded-xl border border-slate-800 bg-slate-900 shadow-md"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div
                            className="flex w-8.5 h-8.5 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-500 shadow-md"
                            role="img"
                            aria-label="Logo da loja não informado"
                          >
                            <StoreIcon className="h-4 w-4" />
                          </div>
                        )}`,
  'placeholder da logo vazia'
);

const testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const marketplace = fs.readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const retailer = fs.readFileSync(
  'src/components/LegacyRetailerPanel.tsx',
  'utf8'
);
const legacyMarketplace = fs.readFileSync(
  'src/components/tabs/LegacyKyrubTab.tsx',
  'utf8'
);

test('canonical marketplace reading is opt-in until backend activation', () => {
  const guardIndex = marketplace.indexOf(
    'if (CANONICAL_MARKETPLACE_READ_ENABLED)'
  );
  const canonicalPathIndex = marketplace.indexOf(
    'getMarketplaceListingsCollectionPath()'
  );

  assert.match(marketplace, /VITE_ENABLE_CANONICAL_MARKETPLACE_READ/);
  assert.ok(guardIndex >= 0);
  assert.ok(canonicalPathIndex > guardIndex);
});

test('legacy active tickets remain scoped to local storage', () => {
  assert.match(retailer, /kyrub_legacy_active_tickets_/);
  assert.doesNotMatch(retailer, /active_sessions/);
  assert.doesNotMatch(retailer, /tenant_default/);
  assert.doesNotMatch(retailer, /saveDocLWW/);
  assert.doesNotMatch(retailer, /listenCollection/);
  assert.doesNotMatch(retailer, /runTransaction/);
  assert.doesNotMatch(retailer, /deleteDoc/);
  assert.doesNotMatch(retailer, /from 'firebase\\/firestore'/);
});

test('marketplace logo does not render an empty src attribute', () => {
  assert.doesNotMatch(legacyMarketplace, /src=\\{store\\.logo\\}/);
  assert.match(legacyMarketplace, /\\{store\\.logo \\? \\(/);
  assert.match(legacyMarketplace, /Logo da loja não informado/);
});
`;

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const testCommand = 'tests/runtime-firestore-warnings.test.ts';

if (!packageJson.scripts?.prebuild) {
  throw new Error('Script prebuild não encontrado no package.json.');
}

if (!packageJson.scripts.prebuild.includes(testCommand)) {
  packageJson.scripts.prebuild += ` ${testCommand}`;
}

fs.writeFileSync(marketplacePath, marketplace, 'utf8');
fs.writeFileSync(retailerPath, retailer, 'utf8');
fs.writeFileSync(legacyMarketplacePath, legacyMarketplace, 'utf8');
fs.writeFileSync(testPath, testContent, 'utf8');
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log('Correção aplicada com sucesso.');
console.log('- marketplace canônico agora é opt-in por variável de ambiente');
console.log('- active_sessions legado removido do Firestore');
console.log('- atendimentos legados preservados por loja no localStorage');
console.log('- logo vazia substituída por placeholder sem dado comercial fictício');
console.log('- teste de regressão incluído no prebuild');
