from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    print(f'[migration] {label}')
    count = source.count(old)
    if count != 1:
        raise AssertionError(
            f'{label}: expected one match, found {count}'
        )
    return source.replace(old, new, 1)


def replace_one_of(
    source: str,
    variants: list[str],
    new: str,
    label: str,
) -> str:
    print(f'[migration] {label}')
    matches = [variant for variant in variants if source.count(variant) == 1]
    total_matches = sum(source.count(variant) for variant in variants)
    if total_matches != 1 or len(matches) != 1:
        raise AssertionError(
            f'{label}: expected one variant, found {total_matches}'
        )
    return source.replace(matches[0], new, 1)


def replace_between(
    source: str,
    start: str,
    end: str,
    replacement: str,
    label: str,
) -> str:
    print(f'[migration] {label}')
    start_index = source.find(start)
    if start_index < 0:
        raise AssertionError(f'{label}: start marker not found')
    end_index = source.find(end, start_index)
    if end_index < 0:
        raise AssertionError(f'{label}: end marker not found')
    return source[:start_index] + replacement + source[end_index:]


app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

app = replace_once(
    app,
    "import { Tenant, Store, Product, Order, CartItem, Note, Friend, SocialPost, DeliveryJob, FreelanceJob } from './types';",
    "import { Tenant, Store, Product, Order, CartItem, Note, Friend, SocialPost, DeliveryJob, FreelanceJob, type UserStoreDocument } from './types';",
    'App type import',
)

app = replace_once(
    app,
    "import { classifyFirestoreFailure } from './utils/firestoreFailure';",
    """import { classifyFirestoreFailure } from './utils/firestoreFailure';
import { getPrimaryUserStoreDocumentPath } from './utils/storePaths';
import {
  buildUserStoreCreateData,
  buildUserStoreUpdateData,
  type BuildUserStoreCreateInput,
  type BuildUserStoreUpdateInput,
} from './utils/userStoreDocument';""",
    'App user store imports',
)

app = replace_once(
    app,
    "  STORES: 'kyrub_stores',\n",
    '',
    'Remove global store cache key',
)

app = replace_once(
    app,
    """  });
};

export default function App() {""",
    """  });
};

const getUserStoreCacheKey = (uid: string): string =>
  `kyrub_user_store_${uid}`;

const createEmptyUserStore = (
  uid: string,
  ownerEmail: string
): Store => ({
  id: uid,
  name: '',
  slug: '',
  description: '',
  logo: '',
  banner: '',
  primaryColor: '',
  plan: 'free',
  ownerEmail,
  address: '',
  contact: '',
  keywords: [],
  offerImages: [],
  status: 'closed',
});

const mapUserStoreDocumentToStore = (
  data: UserStoreDocument
): Store => ({
  id: data.id,
  name: data.name,
  slug: data.slug,
  description: data.description,
  logo: data.logo,
  banner: data.banner,
  primaryColor: data.primaryColor,
  plan: data.plan,
  ownerEmail: data.ownerEmail,
  address: data.address,
  contact: data.contact,
  keywords: [...data.keywords],
  offerImages: [...data.offerImages],
  status: data.status,
  lat: data.lat,
  lng: data.lng,
});

const getUserStoreCreateInput = (
  store: Store,
  uid: string,
  ownerEmail: string
): BuildUserStoreCreateInput => {
  const input: BuildUserStoreCreateInput = {
    uid,
    ownerEmail,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: [...(store.keywords ?? [])],
    offerImages: [...(store.offerImages ?? [])],
    address: store.address ?? '',
    contact: store.contact ?? '',
    status: store.status ?? 'closed',
  };

  if (
    typeof store.lat === 'number' &&
    typeof store.lng === 'number' &&
    Number.isFinite(store.lat) &&
    Number.isFinite(store.lng)
  ) {
    input.lat = store.lat;
    input.lng = store.lng;
  }

  return input;
};

export default function App() {""",
    'App user store helpers',
)

app = replace_once(
    app,
    """  const [stores, setStores] = useState<Store[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STORES);
    return saved ? JSON.parse(saved) : [];
  });""",
    "  const [stores, setStores] = useState<Store[]>([]);",
    'App store state',
)

app = replace_once(
    app,
    "  const [isLoggedIn, setIsLoggedIn] = useState(false);",
    """  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authenticatedUserId, setAuthenticatedUserId] = useState('');""",
    'App authenticated user state',
)

