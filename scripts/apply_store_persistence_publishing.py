from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    assert count == 1, f'{label}: expected one match, found {count}'
    return source.replace(old, new, 1)


def replace_between(
    source: str,
    start: str,
    end: str,
    replacement: str,
    label: str,
) -> str:
    start_index = source.find(start)
    assert start_index >= 0, f'{label}: start marker not found'
    end_index = source.find(end, start_index)
    assert end_index >= 0, f'{label}: end marker not found'
    return source[:start_index] + replacement + source[end_index:]


app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

app = replace_once(
    app,
    "import { Tenant, Store, Product, Order, CartItem, Note, Friend, SocialPost, DeliveryJob, FreelanceJob, type UserStoreDocument } from './types';",
    "import { Tenant, Store, Product, Order, CartItem, Note, Friend, SocialPost, DeliveryJob, FreelanceJob, type UserStoreDocument, type MarketplaceListingDocument } from './types';",
    'App marketplace type import',
)

app = replace_once(
    app,
    """import {
  buildUserStoreCreateData,
  buildUserStoreUpdateData,
  type BuildUserStoreCreateInput,
  type BuildUserStoreUpdateInput,
} from './utils/userStoreDocument';""",
    """import {
  buildUserStoreCreateData,
  buildUserStoreUpdateData,
  type BuildUserStoreCreateInput,
  type BuildUserStoreUpdateInput,
} from './utils/userStoreDocument';
import {
  buildMarketplaceStoreCreateData,
  buildMarketplaceStoreUpdateData,
} from './utils/marketplaceDocuments';
import {
  getMarketplaceListingsCollectionPath,
  getMarketplaceStoreListingDocumentPath,
} from './utils/marketplacePaths';
import {
  loadUserStoreCache,
  saveUserStoreCache,
} from './utils/userStoreCache';""",
    'App marketplace and cache imports',
)

app = replace_once(
    app,
    "  onSnapshot,\n  runTransaction,",
    "  onSnapshot,\n  query,\n  runTransaction,",
    'App query import',
)

app = replace_once(
    app,
    "  updateDoc,\n} from 'firebase/firestore';",
    "  updateDoc,\n  where,\n} from 'firebase/firestore';",
    'App where import',
)

app = replace_once(
    app,
    """const getUserStoreCacheKey = (uid: string): string =>
  `kyrub_user_store_${uid}`;

""",
    """const slugifyStoreName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const mapMarketplaceStoreListingToStore = (
  listing: Extract<MarketplaceListingDocument, { listingType: 'store' }>
): Store => ({
  id: listing.storeId,
  name: listing.name,
  slug: listing.slug,
  description: listing.description,
  logo: listing.logo,
  banner: listing.banner,
  primaryColor: listing.primaryColor,
  plan: 'free',
  ownerEmail: '',
  address: listing.address,
  contact: '',
  keywords: [...listing.keywords],
  offerImages: [],
  status: listing.status,
  lat: listing.geoPosition?.latitude,
  lng: listing.geoPosition?.longitude,
});

""",
    'App cache key replacement',
)

app = replace_once(
    app,
    "  const [userStore, setUserStore] = useState<Store | null>(null);",
    """  const [userStore, setUserStore] = useState<Store | null>(null);
  const [userStorePendingSync, setUserStorePendingSync] = useState(false);""",
    'App pending store state',
)

app = replace_once(
    app,
    "  const [isStorePublished, setIsStorePublished] = useState(true);",
    """  const [isStorePublished, setIsStorePublished] = useState(false);
  const [isSavingStore, setIsSavingStore] = useState(false);
  const [isPublishingStore, setIsPublishingStore] = useState(false);""",
    'App publication states',
)

app = replace_once(
    app,
    """  useEffect(() => {
    if (!authenticatedUserId || !userStore) return;

    localStorage.setItem(
      getUserStoreCacheKey(authenticatedUserId),
      JSON.stringify(userStore)
    );
  }, [userStore, authenticatedUserId]);""",
    """  useEffect(() => {
    if (!authenticatedUserId || !userStore) return;

    saveUserStoreCache(
      localStorage,
      authenticatedUserId,
      userStore,
      userStorePendingSync
    );
  }, [userStore, authenticatedUserId, userStorePendingSync]);""",
    'App versioned store cache effect',
)

