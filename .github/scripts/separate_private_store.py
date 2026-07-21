from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    print(f'[separation] {label}')
    count = source.count(old)
    if count != 1:
        raise AssertionError(
            f'{label}: expected one match, found {count}'
        )
    return source.replace(old, new, 1)


def replace_between(
    source: str,
    start: str,
    end: str,
    replacement: str,
    label: str,
) -> str:
    print(f'[separation] {label}')
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
    "  const [stores, setStores] = useState<Store[]>([]);",
    """  // Public marketplace stores remain separate from the authenticated
  // user's private ERP store document.
  const [stores, setStores] = useState<Store[]>([]);
  const [userStore, setUserStore] = useState<Store | null>(null);""",
    'Add private user store state',
)

app = replace_once(
    app,
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
    """  useEffect(() => {
    if (!authenticatedUserId || !userStore) return;

    localStorage.setItem(
      getUserStoreCacheKey(authenticatedUserId),
      JSON.stringify(userStore)
    );
  }, [userStore, authenticatedUserId]);""",
    'Scope private store cache to private state',
)

app = replace_once(
    app,
    """  const activeStore = useMemo<Store>(() => {
    const existingStore = stores.find(
      store => store.id === activeRetailerId
    );

    if (existingStore) {
      return existingStore;
    }

    return createEmptyUserStore(activeRetailerId, profileEmail);
  }, [stores, activeRetailerId, profileEmail]);""",
    """  const activeStore = useMemo<Store>(() => {
    return userStore ?? createEmptyUserStore(
      activeRetailerId,
      profileEmail
    );
  }, [userStore, activeRetailerId, profileEmail]);""",
    'Derive active store only from private state',
)

app = replace_once(
    app,
    """    setStores(previousStores => [
      nextStore,
      ...previousStores.filter(store => store.id !== user.uid),
    ]);""",
    "    setUserStore(nextStore);",
    'Optimistically update private store state',
)

app = replace_once(
    app,
    """      setStores(previousStores => {
        const otherStores = previousStores.filter(
          store => store.id !== user.uid
        );

        return previousStore.id
          ? [previousStore, ...otherStores]
          : otherStores;
      });""",
    "      setUserStore(previousStore.id ? previousStore : null);",
    'Rollback private store state',
)

app = replace_once(
    app,
    """        setAuthenticatedUserId(user.uid);
        setStores([]);
        setProfileName(user.displayName ?? '');""",
    """        setAuthenticatedUserId(user.uid);
        setUserStore(null);
        setStores([]);
        setProfileName(user.displayName ?? '');""",
    'Reset private store on auth change',
)

app = replace_once(
    app,
    "              setStores([cachedStore]);",
    "              setUserStore(cachedStore);",
    'Load cached private store',
)

app = replace_once(
    app,
    """          setStores(previousStores => [
            userStore,
            ...previousStores.filter(store => store.id !== user.uid),
          ]);""",
    "          setUserStore(userStore);",
    'Load remote private store',
)

app = replace_once(
    app,
    """          if (!cachedStore) {
            setStores([
              createEmptyUserStore(user.uid, user.email ?? ''),
            ]);
          }""",
    """          if (!cachedStore) {
            setUserStore(
              createEmptyUserStore(user.uid, user.email ?? '')
            );
          }""",
    'Fallback private store state',
)

app = replace_once(
    app,
    """        setAuthenticatedUserId('');
        setTenants([]);
        setStores([]);""",
    """        setAuthenticatedUserId('');
        setUserStore(null);
        setTenants([]);
        setStores([]);""",
    'Clear private store on logout',
)

app = replace_once(
    app,
    """                activeRetailer={activeRetailer}
                stores={stores}
                products={products}""",
    """                activeRetailer={activeRetailer}
                activeStore={activeStore}
                products={products}""",
    'Pass private active store to retailer panel',
)

app_path.write_text(app, encoding='utf-8')

retailer_path = Path('src/components/RetailerPanel.tsx')
retailer = retailer_path.read_text(encoding='utf-8')

retailer = replace_once(
    retailer,
    "  stores: Store[];",
    "  activeStore: Store;",
    'Retailer active store prop type',
)

retailer = replace_once(
    retailer,
    """  activeRetailer,
  stores,
  products,""",
    """  activeRetailer,
  activeStore,
  products,""",
    'Retailer active store prop destructuring',
)

retailer = replace_between(
    retailer,
    'const activeStore: Store =\n',
    '  const activeRetailerProducts = products.filter',
    '',
    'Remove retailer lookup from public stores',
)

retailer_path.write_text(retailer, encoding='utf-8')

if 'stores.find(store => store.id === activeRetailerId)' in app:
    raise AssertionError('Private active store still reads public stores')
if 'stores={stores}' in app and '<RetailerPanel' in app:
    retailer_render = app[app.index('<RetailerPanel'):app.index('/>', app.index('<RetailerPanel'))]
    if 'stores={stores}' in retailer_render:
        raise AssertionError('RetailerPanel still receives public stores')
if 'stores.find(' in retailer:
    raise AssertionError('RetailerPanel still looks up the private store in stores')

print('[separation] private and public store states are isolated')