app = replace_once(
    app,
    """  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.STORES, JSON.stringify(stores));
  }, [stores, isLoggedIn]);""",
    """  useEffect(() => {
    if (!authenticatedUserId) return;

    const userStore = stores.find(
      store => store.id === authenticatedUserId
    );

    if (!userStore) return;

    localStorage.setItem(
      getUserStoreCacheKey(authenticatedUserId),
      JSON.stringify(userStore)
    );
  }, [stores, authenticatedUserId]);""",
    'App scoped store cache',
)

active_store_replacement = """  // The private ERP store is owned by the authenticated Firebase user.
  const activeRetailerId = authenticatedUserId;

  const activeStore = useMemo<Store>(() => {
    const existingStore = stores.find(
      store => store.id === activeRetailerId
    );

    if (existingStore) {
      return existingStore;
    }

    return createEmptyUserStore(activeRetailerId, profileEmail);
  }, [stores, activeRetailerId, profileEmail]);

  const activeRetailer = useMemo<Tenant | undefined>(() => {
    if (!activeRetailerId) return undefined;

    return tenants.find(tenant => tenant.id === activeRetailerId) ?? {
      id: activeRetailerId,
      name: profileName || profileEmail,
      email: profileEmail,
      role: 'retailer',
      plan: activeStore.plan,
    };
  }, [
    tenants,
    activeRetailerId,
    profileName,
    profileEmail,
    activeStore.plan,
  ]);

  const handleUpdateStoreProfile = async (
    updatedFields: BuildUserStoreUpdateInput
  ): Promise<void> => {
    const user = auth.currentUser;

    if (!user) {
      triggerToast(
        'Faça login novamente para atualizar sua loja.',
        'error'
      );
      throw new Error('Authenticated user is required.');
    }

    const ownerEmail = user.email ?? '';
    const persistedFields: BuildUserStoreUpdateInput = {
      ...updatedFields,
      ownerEmail,
    };

    const previousStore = activeStore;
    const nextStore: Store = {
      ...activeStore,
      ...persistedFields,
      id: user.uid,
      ownerEmail,
      address: persistedFields.address ?? activeStore.address ?? '',
      contact: persistedFields.contact ?? activeStore.contact ?? '',
      keywords: persistedFields.keywords
        ? [...persistedFields.keywords]
        : [...(activeStore.keywords ?? [])],
      offerImages: persistedFields.offerImages
        ? [...persistedFields.offerImages]
        : [...(activeStore.offerImages ?? [])],
      status: persistedFields.status ?? activeStore.status ?? 'closed',
    };

    setStores(previousStores => [
      nextStore,
      ...previousStores.filter(store => store.id !== user.uid),
    ]);

    const storeReference = doc(
      db,
      getPrimaryUserStoreDocumentPath(user.uid)
    );

    try {
      const storeSnapshot = await getDoc(storeReference);

      if (storeSnapshot.exists()) {
        await updateDoc(
          storeReference,
          buildUserStoreUpdateData(persistedFields)
        );
      } else {
        await setDoc(
          storeReference,
          buildUserStoreCreateData(
            getUserStoreCreateInput(nextStore, user.uid, ownerEmail)
          )
        );
      }
    } catch (error) {
      setStores(previousStores => {
        const otherStores = previousStores.filter(
          store => store.id !== user.uid
        );

        return previousStore.id
          ? [previousStore, ...otherStores]
          : otherStores;
      });

      console.error(
        'Falha ao atualizar a loja principal do usuário:',
        error
      );
      triggerToast(
        'Não foi possível salvar as alterações da loja.',
        'error'
      );
      throw error;
    }
  };

"""

app = replace_between(
    app,
    '  // Active Retailer state\n',
    '  useEffect(() => {\n    if (isConfigModalOpen && activeStore) {',
    active_store_replacement,
    'App active user store block',
)

app = replace_once(
    app,
    """  const handleSaveStoreProfile = () => {
    handleUpdateStoreProfile({
      name: configStoreName,
      description: configStoreBio,
      address: configStoreAddress,
      contact: configStoreContact,
      keywords: configStoreKeywords.split(',').map(k => k.trim()).filter(Boolean)
    });
    triggerToast('Perfil da loja atualizado com sucesso!', 'success');
    setIsConfigModalOpen(false);
  };""",
    """  const handleSaveStoreProfile = async () => {
    try {
      await handleUpdateStoreProfile({
        name: configStoreName,
        description: configStoreBio,
        address: configStoreAddress,
        contact: configStoreContact,
        keywords: configStoreKeywords
          .split(',')
          .map(keyword => keyword.trim())
          .filter(Boolean),
      });
      triggerToast(
        'Perfil da loja atualizado com sucesso!',
        'success'
      );
      setIsConfigModalOpen(false);
    } catch {
      // The persistence function already restored state and notified the user.
    }
  };""",
    'App save store profile',
)