persist_helper = """  const persistUserStoreDocument = async (
    store: Store,
    uid: string,
    ownerEmail: string
  ): Promise<void> => {
    const storeReference = doc(
      db,
      getPrimaryUserStoreDocumentPath(uid)
    );
    const storeSnapshot = await getDoc(storeReference);
    const updateInput: BuildUserStoreUpdateInput = {
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
      updateInput.lat = store.lat;
      updateInput.lng = store.lng;
    }

    if (storeSnapshot.exists()) {
      await updateDoc(
        storeReference,
        buildUserStoreUpdateData(updateInput)
      );
      return;
    }

    await setDoc(
      storeReference,
      buildUserStoreCreateData(
        getUserStoreCreateInput(store, uid, ownerEmail)
      )
    );
  };

"""

app = replace_once(
    app,
    "  const handleUpdateStoreProfile = async (\n",
    persist_helper + "  const handleUpdateStoreProfile = async (\n",
    'App store persistence helper',
)

new_update_handler = """  const handleUpdateStoreProfile = async (
    updatedFields: BuildUserStoreUpdateInput
  ): Promise<{ store: Store; synced: boolean }> => {
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

    setUserStore(nextStore);
    setUserStorePendingSync(true);
    saveUserStoreCache(localStorage, user.uid, nextStore, true);

    try {
      await persistUserStoreDocument(nextStore, user.uid, ownerEmail);
      setUserStorePendingSync(false);
      saveUserStoreCache(localStorage, user.uid, nextStore, false);
      return { store: nextStore, synced: true };
    } catch (error) {
      console.warn('Store saved locally; cloud sync is pending', error);
      triggerToast(
        'Loja salva neste dispositivo. A sincronização com a nuvem ficou pendente.',
        'warning'
      );
      return { store: nextStore, synced: false };
    }
  };

"""

app = replace_between(
    app,
    "  const handleUpdateStoreProfile = async (\n",
    "  useEffect(() => {\n    if (isConfigModalOpen && activeStore) {",
    new_update_handler,
    'App resilient store update handler',
)

new_save_publish_block = """  const getConfiguredStoreUpdates = (): BuildUserStoreUpdateInput => {
    const name = configStoreName.trim();

    return {
      name,
      slug: slugifyStoreName(name),
      description: configStoreBio.trim(),
      address: configStoreAddress.trim(),
      contact: configStoreContact.trim(),
      keywords: configStoreKeywords
        .split(',')
        .map(keyword => keyword.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 30),
    };
  };

  const handleSaveStoreProfile = async () => {
    setIsSavingStore(true);

    try {
      const result = await handleUpdateStoreProfile(
        getConfiguredStoreUpdates()
      );

      if (result.synced) {
        triggerToast('Perfil da loja salvo com sucesso!', 'success');
      }

      setIsConfigModalOpen(false);
    } catch {
      // Authentication and validation failures are already reported.
    } finally {
      setIsSavingStore(false);
    }
  };

  const handleToggleStorePublication = async () => {
    const user = auth.currentUser;

    if (!user) {
      triggerToast('Faça login novamente para publicar sua loja.', 'error');
      return;
    }

    const updates = getConfiguredStoreUpdates();

    if (!isStorePublished && !updates.name) {
      triggerToast(
        'Informe o nome da loja antes de publicar.',
        'error'
      );
      return;
    }

    setIsPublishingStore(true);

    try {
      const saveResult = await handleUpdateStoreProfile(updates);

      if (!saveResult.synced) {
        triggerToast(
          'A loja precisa sincronizar com a nuvem antes da publicação.',
          'warning'
        );
        return;
      }

      const publicationStatus = isStorePublished ? 'paused' : 'published';
      const store = saveResult.store;
      const listingReference = doc(
        db,
        getMarketplaceStoreListingDocumentPath(user.uid)
      );
      const listingInput = {
        store: {
          id: user.uid,
          ownerId: user.uid,
          name: store.name,
          slug: store.slug,
          description: store.description,
          address: store.address ?? '',
          logo: store.logo,
          banner: store.banner,
          primaryColor: store.primaryColor,
          keywords: [...(store.keywords ?? [])],
          status: store.status ?? 'closed',
          lat: store.lat,
          lng: store.lng,
        },
        publicationStatus,
      } as const;
      const listingSnapshot = await getDoc(listingReference);

      if (listingSnapshot.exists()) {
        await updateDoc(
          listingReference,
          buildMarketplaceStoreUpdateData(listingInput)
        );
      } else {
        await setDoc(
          listingReference,
          buildMarketplaceStoreCreateData(listingInput)
        );
      }

      const published = publicationStatus === 'published';
      setIsStorePublished(published);

      if (!published) {
        setStores(previousStores =>
          previousStores.filter(publicStore => publicStore.id !== user.uid)
        );
      }

      triggerToast(
        published
          ? 'Loja publicada no marketplace!'
          : 'Loja ocultada do marketplace.',
        'success'
      );
      setIsConfigModalOpen(false);
    } catch (error) {
      console.error('Falha ao alterar publicação da loja:', error);
      triggerToast(
        'Não foi possível alterar a publicação da loja.',
        'error'
      );
    } finally {
      setIsPublishingStore(false);
    }
  };

"""

app = replace_between(
    app,
    "  const handleSaveStoreProfile = async () => {\n",
    "  // Active products in user's retail store (for freemium checks & dash)",
    new_save_publish_block,
    'App save and publish handlers',
)

new_cache_load = """        const cachedStoreEntry = loadUserStoreCache(
          localStorage,
          user.uid,
          user.email ?? ''
        );
        const cachedStore = cachedStoreEntry?.store ?? null;
        const cachedStoreNeedsSync = cachedStoreEntry?.pendingSync ?? false;

        if (cachedStore) {
          setUserStore(cachedStore);
        }
        setUserStorePendingSync(cachedStoreNeedsSync);

"""

app = replace_between(
    app,
    "        let cachedStore: Store | null = null;\n",
    "        try {\n          const userRef = doc(db, 'users', user.uid);",
    new_cache_load,
    'App cache loading',
)

new_initial_store_sync = """        try {
          const ownerEmail = user.email ?? '';
          const storeReference = doc(
            db,
            getPrimaryUserStoreDocumentPath(user.uid)
          );
          const storeSnapshot = await getDoc(storeReference);
          let resolvedStore = cachedStore ??
            createEmptyUserStore(user.uid, ownerEmail);

          if (cachedStore && cachedStoreNeedsSync) {
            await persistUserStoreDocument(
              cachedStore,
              user.uid,
              ownerEmail
            );
          } else if (storeSnapshot.exists()) {
            resolvedStore = mapUserStoreDocumentToStore(
              storeSnapshot.data() as UserStoreDocument
            );
          } else {
            await persistUserStoreDocument(
              resolvedStore,
              user.uid,
              ownerEmail
            );
          }

          setUserStore(resolvedStore);
          setUserStorePendingSync(false);
          saveUserStoreCache(
            localStorage,
            user.uid,
            resolvedStore,
            false
          );
        } catch (error) {
          console.warn(
            'Falha ao sincronizar a loja principal do usuário:',
            error
          );

          const localStore = cachedStore ??
            createEmptyUserStore(user.uid, user.email ?? '');
          setUserStore(localStore);
          setUserStorePendingSync(true);
          saveUserStoreCache(
            localStorage,
            user.uid,
            localStore,
            true
          );
        }

"""

app = replace_between(
    app,
    "        try {\n          const ownerEmail = user.email ?? '';\n          const storeReference = doc(\n            db,\n            getPrimaryUserStoreDocumentPath(user.uid)\n          );",
    "        try {\n          triggerToast('Conectando e sincronizando dados com Firestore...', 'info');",
    new_initial_store_sync,
    'App initial store reconciliation',
)

app = replace_once(
    app,
    """        setAuthenticatedUserId('');
        setUserStore(null);
        setTenants([]);""",
    """        setAuthenticatedUserId('');
        setUserStore(null);
        setUserStorePendingSync(false);
        setIsStorePublished(false);
        setTenants([]);""",
    'App logout store state',
)

marketplace_effect = """  useEffect(() => {
    if (!authenticatedUserId) {
      setIsStorePublished(false);
      return;
    }

    const listingReference = doc(
      db,
      getMarketplaceStoreListingDocumentPath(authenticatedUserId)
    );

    return onSnapshot(
      listingReference,
      snapshot => {
        const data = snapshot.data() as MarketplaceListingDocument | undefined;
        setIsStorePublished(
          data?.listingType === 'store' &&
          data.publicationStatus === 'published'
        );
      },
      error => {
        console.warn('Falha ao observar publicação da loja:', error);
        setIsStorePublished(false);
      }
    );
  }, [authenticatedUserId]);

"""

app = replace_once(
    app,
    "  // Real-time Firestore Snapshot subscriptions\n",
    marketplace_effect + "  // Real-time Firestore Snapshot subscriptions\n",
    'App owner publication listener',
)