app = replace_once(
    app,
    "  const isLimitReached = userRetailerProducts.length >= 5 && activeRetailer?.plan === 'free';",
    "  const isLimitReached = userRetailerProducts.length >= 5 && activeStore.plan === 'free';",
    'App store plan limit',
)

app = replace_once(
    app,
    """        setIsLoggedIn(true);
        setProfileName(user.displayName ?? '');
        setProfileEmail(user.email ?? '');
        setProfilePhotoUrl(user.photoURL ?? '');""",
    """        setIsLoggedIn(true);
        setAuthenticatedUserId(user.uid);
        setStores([]);
        setProfileName(user.displayName ?? '');
        setProfileEmail(user.email ?? '');
        setProfilePhotoUrl(user.photoURL ?? '');

        let cachedStore: Store | null = null;
        const cachedStoreValue = localStorage.getItem(
          getUserStoreCacheKey(user.uid)
        );

        if (cachedStoreValue) {
          try {
            const parsedStore = JSON.parse(cachedStoreValue) as Store;

            if (parsedStore.id === user.uid) {
              cachedStore = {
                ...createEmptyUserStore(user.uid, user.email ?? ''),
                ...parsedStore,
                id: user.uid,
                ownerEmail: user.email ?? '',
                keywords: Array.isArray(parsedStore.keywords)
                  ? parsedStore.keywords
                  : [],
                offerImages: Array.isArray(parsedStore.offerImages)
                  ? parsedStore.offerImages
                  : [],
              };
              setStores([cachedStore]);
            }
          } catch (error) {
            console.warn(
              'Falha ao ler o cache local da loja do usuário:',
              error
            );
          }
        }""",
    'App auth cache bootstrap',
)

app = replace_once(
    app,
    """        } catch (error) {
          console.error(
            'Falha ao registrar o usuário autenticado no Firestore:',
            error
          );
        }

        try {
          triggerToast('Conectando e sincronizando dados com Firestore...', 'info');""",
    """        } catch (error) {
          console.error(
            'Falha ao registrar o usuário autenticado no Firestore:',
            error
          );
        }

        try {
          const ownerEmail = user.email ?? '';
          const storeReference = doc(
            db,
            getPrimaryUserStoreDocumentPath(user.uid)
          );
          const storeSnapshot = await getDoc(storeReference);
          let userStore: Store;

          if (storeSnapshot.exists()) {
            userStore = mapUserStoreDocumentToStore(
              storeSnapshot.data() as UserStoreDocument
            );
          } else {
            userStore = createEmptyUserStore(user.uid, ownerEmail);
            await setDoc(
              storeReference,
              buildUserStoreCreateData(
                getUserStoreCreateInput(
                  userStore,
                  user.uid,
                  ownerEmail
                )
              )
            );
          }

          setStores(previousStores => [
            userStore,
            ...previousStores.filter(store => store.id !== user.uid),
          ]);
          localStorage.setItem(
            getUserStoreCacheKey(user.uid),
            JSON.stringify(userStore)
          );
        } catch (error) {
          console.warn(
            'Falha ao sincronizar a loja principal do usuário:',
            error
          );

          if (!cachedStore) {
            setStores([
              createEmptyUserStore(user.uid, user.email ?? ''),
            ]);
          }
        }

        try {
          triggerToast('Conectando e sincronizando dados com Firestore...', 'info');""",
    'App auth store synchronization',
)

app = replace_once(
    app,
    """      } else {
        setIsLoggedIn(false);
        setTenants([]);""",
    """      } else {
        setIsLoggedIn(false);
        setAuthenticatedUserId('');
        setTenants([]);""",
    'App clear authenticated user',
)

app = replace_once(
    app,
    """  const handlePremiumUpgrade = () => {
    setTenants(prev => prev.map(t => t.id === activeRetailerId ? { ...t, plan: 'business' } : t));
    setStores(prev => prev.map(s => s.id === 's-1' || s.id === 's-2' ? { ...s, plan: 'business' } : s));
    triggerToast('Parabéns! Sua organização foi promovida para Kyrub Premium Business!', 'success');
  };""",
    """  const handlePremiumUpgrade = () => {
    triggerToast(
      'A contratação do plano Business ainda não está configurada.',
      'info'
    );
  };""",
    'App premium upgrade',
)