app = replace_once(
    app,
    """  useEffect(() => {
    if (!isLoggedIn) return;

    // Listen to posts ('social_feed' and 'posts' aliases for real-time multiplayer)""",
    """  useEffect(() => {
    if (!isLoggedIn) return;

    const publishedMarketplaceQuery = query(
      collection(db, getMarketplaceListingsCollectionPath()),
      where('publicationStatus', '==', 'published')
    );
    const unsubMarketplaceListings = onSnapshot(
      publishedMarketplaceQuery,
      snapshot => {
        const publicStores = snapshot.docs.flatMap(snapshotDocument => {
          const listing = snapshotDocument.data() as MarketplaceListingDocument;
          return listing.listingType === 'store'
            ? [mapMarketplaceStoreListingToStore(listing)]
            : [];
        });
        setStores(publicStores);
      },
      error => {
        console.warn('Falha ao carregar lojas publicadas:', error);
        setStores([]);
      }
    );

    // Listen to posts ('social_feed' and 'posts' aliases for real-time multiplayer)""",
    'App public marketplace listener',
)

app = replace_once(
    app,
    """    return () => {
      unsubSocialFeed();""",
    """    return () => {
      unsubMarketplaceListings();
      unsubSocialFeed();""",
    'App marketplace listener cleanup',
)

app = replace_once(
    app,
    "                onUpdateStore={handleUpdateStoreProfile}",
    """                onUpdateStore={async updates => {
                  const result = await handleUpdateStoreProfile(updates);
                  if (!result.synced) {
                    throw new Error('Store cloud sync is pending.');
                  }
                }}""",
    'App retailer persistence wrapper',
)

app = replace_once(
    app,
    """        handleRemoveProducaoSpace={handleRemoveProducaoSpace}
        handleSaveStoreProfile={handleSaveStoreProfile}
      />""",
    """        handleRemoveProducaoSpace={handleRemoveProducaoSpace}
        handleSaveStoreProfile={handleSaveStoreProfile}
        handleToggleStorePublication={handleToggleStorePublication}
        isStorePublished={isStorePublished}
        isSavingStore={isSavingStore}
        isPublishingStore={isPublishingStore}
        isStoreSyncPending={userStorePendingSync}
      />""",
    'App store modal publication props',
)

app_path.write_text(app, encoding='utf-8')

modal_path = Path('src/components/modals/StoreConfigModal.tsx')
modal = modal_path.read_text(encoding='utf-8')

modal = replace_once(
    modal,
    "  handleSaveStoreProfile: () => void;\n}",
    """  handleSaveStoreProfile: () => Promise<void>;
  handleToggleStorePublication: () => Promise<void>;
  isStorePublished: boolean;
  isSavingStore: boolean;
  isPublishingStore: boolean;
  isStoreSyncPending: boolean;
}""",
    'Store modal publication props',
)

modal = replace_once(
    modal,
    """  handleRemoveProducaoSpace,
  handleSaveStoreProfile
}) => {""",
    """  handleRemoveProducaoSpace,
  handleSaveStoreProfile,
  handleToggleStorePublication,
  isStorePublished,
  isSavingStore,
  isPublishingStore,
  isStoreSyncPending
}) => {""",
    'Store modal publication destructuring',
)

new_footer = """        {/* Footer */}
        <div className="bg-slate-950 px-6 py-4 border-t border-slate-850 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {isStoreSyncPending && (
              <span className="text-[9px] font-mono text-amber-400 uppercase">
                Salva neste dispositivo • sincronização pendente
              </span>
            )}
          </div>
          <div className="flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-900 hover:bg-slate-850 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs uppercase cursor-pointer"
            >
              Fechar
            </button>
            {configActiveTab === 'perfil' && (
              <>
                <button
                  type="button"
                  onClick={() => void handleSaveStoreProfile()}
                  disabled={isSavingStore || isPublishingStore}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                >
                  {isSavingStore ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleStorePublication()}
                  disabled={isSavingStore || isPublishingStore}
                  className={`font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isStorePublished
                      ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30'
                      : 'bg-teal-500 hover:bg-teal-600 text-slate-950'
                  }`}
                >
                  {isPublishingStore
                    ? 'Processando...'
                    : isStorePublished
                      ? 'Ocultar'
                      : 'Publicar'}
                </button>
              </>
            )}
          </div>
        </div>
"""

modal = replace_between(
    modal,
    "        {/* Footer */}\n",
    "      </div>\n    </div>\n  );",
    new_footer,
    'Store modal footer',
)

modal_path.write_text(modal, encoding='utf-8')

rules_path = Path('firestore.rules')
rules = rules_path.read_text(encoding='utf-8')