app = replace_once(
    app,
    """    const activeStore = stores.find(s => s.id === 's-1'); // Default to Pixel Store
    const staffProducts = products.filter(p => p.supplierId === 't-3' && !p.wholesalePrice);
    const staffOrders = orders.filter(o => o.storeId === 's-1');""",
    """    const staffStore = activeStore.id ? activeStore : undefined;
    const staffProducts = activeRetailerId
      ? products.filter(
          product =>
            product.supplierId === activeRetailerId &&
            !product.wholesalePrice
        )
      : [];
    const staffOrders = staffStore
      ? orders.filter(order => order.storeId === staffStore.id)
      : [];""",
    'App staff store identity',
)

app = replace_once(
    app,
    '        activeStore={activeStore}\n        staffProducts={staffProducts}',
    '        activeStore={staffStore}\n        staffProducts={staffProducts}',
    'App staff store prop',
)

app = replace_once(
    app,
    """                setOrders={setOrders}
                setStores={setStores}
                triggerToast={triggerToast}""",
    """                setOrders={setOrders}
                onUpdateStore={handleUpdateStoreProfile}
                triggerToast={triggerToast}""",
    'App retailer update prop',
)

app_path.write_text(app, encoding='utf-8')

retailer_path = Path('src/components/RetailerPanel.tsx')
retailer = retailer_path.read_text(encoding='utf-8')

retailer = replace_once(
    retailer,
    "import { listenCollection, saveDocLWW } from '../utils/syncEngine';",
    """import { listenCollection, saveDocLWW } from '../utils/syncEngine';
import type { BuildUserStoreUpdateInput } from '../utils/userStoreDocument';""",
    'Retailer user store type import',
)

retailer = replace_once(
    retailer,
    "  setStores: React.Dispatch<React.SetStateAction<Store[]>>;",
    "  onUpdateStore: (updates: BuildUserStoreUpdateInput) => Promise<void>;",
    'Retailer update prop type',
)

retailer = replace_once(
    retailer,
    "  setStores,\n  triggerToast,",
    "  onUpdateStore,\n  triggerToast,",
    'Retailer update prop destructuring',
)

retailer = replace_once(
    retailer,
    """const activeStore: Store =
  stores.find(
    s => s.id === activeRetailerId || s.ownerEmail === activeRetailer?.email
  ) || {
    id: activeRetailerId,
    name: '',
    description: '',
    keywords: [],
    logo: '',
    banner: '',
    primaryColor: '',
    offerImages: [],
    slug: '',
    plan: 'free',
    ownerEmail: activeRetailer?.email || '',
  };""",
    """const activeStore: Store =
  stores.find(store => store.id === activeRetailerId) || {
    id: activeRetailerId,
    name: '',
    description: '',
    keywords: [],
    logo: '',
    banner: '',
    primaryColor: '',
    offerImages: [],
    slug: '',
    plan: 'free',
    ownerEmail: activeRetailer?.email || '',
    address: '',
    contact: '',
    status: 'closed',
  };""",
    'Retailer canonical active store',
)

retailer = replace_once(
    retailer,
    """  const [customImageUrl, setCustomImageUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vouchers state""",
    """  const [customImageUrl, setCustomImageUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStoreName(activeStore.name || '');
    setStoreDesc(activeStore.description || '');
    setStoreColor(activeStore.primaryColor || '#3b82f6');
    setStoreKeywords((activeStore.keywords || []).join(', '));
    setStoreOfferImages(activeStore.offerImages || []);
  }, [
    activeStore.id,
    activeStore.name,
    activeStore.description,
    activeStore.primaryColor,
    activeStore.keywords,
    activeStore.offerImages,
  ]);

  // Vouchers state""",
    'Retailer remote store form synchronization',
)

retailer = replace_one_of(
    retailer,
    [
        """  const registerFiscalIntegrationPending = () => {
    setLatestFiscalXml('');
    setFiscalLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Documento fiscal não emitido: integração fiscal ainda não configurada para esta loja.`,
      ...prev
    ]);
  };""",
        """  const registerFiscalIntegrationPending = () => {
  setLatestFiscalXml('');
  setFiscalLogs(prev => [
    `[${new Date().toLocaleTimeString()}] Documento fiscal não emitido: integração fiscal ainda não configurada para esta loja.`,
    ...prev
  ]);
};""",
    ],
    """  const registerFiscalIntegrationPending = () => {
    setLatestFiscalXml('');
    setFiscalLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Documento fiscal não emitido: integração fiscal ainda não configurada para esta loja.`,
      ...prev
    ]);
  };""",
    'Retailer fiscal formatting',
)