marketplace_rules = r'''    // --- Published Marketplace Listings ---
    match /marketplace_listings/{listingId} {
      function isMarketplaceListingOwner(data) {
        return isSignedIn() && data.ownerId == request.auth.uid;
      }

      function hasValidMarketplaceStoreKeys(data) {
        return data.keys().hasAll([
          'listingId',
          'listingType',
          'ownerId',
          'storeId',
          'name',
          'slug',
          'description',
          'address',
          'logo',
          'banner',
          'primaryColor',
          'keywords',
          'status',
          'publicationStatus',
          'createdAt',
          'updatedAt'
        ]) && data.keys().hasOnly([
          'listingId',
          'listingType',
          'ownerId',
          'storeId',
          'name',
          'slug',
          'description',
          'address',
          'logo',
          'banner',
          'primaryColor',
          'keywords',
          'status',
          'publicationStatus',
          'createdAt',
          'updatedAt',
          'publishedAt',
          'geoPosition'
        ]);
      }

      function hasValidMarketplaceStoreTypes(data) {
        return data.listingId is string
          && data.listingType == 'store'
          && data.ownerId is string
          && data.storeId is string
          && data.name is string
          && data.name.size() >= 1
          && data.name.size() <= 120
          && data.slug is string
          && data.slug.size() <= 120
          && data.description is string
          && data.description.size() <= 2000
          && data.address is string
          && data.address.size() <= 500
          && data.logo is string
          && data.logo.size() <= 2048
          && data.banner is string
          && data.banner.size() <= 2048
          && data.primaryColor is string
          && data.primaryColor.size() <= 32
          && data.keywords is list
          && data.keywords.size() <= 30
          && data.status is string
          && data.status in ['open', 'delayed', 'closed']
          && data.publicationStatus is string
          && data.publicationStatus in ['draft', 'published', 'paused']
          && data.createdAt is timestamp
          && data.updatedAt is timestamp
          && (!data.keys().hasAny(['publishedAt']) || data.publishedAt is timestamp)
          && (!data.keys().hasAny(['geoPosition']) || data.geoPosition is latlng);
      }

      function hasValidMarketplacePublicationCreate(data) {
        return (
          data.publicationStatus == 'published'
            && data.keys().hasAll(['publishedAt'])
            && data.publishedAt == request.time
        ) || (
          data.publicationStatus in ['draft', 'paused']
            && !data.keys().hasAny(['publishedAt'])
        );
      }

      function hasValidMarketplacePublicationUpdate() {
        return (
          incoming().publicationStatus == 'published'
            && incoming().keys().hasAll(['publishedAt'])
            && incoming().publishedAt == request.time
        ) || (
          incoming().publicationStatus in ['draft', 'paused']
            && (
              (
                !existing().keys().hasAny(['publishedAt'])
                  && !incoming().keys().hasAny(['publishedAt'])
              ) || (
                existing().keys().hasAll(['publishedAt'])
                  && incoming().keys().hasAll(['publishedAt'])
                  && incoming().publishedAt == existing().publishedAt
              )
            )
        );
      }

      allow get: if isSignedIn()
        && (
          existing().publicationStatus == 'published'
            || isMarketplaceListingOwner(existing())
        );

      allow list: if isSignedIn()
        && existing().publicationStatus == 'published';

      allow create: if isSignedIn()
        && isValidId(listingId)
        && listingId.matches('^s_[0-9]+_[a-zA-Z0-9_-]+$')
        && hasValidMarketplaceStoreKeys(incoming())
        && hasValidMarketplaceStoreTypes(incoming())
        && isMarketplaceListingOwner(incoming())
        && incoming().listingId == listingId
        && incoming().ownerId == incoming().storeId
        && incoming().storeId == request.auth.uid
        && incoming().createdAt == request.time
        && incoming().updatedAt == request.time
        && hasValidMarketplacePublicationCreate(incoming());

      allow update: if isSignedIn()
        && isMarketplaceListingOwner(existing())
        && hasValidMarketplaceStoreKeys(incoming())
        && hasValidMarketplaceStoreTypes(incoming())
        && incoming().listingId == existing().listingId
        && incoming().listingType == existing().listingType
        && incoming().ownerId == existing().ownerId
        && incoming().storeId == existing().storeId
        && incoming().createdAt == existing().createdAt
        && incoming().updatedAt == request.time
        && hasValidMarketplacePublicationUpdate()
        && incoming().diff(existing()).affectedKeys().hasOnly([
          'name',
          'slug',
          'description',
          'address',
          'logo',
          'banner',
          'primaryColor',
          'keywords',
          'status',
          'publicationStatus',
          'publishedAt',
          'geoPosition',
          'updatedAt'
        ]);

      allow delete: if false;
    }

'''

rules = replace_once(
    rules,
    "    // --- Reviews ---\n",
    marketplace_rules + "    // --- Reviews ---\n",
    'Marketplace rules insertion',
)

rules_path.write_text(rules, encoding='utf-8')

print('Applied resilient store persistence and marketplace publication integration.')