retailer = replace_one_of(
    retailer,
    [
        """    // The ticket is closed without fabricating price, stock or fiscal data.
    // Real stock and financial movements will be recorded when the sale flow
    // provides validated items, quantities and payment totals.
    registerFiscalIntegrationPending();

    setActiveTickets(prev => prev.filter(t => t.id !== ticketId));
    triggerToast(
      `Atendimento ${ticket.id} fechado. Emissão fiscal ainda não configurada.`,
      'success'
    );""",
        """  // The ticket is closed without fabricating price, stock or fiscal data.
  // Real stock and financial movements will be recorded when the sale flow
  // provides validated items, quantities and payment totals.
  registerFiscalIntegrationPending();

  setActiveTickets(prev => prev.filter(t => t.id !== ticketId));
  triggerToast(
    `Atendimento ${ticket.id} fechado. Emissão fiscal ainda não configurada.`,
    'success'
  );""",
    ],
    """    // The ticket is closed without fabricating price, stock or fiscal data.
    // Real stock and financial movements will be recorded when the sale flow
    // provides validated items, quantities and payment totals.
    registerFiscalIntegrationPending();

    setActiveTickets(prev => prev.filter(t => t.id !== ticketId));
    triggerToast(
      `Atendimento ${ticket.id} fechado. Emissão fiscal ainda não configurada.`,
      'success'
    );""",
    'Retailer close ticket formatting',
)

retailer = replace_once(
    retailer,
    """  const handlePlanUpgrade = () => {
    setStores(prev => prev.map(s => s.id === activeStore?.id ? { ...s, plan: 'business' } : s));
    setStores(prev => prev.map(s => {
      if (s.id === activeStore?.id) {
        return { ...s, plan: 'business' };
      }
      return s;
    }));
    // Trigger plan update on tenants list as well
    setStores(prev => {
      // Side-effect update of activeRetailer plan simulated via App state
      triggerToast('Parabéns! Sua loja foi promovida para o Plano Kyrub Business.', 'success');
      return prev;
    });
    // Dynamically upgrade plan state in tenants via trigger
    window.dispatchEvent(new CustomEvent('kyrub-upgrade-tenant', { detail: { id: activeRetailerId } }));
  };""",
    """  const handlePlanUpgrade = () => {
    triggerToast(
      'A contratação do plano Business ainda não está configurada.',
      'info'
    );
  };""",
    'Retailer plan upgrade',
)

retailer = replace_once(
    retailer,
    """  const handleSaveThemeCustomization = () => {
    if (!activeStore) return;
    const kwArray = storeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    setStores(prev => prev.map(s => s.id === activeStore.id ? {
      ...s,
      name: storeName,
      description: storeDesc,
      primaryColor: storeColor,
      keywords: kwArray,
      offerImages: storeOfferImages.length > 0 ? storeOfferImages : undefined
    } : s));
    triggerToast('Configurações de Vitrine e SEO Local gravadas!', 'success');
  };""",
    """  const handleSaveThemeCustomization = async () => {
    const keywords = storeKeywords
      .split(',')
      .map(keyword => keyword.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);

    try {
      await onUpdateStore({
        name: storeName,
        description: storeDesc,
        primaryColor: storeColor,
        keywords,
        offerImages: [...storeOfferImages],
      });
      triggerToast(
        'Configurações de Vitrine e SEO Local gravadas!',
        'success'
      );
    } catch {
      // The parent persistence handler already restored state and notified.
    }
  };""",
    'Retailer theme persistence',
)

retailer_path.write_text(retailer, encoding='utf-8')

types_path = Path('src/types/index.ts')
types_source = types_path.read_text(encoding='utf-8')
types_source = replace_once(
    types_source,
    """  plan: 'free' | 'business';
  ownerEmail: string;
  keywords?: string[];""",
    """  plan: 'free' | 'business';
  ownerEmail: string;
  address?: string;
  contact?: string;
  keywords?: string[];""",
    'Store contact fields',
)
types_path.write_text(types_source, encoding='utf-8')

print('[migration] source transformation complete')
