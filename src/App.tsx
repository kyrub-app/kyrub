import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  Package,
  Store as StoreIcon,
  Compass,
  Layers,
  ShoppingCart,
  ShoppingBag,
  Tag,
  Plus,
  Sparkles,
  Zap,
  Wallet,
  User,
  Briefcase,
  MapPin,
  Search,
  Share2,
  Sliders,
  CheckSquare,
  Users,
  ChevronRight,
  Trash2,
  Edit,
  Play,
  Pause,
  TrendingUp,
  LogOut,
  Clock,
  Activity,
  CheckCircle2,
  MessageSquare,
  ThumbsUp,
  UserPlus,
  UserMinus,
  Check,
  X,
  Eye,
  EyeOff,
  Camera,
  Paperclip,
  Bell,
  Volume2,
  Heart,
  DollarSign,
  ClipboardList,
  Calendar,
  Fingerprint,
  LayoutGrid
} from 'lucide-react';
import { Tenant, Store, Product, Order, CartItem, Note, Friend, SocialPost, DeliveryJob, FreelanceJob } from './types';

// Import our modular sub-panels
import { AdminPanel } from './components/AdminPanel';
import { SupplierPanel } from './components/SupplierPanel';
import { RetailerPanel } from './components/RetailerPanel';
import { StorefrontPanel } from './components/StorefrontPanel';
import { SandboxPanel } from './components/SandboxPanel';
import { MediaCarousel } from './components/MediaCarousel';
import { StoreOfferCarousel } from './components/StoreOfferCarousel';
import { FreelaManagerModal } from './components/modals/FreelaManagerModal';
import { DeliveryManagerModal } from './components/modals/DeliveryManagerModal';
import { UserProfileModal } from './components/modals/UserProfileModal';
import { WalletModal } from './components/modals/WalletModal';
import { ChatModal } from './components/modals/ChatModal';
import { StoreConfigModal } from './components/modals/StoreConfigModal';
import { NewProductModal } from './components/modals/NewProductModal';
import { SharedNotesModal } from './components/modals/SharedNotesModal';
import { UserSearchModal } from './components/modals/UserSearchModal';
import { MomentsModal } from './components/modals/MomentsModal';
import { ActiveAlarmModal } from './components/modals/ActiveAlarmModal';
import { B2CCartDrawer } from './components/modals/B2CCartDrawer';
import { GpsOverlayModal } from './components/modals/GpsOverlayModal';
import { useWallet } from './hooks/useWallet';
import { useProductivityNotes } from './hooks/useProductivityNotes';
import { useSocialDirectoryV2 } from './hooks/useSocialDirectoryV2';
import { LandingView } from './components/LandingView';
import { StaffViewport } from './components/StaffViewport';
import { PerfilTab } from './components/tabs/PerfilTab';
import { RendaTab } from './components/tabs/RendaTab';
import { KyrubTab } from './components/tabs/KyrubTab';
import { MobileErpMenu } from './components/MobileErpMenu';

// Import helper functions
import { getDistance, formatWhatsApp, formatCpf, formatCnpj } from './utils/helpers';

// Firebase & Sync engine integration imports
import { db, auth } from './utils/firebase';
import { saveDocLWW, listenCollection, syncOfflineBatch, resolveConflictLWW } from './utils/syncEngine';
import { classifyFirestoreFailure } from './utils/firestoreFailure';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

// Import fallback/seed initial mocks
import {
  appUsers,
  friends as initialFriends,
  posts as initialPosts,
  deliveries as initialDeliveries,
  freelanceJobs as initialFreelanceJobs,
  momentos as initialMomentos,
  connectionRequests as initialConnectionRequests,
  initialNotes,
  initialTenants,
  initialProducts,
  initialOrders
} from './constants/initialMocks';

// Persistent LocalStorage storage keys
const STORAGE_KEYS = {
  TENANTS: 'kyrub_tenants',
  STORES: 'kyrub_stores',
  PRODUCTS: 'kyrub_products',
  ORDERS: 'kyrub_orders',
  NOTES: 'kyrub_notes',
  FRIENDS: 'kyrub_friends',
  POSTS: 'kyrub_posts',
  DELIVERIES: 'kyrub_deliveries',
  FREELANCE_JOBS: 'kyrub_freelance_jobs',
  MOMENTOS: 'kyrub_momentos',
  WALLET_BALANCE: 'kyrub_wallet_balance',
  WALLET_HISTORY: 'kyrub_wallet_history',
  FAVORITE_STORES: 'kyrub_favorite_stores'
};

const logBackgroundSyncFailure = (
  module: string,
  error: unknown
): void => {
  const navigatorOnline =
    typeof navigator === 'undefined'
      ? true
      : navigator.onLine;
  const failure = classifyFirestoreFailure(error, navigatorOnline);

  console.warn('Background Firestore sync failed', {
    module,
    kind: failure.kind,
    code: failure.code
  });
};

export default function App() {
  const isAdminSubdomain = typeof window !== 'undefined' && (
    window.location.hostname === 'admin.kyrub.com' ||
    window.location.hostname.includes('admin') ||
    window.location.hash.includes('admin')
  );

  // Global States with Lazy Initialization (Persistent Offline-First Cache Layer)
  const [tenants, setTenants] = useState<Tenant[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TENANTS);
    return saved ? JSON.parse(saved) : initialTenants;
  });

  const [stores, setStores] = useState<Store[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STORES);
    return saved ? JSON.parse(saved) : [];
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    return saved ? JSON.parse(saved) : initialProducts;
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ORDERS);
    return saved ? JSON.parse(saved) : initialOrders;
  });

  // Authentication & GPS states
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [gpsGranted, setGpsGranted] = useState(false);
  const [showGpsOverlay, setShowGpsOverlay] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Mobile Bottom Navigation
  const [activeTab, setActiveTab] = useState<'perfil' | 'renda' | 'kyrub'>('perfil');

  // Slide-overs & ERP Overlays
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isGestaoOpen, setIsGestaoOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'clientes' | 'caixa' | 'pedidos' | 'reservas' | 'ponto' | 'gerencial'>('clientes');
  const [gestaoRole, setGestaoRole] = useState<'admin' | 'supplier' | 'retailer' | 'sandbox'>('retailer');
  const [visitingStore, setVisitingStore] = useState<Store | null>(null);

  // Dynamic store environments / spaces config states
  const [atendimentoSpaces, setAtendimentoSpaces] = useState<string[]>(() => {
    const saved = localStorage.getItem('kyrub_atendimento_spaces');
    return saved ? JSON.parse(saved) : ['GERAL', 'BALCÃO', 'ENTREGA', 'AGENDADOS'];
  });

  const [producaoSpaces, setProducaoSpaces] = useState<string[]>(() => {
    const saved = localStorage.getItem('kyrub_producao_spaces');
    return saved ? JSON.parse(saved) : ['TODOS', 'BAR 1', 'COZINHA', 'CHAPA', 'FORNO'];
  });

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configStoreName, setConfigStoreName] = useState('');
  const [configStoreBio, setConfigStoreBio] = useState('');
  const [configStoreAddress, setConfigStoreAddress] = useState('');
  const [configStoreContact, setConfigStoreContact] = useState('');
  const [configStoreKeywords, setConfigStoreKeywords] = useState('');
  const [configActiveTab, setConfigActiveTab] = useState<'perfil' | 'ambiente'>('perfil');

  const [newAtendimentoSpace, setNewAtendimentoSpace] = useState('');
  const [newProducaoSpace, setNewProducaoSpace] = useState('');

  useEffect(() => {
    localStorage.setItem('kyrub_atendimento_spaces', JSON.stringify(atendimentoSpaces));
  }, [atendimentoSpaces]);

  useEffect(() => {
    localStorage.setItem('kyrub_producao_spaces', JSON.stringify(producaoSpaces));
  }, [producaoSpaces]);

  // Shop states
  const [isStorePublished, setIsStorePublished] = useState(true);

  // Cart & checkout states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning'} | null>(null);

  const triggerToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // GPS default coordinates: São Paulo
  const defaultLat = -23.5505;
  const defaultLng = -46.6333;

  // Add coordinates to stores dynamically, wrapped in useMemo for optimal CPU cycle savings
  const storesWithCoords = useMemo(() => {
    return stores.map((s) => ({
      ...s,
      lat: s.lat ?? (s.id === 's-1' ? -23.5450 : -23.5600),
      lng: s.lng ?? (s.id === 's-1' ? -46.6350 : -46.6500),
      isNew: s.isNew ?? (s.id === 's-1'),
      status: s.status ?? (s.id === 's-1' ? 'open' : 'delayed') as 'open' | 'delayed' | 'closed',
      keywords: s.keywords || (s.id === 's-1'
        ? ['eletrônicos', 'gadgets', 'celulares', 'fones', 'teclados']
        : ['moda', 'vestidos', 'boutique', 'linho', 'acessórios']),
      offerImages: s.offerImages || (s.id === 's-1'
        ? [
            'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&fit=crop&q=80',
            'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&fit=crop&q=80',
            'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&fit=crop&q=80'
          ]
        : [
            'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&fit=crop&q=80',
            'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&fit=crop&q=80',
            'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&fit=crop&q=80'
          ])
    }));
  }, [stores]);

  // Staff Private Route & Operational States
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [isStaffLoggedIn, setIsStaffLoggedIn] = useState(false);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  useEffect(() => {
    const handleUpgrade = (e: any) => {
      const tenantId = e.detail?.id;
      if (tenantId) {
        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, plan: 'business' } : t));
      }
    };
    window.addEventListener('kyrub-upgrade-tenant', handleUpgrade);
    return () => window.removeEventListener('kyrub-upgrade-tenant', handleUpgrade);
  }, []);

  // GUIA 3 State: Social Friends & Posts (Persistent)
  const [posts, setPosts] = useState<SocialPost[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.POSTS);
    return saved ? JSON.parse(saved) : initialPosts;
  });

  const [newPostText, setNewPostText] = useState('');

  // GUIA 2 State: Vacancies & Deliveries (Persistent)
  const [deliveries, setDeliveries] = useState<DeliveryJob[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DELIVERIES);
    return saved ? JSON.parse(saved) : initialDeliveries;
  });

  const [freelanceJobs, setFreelanceJobs] = useState<FreelanceJob[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FREELANCE_JOBS);
    return saved ? JSON.parse(saved) : initialFreelanceJobs;
  });

  // Wallet and BaaS state (Persistent via custom hook)
  const {
    walletBalance,
    setWalletBalance,
    walletHistory,
    setWalletHistory,
    addTransaction
  } = useWallet();

  // Social Sub-tab, GPS Slider Filter and Search states
  const [radiusKm, setRadiusKm] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [socialSubTab, setSocialSubTab] = useState<'lojas' | 'usuarios'>('lojas');

  // New states for restructure
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [ofertasFilter, setOfertasFilter] = useState<'todas' | 'novas' | 'favoritas' | 'cliente'>('todas');
  const [pracaFilter, setPracaFilter] = useState<'recentes' | 'favoritos' | 'conectados'>('recentes');
  const [conectadosSubTab, setConectadosSubTab] = useState<'sugestoes' | 'solicitacoes'>('sugestoes');

  // Private chat state
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatUser, setSelectedChatUser] = useState<any | null>(null);
  const [chatMessageText, setChatMessageText] = useState('');

  // Store Moments (Avaliações/Depoimentos) states (Persistent)
  const [showMomentsModal, setShowMomentsModal] = useState(false);
  const [selectedStoreForMoments, setSelectedStoreForMoments] = useState<any | null>(null);
  const [newMomentContent, setNewMomentContent] = useState('');
  const [newMomentRating, setNewMomentRating] = useState(5);
  const [newMomentPublishToPraca, setNewMomentPublishToPraca] = useState(true);
  const [newMomentPhoto, setNewMomentPhoto] = useState('');
  const [momentos, setMomentos] = useState<any[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MOMENTOS);
    return saved ? JSON.parse(saved) : initialMomentos;
  });

  // Side-effect observers for dynamic LocalStorage persistence syncing
  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.TENANTS, JSON.stringify(tenants));
    const pushTenants = async () => {
      for (const tenant of tenants) {
        await saveDocLWW('tenants', tenant.id, {
          ...tenant,
          updatedAt: (tenant as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushTenants().catch(error => {
      logBackgroundSyncFailure('tenants', error);
    });
  }, [tenants, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.STORES, JSON.stringify(stores));
  }, [stores, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    const pushProducts = async () => {
      for (const product of products) {
        await saveDocLWW('tenants/tenant_default/products', product.id, {
          ...product,
          updatedAt: (product as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushProducts().catch(error => {
      logBackgroundSyncFailure('products', error);
    });
  }, [products, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    const pushOrders = async () => {
      for (const order of orders) {
        await saveDocLWW('tenants/tenant_default/orders', order.id, {
          ...order,
          updatedAt: (order as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushOrders().catch(error => {
      logBackgroundSyncFailure('orders', error);
    });
  }, [orders, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
    const pushPosts = async () => {
      for (const post of posts) {
        const payload = {
          ...post,
          updatedAt: (post as any).updatedAt || new Date().toISOString()
        };
        await saveDocLWW('social_feed', post.id, payload);
        await saveDocLWW('posts', post.id, payload);
      }
    };
    void pushPosts().catch(error => {
      logBackgroundSyncFailure('posts', error);
    });
  }, [posts, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.DELIVERIES, JSON.stringify(deliveries));
    const pushDeliveries = async () => {
      for (const del of deliveries) {
        const payload = {
          ...del,
          updatedAt: (del as any).updatedAt || new Date().toISOString()
        };
        await saveDocLWW('delivery_jobs', del.id, payload);
        await saveDocLWW('deliveries', del.id, payload);
      }
    };
    void pushDeliveries().catch(error => {
      logBackgroundSyncFailure('deliveries', error);
    });
  }, [deliveries, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.FREELANCE_JOBS, JSON.stringify(freelanceJobs));
    const pushFreelance = async () => {
      for (const free of freelanceJobs) {
        await saveDocLWW('freelance_jobs', free.id, {
          ...free,
          updatedAt: (free as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushFreelance().catch(error => {
      logBackgroundSyncFailure('freelance-jobs', error);
    });
  }, [freelanceJobs, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.MOMENTOS, JSON.stringify(momentos));
    const pushMomentos = async () => {
      for (const mom of momentos) {
        await saveDocLWW('momentos', mom.id, {
          ...mom,
          updatedAt: (mom as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushMomentos().catch(error => {
      logBackgroundSyncFailure('momentos', error);
    });
  }, [momentos, isLoggedIn]);

  // Product addition state
  const [newProductModal, setNewProductModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdWholesale, setNewProdWholesale] = useState('');
  const [newProdStock, setNewProdStock] = useState('100');
  const [newProdCategory, setNewProdCategory] = useState('Eletrônicos');
  const [newProdDesc, setNewProdDesc] = useState('');
  const [newProdIsService, setNewProdIsService] = useState(false);

  // Wallet privacy state (hidden by default)
  const [showBalance, setShowBalance] = useState(false);

  // New Delivery Modal states
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  // New Freela Modal states
  const [showFreelaModal, setShowFreelaModal] = useState(false);

  // Notes Edit & Share state
  const [showSharedNotesModal, setShowSharedNotesModal] = useState(false);
  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [showFazerEntregasModal, setShowFazerEntregasModal] = useState(false);
  const [showFazerFreelasModal, setShowFazerFreelasModal] = useState(false);

  useEffect(() => {
    if (isAdminSubdomain) {
      setIsLoggedIn(true);
      setIsGestaoOpen(true);
      setGestaoRole('admin');
    }
  }, [isAdminSubdomain]);

  // User Profile state
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [accountTypeCliente, setAccountTypeCliente] = useState(false);
  const [accountTypeEntregador, setAccountTypeEntregador] = useState(false);
  const [accountTypeLojista, setAccountTypeLojista] = useState(false);
  const [profileAddress, setProfileAddress] = useState('');
  const [profileWhatsApp, setProfileWhatsApp] = useState('');
  const [biometricsActive, setBiometricsActive] = useState(false);
  const [transactionPin, setTransactionPin] = useState('');
  const [kycDocType, setKycDocType] = useState<'bike' | 'motorized' | 'lojista'>('bike');
  const [kycCpf, setKycCpf] = useState('');
  const [kycCnh, setKycCnh] = useState('');
  const [kycCnpj, setKycCnpj] = useState('');
  const [kycStatus, setKycStatus] = useState<'Pendente' | 'Em Análise' | 'Verificado'>('Pendente');
  const [facialValidated, setFacialValidated] = useState(false);
  const [isFacialScanning, setIsFacialScanning] = useState(false);

  // Hook for work tasks/notes logic and state
  const {
    notes,
    setNotes,
    newNoteTitle,
    setNewNoteTitle,
    newNoteContent,
    setNewNoteContent,
    newNoteChecklist,
    setNewNoteChecklist,
    selectedFriendsForNote,
    setSelectedFriendsForNote,
    showAddNoteForm,
    setShowAddNoteForm,
    editingNoteId,
    setEditingNoteId,
    newNoteMediaUrls,
    setNewNoteMediaUrls,
    newNoteReminderDateTime,
    setNewNoteReminderDateTime,
    newNoteIsPublishedToFeed,
    setNewNoteIsPublishedToFeed,
    isUploading,
    uploadProgress,
    activeAlarmNote,
    setActiveAlarmNote,
    dismissedAlarms,
    setDismissedAlarms,
    handleSimulatedUpload,
    handleCreateNote,
    handleEditClick,
    handleDeleteNote,
    handleToggleChecklistItem,
    handleShareNoteWithFriend,
    handleShareNoteExternally
  } = useProductivityNotes({
    profileName,
    profilePhotoUrl,
    posts,
    setPosts,
    triggerToast,
    isLoggedIn
  });

  // Hook for social directory logic and state
  const {
    friends,
    setFriends,
    dbUsers,
    setDbUsers,
    connectionRequests,
    setConnectionRequests,
    favoriteStoreIds,
    setFavoriteStoreIds,
    handleToggleFriend,
    getSuggestions,
    handleToggleFavoriteFriend,
    handleToggleFavoriteStore,
    handleAcceptRequest,
    handleDeclineRequest
  } = useSocialDirectoryV2({
    profileName,
    profilePhotoUrl,
    profileAddress,
    accountTypeLojista,
    accountTypeEntregador,
    isLoggedIn,
    triggerToast
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FAVORITE_STORES, JSON.stringify(favoriteStoreIds));
  }, [favoriteStoreIds]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
    const pushNotes = async () => {
      for (const note of notes) {
        await saveDocLWW('tenants/tenant_default/tasks', note.id, {
          ...note,
          updatedAt: (note as any).updatedAt || new Date().toISOString()
        });
      }
    };
    void pushNotes().catch(error => {
      logBackgroundSyncFailure('notes', error);
    });
  }, [notes, isLoggedIn]);

  // Active Retailer state
  const activeRetailerId = 't-3'; // Default organization
  const activeRetailer = tenants.find(t => t.id === activeRetailerId);

const activeStore = useMemo<Store>(() => {
  const authenticatedEmail =
    auth.currentUser?.email ||
    profileEmail ||
    '';

  const existingStore = stores.find(
    store => store.ownerEmail === authenticatedEmail
  );

  if (existingStore) {
    return existingStore;
  }

  return {
    id: auth.currentUser?.uid || '',
    name: '',
    description: '',
    address: '',
    contact: '',
    keywords: [],
    logo: '',
    banner: '',
    primaryColor: '',
    offerImages: [],
    slug: '',
    plan: 'free',
    ownerEmail: authenticatedEmail,
  };
}, [stores, profileEmail]);

  const handleUpdateStoreProfile = (updatedFields: Partial<Store> & { address?: string; contact?: string }) => {
    setStores(prev => {
      const exists = prev.some(s => s.id === activeRetailerId);
      if (exists) {
        return prev.map(s => s.id === activeRetailerId ? { ...s, ...updatedFields } : s);
      } else {
        return [...prev, { ...activeStore, ...updatedFields } as any];
      }
    });
  };

  useEffect(() => {
    if (isConfigModalOpen && activeStore) {
      setConfigStoreName(activeStore.name || '');
      setConfigStoreBio(activeStore.description || '');
      setConfigStoreAddress((activeStore as any).address || '');
      setConfigStoreContact((activeStore as any).contact || '');
      setConfigStoreKeywords((activeStore.keywords || []).join(', '));
    }
  }, [isConfigModalOpen, activeStore]);

  const handleAddAtendimentoSpace = () => {
    const trimmed = newAtendimentoSpace.trim().toUpperCase();
    if (!trimmed) return;
    if (atendimentoSpaces.includes(trimmed)) {
      triggerToast('Espaço já cadastrado!', 'error');
      return;
    }
    setAtendimentoSpaces([...atendimentoSpaces, trimmed]);
    setNewAtendimentoSpace('');
    triggerToast(`Espaço "${trimmed}" adicionado!`, 'success');
  };

  const handleRemoveAtendimentoSpace = (space: string) => {
    if (atendimentoSpaces.length <= 1) {
      triggerToast('A loja precisa de pelo menos 1 espaço de atendimento!', 'error');
      return;
    }
    setAtendimentoSpaces(atendimentoSpaces.filter(s => s !== space));
    triggerToast(`Espaço "${space}" removido.`, 'info');
  };

  const handleAddProducaoSpace = () => {
    const trimmed = newProducaoSpace.trim().toUpperCase();
    if (!trimmed) return;
    if (producaoSpaces.includes(trimmed)) {
      triggerToast('Espaço de produção já cadastrado!', 'error');
      return;
    }
    setProducaoSpaces([...producaoSpaces, trimmed]);
    setNewProducaoSpace('');
    triggerToast(`Espaço de produção "${trimmed}" adicionado!`, 'success');
  };

  const handleRemoveProducaoSpace = (space: string) => {
    if (producaoSpaces.length <= 1) {
      triggerToast('A loja precisa de pelo menos 1 espaço de produção!', 'error');
      return;
    }
    setProducaoSpaces(producaoSpaces.filter(s => s !== space));
    triggerToast(`Espaço de produção "${space}" removido.`, 'info');
  };

  const handleSaveStoreProfile = () => {
    handleUpdateStoreProfile({
      name: configStoreName,
      description: configStoreBio,
      address: configStoreAddress,
      contact: configStoreContact,
      keywords: configStoreKeywords.split(',').map(k => k.trim()).filter(Boolean)
    });
    triggerToast('Perfil da loja atualizado com sucesso!', 'success');
    setIsConfigModalOpen(false);
  };

  // Active products in user's retail store (for freemium checks & dash)
  const userRetailerProducts = products.filter(p => p.supplierId === activeRetailerId && !p.wholesalePrice);

  // Product Limit Check
  const isLimitReached = userRetailerProducts.length >= 5 && activeRetailer?.plan === 'free';

  // Notification Permissions & Alarm background checker
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(err => console.log('Notification permission request ignored or blocked:', err));
      }
    }
  }, []);

  // Firebase auth state listener and global Initial Sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoggedIn(true);
        setProfileName(user.displayName ?? '');
        setProfileEmail(user.email ?? '');
        setProfilePhotoUrl(user.photoURL ?? '');

        try {
          const userRef = doc(db, 'users', user.uid);
          const userSnapshot = await getDoc(userRef);

          const userPayload = {
            uid: user.uid,
            name: user.displayName ?? '',
            email: user.email ?? '',
            photoUrl: user.photoURL ?? '',
            isProfileVisible: true,
            updatedAt: serverTimestamp(),
            ...(userSnapshot.exists()
              ? {}
              : { createdAt: serverTimestamp() }),
          };

          await setDoc(userRef, userPayload, { merge: true });
        } catch (error) {
          console.error(
            'Falha ao registrar o usuário autenticado no Firestore:',
            error
          );
        }

        try {
          triggerToast('Conectando e sincronizando dados com Firestore...', 'info');

          // Sync tenants
          const tenantsSnap = await getDocs(collection(db, 'tenants'));
          const remoteTenants: any[] = [];
          tenantsSnap.forEach(docSnap => remoteTenants.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteTenants.length === 0) {
            for (const t of initialTenants) {
              await setDoc(doc(db, 'tenants', t.id), { ...t, updatedAt: new Date().toISOString() });
            }
            setTenants(initialTenants);
          } else {
            const syncResult = await syncOfflineBatch(tenants.length > 0 ? (tenants as any) : (initialTenants as any), remoteTenants);
            setTenants(syncResult.syncedRecords as any);
          }

          // Sync posts
          const postsSnap = await getDocs(collection(db, 'social_feed'));
          const remotePosts: any[] = [];
          postsSnap.forEach(docSnap => remotePosts.push({ id: docSnap.id, ...docSnap.data() }));
          if (remotePosts.length === 0) {
            for (const p of initialPosts) {
              await setDoc(doc(db, 'social_feed', p.id), { ...p, updatedAt: new Date().toISOString() });
            }
            setPosts(initialPosts);
          } else {
            const syncResult = await syncOfflineBatch(posts.length > 0 ? (posts as any) : (initialPosts as any), remotePosts);
            setPosts(syncResult.syncedRecords as any);
          }

          // Sync momentos
          const momentosSnap = await getDocs(collection(db, 'momentos'));
          const remoteMomentos: any[] = [];
          momentosSnap.forEach(docSnap => remoteMomentos.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteMomentos.length === 0) {
            for (const m of initialMomentos) {
              await setDoc(doc(db, 'momentos', m.id), { ...m, updatedAt: new Date().toISOString() });
            }
            setMomentos(initialMomentos);
          } else {
            const syncResult = await syncOfflineBatch(momentos.length > 0 ? (momentos as any) : (initialMomentos as any), remoteMomentos);
            setMomentos(syncResult.syncedRecords as any);
          }

          // Sync products
          const productsSnap = await getDocs(collection(db, 'tenants/tenant_default/products'));
          const remoteProducts: any[] = [];
          productsSnap.forEach(docSnap => remoteProducts.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteProducts.length === 0) {
            for (const p of initialProducts) {
              await setDoc(doc(db, 'tenants/tenant_default/products', p.id), { ...p, updatedAt: new Date().toISOString() });
            }
            setProducts(initialProducts);
          } else {
            const syncResult = await syncOfflineBatch(products.length > 0 ? (products as any) : (initialProducts as any), remoteProducts);
            setProducts(syncResult.syncedRecords as any);
          }

          // Sync notes
          const notesSnap = await getDocs(collection(db, 'tenants/tenant_default/tasks'));
          const remoteNotes: any[] = [];
          notesSnap.forEach(docSnap => remoteNotes.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteNotes.length === 0) {
            for (const n of initialNotes) {
              await setDoc(doc(db, 'tenants/tenant_default/tasks', n.id), { ...n, updatedAt: new Date().toISOString() });
            }
            setNotes(initialNotes);
          } else {
            const syncResult = await syncOfflineBatch(notes.length > 0 ? (notes as any) : (initialNotes as any), remoteNotes);
            setNotes(syncResult.syncedRecords as any);
          }

          // Sync orders
          const ordersSnap = await getDocs(collection(db, 'tenants/tenant_default/orders'));
          const remoteOrders: any[] = [];
          ordersSnap.forEach(docSnap => remoteOrders.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteOrders.length === 0) {
            for (const o of initialOrders) {
              await setDoc(doc(db, 'tenants/tenant_default/orders', o.id), { ...o, updatedAt: new Date().toISOString() });
            }
            setOrders(initialOrders);
          } else {
            const syncResult = await syncOfflineBatch(orders.length > 0 ? (orders as any) : (initialOrders as any), remoteOrders);
            setOrders(syncResult.syncedRecords as any);
          }

          // Sync friends
          const friendsSnap = await getDocs(collection(db, `users/${user.uid}/friends`));
          const remoteFriends: any[] = [];
          friendsSnap.forEach(docSnap => remoteFriends.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteFriends.length === 0) {
            for (const f of initialFriends) {
              await setDoc(doc(db, `users/${user.uid}/friends`, f.id), { ...f, updatedAt: new Date().toISOString() });
            }
            setFriends(initialFriends);
          } else {
            const syncResult = await syncOfflineBatch(friends.length > 0 ? (friends as any) : (initialFriends as any), remoteFriends);
            setFriends(syncResult.syncedRecords as any);
          }

          // Sync deliveries
          const deliveriesSnap = await getDocs(collection(db, 'delivery_jobs'));
          const remoteDeliveries: any[] = [];
          deliveriesSnap.forEach(docSnap => remoteDeliveries.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteDeliveries.length === 0) {
            for (const d of initialDeliveries) {
              await setDoc(doc(db, 'delivery_jobs', d.id), { ...d, updatedAt: new Date().toISOString() });
            }
            setDeliveries(initialDeliveries);
          } else {
            const syncResult = await syncOfflineBatch(deliveries.length > 0 ? (deliveries as any) : (initialDeliveries as any), remoteDeliveries);
            setDeliveries(syncResult.syncedRecords as any);
          }

          // Sync freelance jobs
          const freelanceSnap = await getDocs(collection(db, 'freelance_jobs'));
          const remoteFreelance: any[] = [];
          freelanceSnap.forEach(docSnap => remoteFreelance.push({ id: docSnap.id, ...docSnap.data() }));
          if (remoteFreelance.length === 0) {
            for (const f of initialFreelanceJobs) {
              await setDoc(doc(db, 'freelance_jobs', f.id), { ...f, updatedAt: new Date().toISOString() });
            }
            setFreelanceJobs(initialFreelanceJobs);
          } else {
            const syncResult = await syncOfflineBatch(freelanceJobs.length > 0 ? (freelanceJobs as any) : (initialFreelanceJobs as any), remoteFreelance);
            setFreelanceJobs(syncResult.syncedRecords as any);
          }

          triggerToast('Sincronização global de nuvem concluída com sucesso!', 'success');
        } catch (error) {
          const navigatorOnline =
            typeof navigator === 'undefined'
              ? true
              : navigator.onLine;
          const failure = classifyFirestoreFailure(error, navigatorOnline);

          console.warn('Initial Firestore sync failed', {
            kind: failure.kind,
            code: failure.code
          });

          switch (failure.kind) {
            case 'offline':
              triggerToast(
                'Sem conexão com a internet. Usando dados locais.',
                'info'
              );
              break;
            case 'temporarily-unavailable':
              triggerToast(
                'Serviço temporariamente indisponível. Os dados locais continuam disponíveis.',
                'info'
              );
              break;
            case 'permission-denied':
              triggerToast(
                'Alguns módulos não estão autorizados ou configurados para esta conta.',
                'warning'
              );
              break;
            case 'unauthenticated':
              triggerToast(
                'Sua sessão não está autenticada para concluir a sincronização.',
                'error'
              );
              break;
            default:
              triggerToast(
                'Não foi possível concluir toda a sincronização inicial.',
                'warning'
              );
          }
        }
      } else {
        setIsLoggedIn(false);
        setTenants([]);
        setStores([]);
        setProducts([]);
        setOrders([]);
        setNotes([]);
        setFriends([]);
        setPosts([]);
        setDeliveries([]);
        setFreelanceJobs([]);
        setMomentos([]);
        setConnectionRequests([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Real-time Firestore Snapshot subscriptions
  useEffect(() => {
    if (!isLoggedIn) return;

    // Listen to posts ('social_feed' and 'posts' aliases for real-time multiplayer)
    const unsubSocialFeed = listenCollection('social_feed', (docs) => {
      setPosts(prev => {
        const otherPosts = prev.filter(p => (p as any).collectionAlias !== 'social_feed');
        const newDocs = docs.map(d => ({ ...d, collectionAlias: 'social_feed' }));
        return [...otherPosts, ...newDocs];
      });
    });

    const unsubPosts = listenCollection('posts', (docs) => {
      setPosts(prev => {
        const otherPosts = prev.filter(p => (p as any).collectionAlias !== 'posts');
        const newDocs = docs.map(d => ({ ...d, collectionAlias: 'posts' }));
        return [...otherPosts, ...newDocs];
      });
    });

    // Listen to momentos
    const unsubMomentos = listenCollection('momentos', (docs) => {
      setMomentos(docs);
    });

    // Listen to deliveries ('delivery_jobs' and 'deliveries' aliases)
    const unsubDeliveryJobs = listenCollection('delivery_jobs', (docs) => {
      setDeliveries(prev => {
        const otherDeliveries = prev.filter(d => (d as any).collectionAlias !== 'delivery_jobs');
        const newDocs = docs.map(d => ({ ...d, collectionAlias: 'delivery_jobs' }));
        return [...otherDeliveries, ...newDocs];
      });
    });

    const unsubDeliveries = listenCollection('deliveries', (docs) => {
      setDeliveries(prev => {
        const otherDeliveries = prev.filter(d => (d as any).collectionAlias !== 'deliveries');
        const newDocs = docs.map(d => ({ ...d, collectionAlias: 'deliveries' }));
        return [...otherDeliveries, ...newDocs];
      });
    });

    // Listen to freelance jobs
    const unsubFreelance = listenCollection('freelance_jobs', (docs) => {
      setFreelanceJobs(docs);
    });

    // Listen to global users directories
    const unsubUsers = listenCollection('users', (docs) => {
      setDbUsers(docs);
    });

    // Listen to notes/tasks
    const unsubNotes = listenCollection('tenants/tenant_default/tasks', (docs) => {
      setNotes(prev => {
        const remoteIds = new Set(docs.map(d => (d as any).id));
        const mergedMap = new Map(prev.map(n => [n.id, n]));
        let changed = false;

        docs.forEach(remoteDoc => {
          const localDoc = mergedMap.get((remoteDoc as any).id);
          if (!localDoc) {
            mergedMap.set((remoteDoc as any).id, remoteDoc);
            changed = true;
          } else {
            const remoteTime = (remoteDoc as any).updatedAt ? new Date((remoteDoc as any).updatedAt).getTime() : 0;
            const localTime = (localDoc as any).updatedAt ? new Date((localDoc as any).updatedAt).getTime() : 0;
            if (remoteTime > localTime) {
              mergedMap.set((remoteDoc as any).id, remoteDoc);
              changed = true;
            }
          }
        });

        if (docs.length > 0) {
          prev.forEach(localDoc => {
            if (!remoteIds.has(localDoc.id)) {
              mergedMap.delete(localDoc.id);
              changed = true;
            }
          });
        }

        return changed ? Array.from(mergedMap.values()) : prev;
      });
    });

    // Listen to social_tasks
    const unsubSocialTasks = listenCollection('social_tasks', (docs) => {
      setNotes(prev => {
        const remoteIds = new Set(docs.map(d => (d as any).id));
        const mergedMap = new Map(prev.map(n => [n.id, n]));
        let changed = false;

        docs.forEach(remoteDoc => {
          const localDoc = mergedMap.get((remoteDoc as any).id);
          if (!localDoc) {
            mergedMap.set((remoteDoc as any).id, remoteDoc);
            changed = true;
          } else {
            const remoteTime = (remoteDoc as any).updatedAt ? new Date((remoteDoc as any).updatedAt).getTime() : 0;
            const localTime = (localDoc as any).updatedAt ? new Date((localDoc as any).updatedAt).getTime() : 0;
            if (remoteTime > localTime) {
              mergedMap.set((remoteDoc as any).id, remoteDoc);
              changed = true;
            }
          }
        });

        if (docs.length > 0) {
          prev.forEach(localDoc => {
            if (!remoteIds.has(localDoc.id)) {
              mergedMap.delete(localDoc.id);
              changed = true;
            }
          });
        }

        return changed ? Array.from(mergedMap.values()) : prev;
      });
    });

    // Listen to shared_notes
    const unsubSharedNotes = listenCollection('shared_notes', (docs) => {
      setNotes(prev => {
        const remoteIds = new Set(docs.map(d => (d as any).id));
        const mergedMap = new Map(prev.map(n => [n.id, n]));
        let changed = false;

        docs.forEach(remoteDoc => {
          const localDoc = mergedMap.get((remoteDoc as any).id);
          if (!localDoc) {
            mergedMap.set((remoteDoc as any).id, remoteDoc);
            changed = true;
          } else {
            const remoteTime = (remoteDoc as any).updatedAt ? new Date((remoteDoc as any).updatedAt).getTime() : 0;
            const localTime = (localDoc as any).updatedAt ? new Date((localDoc as any).updatedAt).getTime() : 0;
            if (remoteTime > localTime) {
              mergedMap.set((remoteDoc as any).id, remoteDoc);
              changed = true;
            }
          }
        });

        if (docs.length > 0) {
          prev.forEach(localDoc => {
            if (!remoteIds.has(localDoc.id)) {
              mergedMap.delete(localDoc.id);
              changed = true;
            }
          });
        }

        return changed ? Array.from(mergedMap.values()) : prev;
      });
    });


    return () => {
      unsubSocialFeed();
      unsubPosts();
      unsubMomentos();
      unsubDeliveryJobs();
      unsubDeliveries();
      unsubFreelance();
      unsubUsers();
      unsubNotes();
      unsubSocialTasks();
      unsubSharedNotes();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    const checkAlarms = setInterval(() => {
      const now = new Date();
      // YYYY-MM-DDTHH:MM format
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTimeString = `${year}-${month}-${day}T${hours}:${minutes}`;

      notes.forEach(note => {
        if (note.reminderDateTime && note.reminderDateTime === currentTimeString) {
          if (!dismissedAlarms.includes(note.id) && (!activeAlarmNote || activeAlarmNote.id !== note.id)) {
            setActiveAlarmNote(note);

            // Native sound attempt
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              const gainNode = audioCtx.createGain();
              osc.type = 'sine';
              osc.frequency.value = 880; // A5 note
              gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
              osc.connect(gainNode);
              gainNode.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 1.2);
            } catch (e) {
              // audio context blocked or unsupported
            }

            // Standard Web API browser notification
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(`🔔 Alarme Kyrub: ${note.title}`, {
                  body: note.content,
                  icon: '/favicon.ico',
                  tag: note.id,
                });
              } catch (err) {
                console.log('Failing to fire native browser Notification:', err);
              }
            }
            triggerToast(`🔔 ALARME DE TAREFA ATIVO: ${note.title}`, 'success');
          }
        }
      });
    }, 4000);

    return () => clearInterval(checkAlarms);
  }, [notes, dismissedAlarms, activeAlarmNote]);

  // Handle Login Flow
const handleLogin = async (provider: 'google' | 'apple') => {
  if (provider === 'apple') {
    triggerToast(
      'O login com Apple ainda não está disponível.',
      'warning'
    );
    return;
  }

  try {
    const googleProvider = new GoogleAuthProvider();

    googleProvider.setCustomParameters({
      prompt: 'select_account',
    });

    await signInWithPopup(auth, googleProvider);

    setShowLoginModal(false);
    setShowGpsOverlay(true);

    triggerToast(
      'Conectado com sucesso via Google!',
      'success'
    );
  } catch (error) {
    console.error(
      'Erro ao autenticar com Google:',
      error instanceof Error ? error.message : error
    );

    triggerToast(
      'Não foi possível concluir o login com Google.',
      'error'
    );
  }
};
  // Handle GPS Permission Flow
  const handleGpsPermission = (granted: boolean) => {
    setGpsGranted(granted);
    setShowGpsOverlay(false);
    if (granted) {
      setUserCoords({ lat: defaultLat, lng: defaultLng });
      triggerToast('Localização integrada ao Kyrub por proximidade!', 'success');
    } else {
      setUserCoords(null);
      triggerToast('Localização recusada. Usando visualização global padrão.', 'info');
    }
  };

// Add custom status post
  const handlePublishPost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText.trim()) return;
    const newPost: SocialPost = {
      id: `post-${Date.now()}`,
      user: profileName || 'Você',
      avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&q=80',
      time: 'Agora mesmo',
      content: newPostText,
      likes: 0
    };
    setPosts([newPost, ...posts]);
    setNewPostText('');
    triggerToast('Post publicado com sucesso no feed local!', 'success');
  };

  // Toggle friends

  const handlePublishMoment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStoreForMoments || !newMomentContent.trim()) return;

const newMoment = {
      id: `m-new-${Date.now()}`,
      storeId: selectedStoreForMoments.id,
      user: profileName || 'Você',
      avatar: profilePhotoUrl || '',
      content: newMomentContent,
      rating: newMomentRating,
      mediaUrl: newMomentPhoto || undefined,
      createdAt: new Date().toLocaleString('pt-BR'),
      publishedToFeed: newMomentPublishToPraca
    };

    setMomentos(prev => [newMoment, ...prev]);

if (newMomentPublishToPraca) {
      const newPost: SocialPost = {
        id: `post-moment-${newMoment.id}`,
        user: profileName || 'Você',
        avatar: profilePhotoUrl || '',
        time: 'Agora mesmo',
        content: `🏪 [MOMENTO DA LOJA: ${selectedStoreForMoments.name.toUpperCase()}] ⭐ ${'★'.repeat(newMomentRating)}\n\n"${newMomentContent}"`,
        likes: 0,
        mediaUrls: newMomentPhoto ? [newMomentPhoto] : undefined
      };
      setPosts(prev => [newPost, ...prev]);
      triggerToast('Momento publicado na loja e compartilhado na Praça!', 'success');
    } else {
      triggerToast('Momento publicado na loja com sucesso!', 'success');
    }

    setNewMomentContent('');
    setNewMomentRating(5);
    setNewMomentPhoto('');
  };

  // Promotion plan button
  const handlePremiumUpgrade = () => {
    setTenants(prev => prev.map(t => t.id === activeRetailerId ? { ...t, plan: 'business' } : t));
    setStores(prev => prev.map(s => s.id === 's-1' || s.id === 's-2' ? { ...s, plan: 'business' } : s));
    triggerToast('Parabéns! Sua organização foi promovida para Kyrub Premium Business!', 'success');
  };

  // Original product creation handler
  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();

    if (!newProdName || !newProdPrice) {
      triggerToast('Nome e preço são obrigatórios!', 'error');
      return;
    }

    const priceNum = parseFloat(newProdPrice);
    const wholesalePriceNum = newProdWholesale ? parseFloat(newProdWholesale) : undefined;
    const stockNum = parseInt(newProdStock) || 0;

    // Check freemium limit for retailer
    if (isLimitReached) {
      triggerToast('Limite Freemium: Você atingiu o limite de 5 itens. Assine o Plano Premium para cadastrar mais!', 'error');
      setNewProductModal(false);
      return;
    }

    const newProd: Product = {
      id: `p-ret-${Date.now()}`,
      name: newProdName,
      description: newProdDesc || 'Item de excelente qualidade publicado no ecossistema Kyrub.',
      price: priceNum,
      wholesalePrice: wholesalePriceNum,
      image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop&q=80',
      stock: stockNum,
      supplierId: activeRetailerId,
      category: newProdCategory,
      isService: newProdIsService
    };

    setProducts(prev => [newProd, ...prev]);
    setNewProductModal(false);
    triggerToast(`"${newProdName}" cadastrado com sucesso!`, 'success');

    // Reset fields
    setNewProdName('');
    setNewProdPrice('');
    setNewProdWholesale('');
    setNewProdStock('100');
    setNewProdDesc('');
    setNewProdIsService(false);
  };

  // Cart B2C Checkout Simulation
  const checkoutCart = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || !visitingStore) return;

    const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

    const newOrder: Order = {
      id: `ord-b2c-${Date.now().toString().slice(-4)}`,
      storeId: visitingStore.id,
      buyerName,
      buyerEmail,
      items: cart.map(it => ({
        productId: it.product.id,
        name: it.product.name,
        price: it.product.price,
        quantity: it.quantity,
        wholesalePrice: it.product.wholesalePrice
      })),
      total: subtotal,
      status: 'pending',
      createdAt: new Date().toISOString(),
      type: 'retail'
    };

    // Calculate platform split, retailer split, and mock it
    const platformFee = subtotal * 0.1;
    const retailerProfit = subtotal * 0.9;

    setWalletBalance(curr => curr + retailerProfit);
    setWalletHistory([
      { id: `tx-sale-${Date.now()}`, type: 'Venda Recebida', desc: `Venda B2C via ${visitingStore.name}`, val: retailerProfit, date: new Date().toLocaleString('pt-BR') },
      ...walletHistory
    ]);

    setOrders(prev => [newOrder, ...prev]);
    setCart([]);
    setIsCartOpen(false);
    setVisitingStore(null);
    setBuyerName('');
    setBuyerEmail('');
    setBuyerAddress('');
    triggerToast(`Pedido finalizado com sucesso! Gateway Kyrub dividindo splits (10% Plataforma / 90% Loja)...`, 'success');
  };

  const updateCartQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(item => item.product.id !== productId));
      return;
    }
    setCart(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: qty } : item));
  };

  const handleAddToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
    triggerToast(`"${product.name}" adicionado ao carrinho!`, 'success');
  };

  // Filtered stores list by GPS radius & search query
  const filteredStores = storesWithCoords.filter(store => {
    const isMatchingQuery = store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           store.description.toLowerCase().includes(searchQuery.toLowerCase());

    // Simulate published checks if required
    const isPublished = true; // All mock stores are published

    if (userCoords) {
      const distance = getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng);
      return isMatchingQuery && isPublished && distance <= radiusKm;
    }
    return isMatchingQuery && isPublished;
  });

  // Rota externa privada /staff
  if (currentPath === '/staff' || currentPath.endsWith('/staff')) {
    const activeStore = stores.find(s => s.id === 's-1'); // Default to Pixel Store
    const staffProducts = products.filter(p => p.supplierId === 't-3' && !p.wholesalePrice);
    const staffOrders = orders.filter(o => o.storeId === 's-1');

    const handleStaffLogin = (e: React.FormEvent) => {
      e.preventDefault();
      if (staffEmail === 'staff@kyrub.com' && staffPassword === 'kyrub123') {
        setIsStaffLoggedIn(true);
        triggerToast('Colaborador staff autenticado com sucesso!', 'success');
      } else {
        triggerToast('Credenciais de staff incorretas. Use staff@kyrub.com / kyrub123', 'error');
      }
    };

    const handleStaffLogout = () => {
      setIsStaffLoggedIn(false);
      setStaffEmail('');
      setStaffPassword('');
      triggerToast('Sessão staff finalizada.', 'info');
    };

    const handleGoBackToMain = () => {
      window.history.pushState({}, '', '/');
      setCurrentPath('/');
    };

    return (
      <StaffViewport
        isStaffLoggedIn={isStaffLoggedIn}
        staffEmail={staffEmail}
        setStaffEmail={setStaffEmail}
        staffPassword={staffPassword}
        setStaffPassword={setStaffPassword}
        handleStaffLogin={handleStaffLogin}
        handleStaffLogout={handleStaffLogout}
        handleGoBackToMain={handleGoBackToMain}
        activeStore={activeStore}
        staffProducts={staffProducts}
        staffOrders={staffOrders}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans antialiased selection:bg-orange-500/30 selection:text-white" id="root-app-container">

      {/* LANDING PAGE & LOGIN DETECT */}
      {!isLoggedIn ? (
        <LandingView
          showLoginModal={showLoginModal}
          setShowLoginModal={setShowLoginModal}
          handleLogin={handleLogin}
          setCurrentPath={setCurrentPath}
        />
      ) : (
        /* REGISTERED LOGIN SCREEN WORKSPACE */
        <div className="flex-1 flex flex-col min-h-screen">

          {/* 1. TOP MOBILE NAV HEADER */}
          <header className="border-b border-slate-900 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center justify-between" id="app-header">
            <button
              onClick={() => setShowUserProfileModal(true)}
              className="flex items-center gap-2.5 hover:opacity-90 transition-all text-left cursor-pointer focus:outline-none group"
              id="header-user-profile-trigger"
            >
              <div className="relative">
                <img
                  src={profilePhotoUrl || undefined}
                  alt={profileName}
                  className="w-9 h-9 rounded-full object-cover border-2 border-orange-500/80 group-hover:border-orange-400 transition-colors"
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full"></span>
              </div>
              <div>
                <span className="font-mono text-[8px] tracking-wider text-orange-400 font-bold uppercase block">Meu Perfil ⚙️</span>
                <h1 className="text-xs font-black text-white uppercase tracking-tight flex items-center gap-1 group-hover:text-orange-300 transition-colors">
                  <span>{profileName.split(' ')[0]}</span>
                </h1>
              </div>
            </button>

            <div className="flex items-center gap-3">
              {/* Wallet and account balance in Header for ease of use with privacy mask */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-teal-400 font-mono text-[11px]" id="header-wallet-balance">
                <button
                  onClick={() => setIsWalletOpen(true)}
                  className="flex items-center gap-1.5 hover:text-teal-300 transition-all font-mono"
                  title="Abrir Carteira BaaS"
                >
                  <Wallet className="w-3.5 h-3.5 shrink-0" />
                  <span>{showBalance ? `R$ ${walletBalance.toFixed(2)}` : 'R$ •••••'}</span>
                </button>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="text-slate-400 hover:text-slate-200 p-0.5 ml-0.5 transition-all flex items-center justify-center shrink-0"
                  title={showBalance ? "Ocultar Saldo" : "Exibir Saldo"}
                  id="toggle-balance-visibility-btn"
                >
                  {showBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <button
                onClick={async () => {
                  try {
                    await signOut(auth);
                    setIsLoggedIn(false);
                    setGpsGranted(false);
                    triggerToast('Você saiu do ecossistema Kyrub.', 'info');
                  } catch (e) {
                    console.error('Sign out error:', e);
                    setIsLoggedIn(false);
                    setGpsGranted(false);
                  }
                }}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 transition-all"
                title="Sair"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {/* MAIN TAB CONTENT DISPLAY ROUTER */}
          <main className="flex-1 max-w-lg w-full mx-auto px-4 py-6 pb-24 relative space-y-6">

            {/* GUIA 1: NOTAS (Notes & Productivity) */}
            {activeTab === 'perfil' && (
              <PerfilTab
                notes={notes}
                showSharedNotesModal={showSharedNotesModal}
                setShowSharedNotesModal={setShowSharedNotesModal}
                showAddNoteForm={showAddNoteForm}
                setShowAddNoteForm={setShowAddNoteForm}
                editingNoteId={editingNoteId}
                setEditingNoteId={setEditingNoteId}
                newNoteTitle={newNoteTitle}
                setNewNoteTitle={setNewNoteTitle}
                newNoteContent={newNoteContent}
                setNewNoteContent={setNewNoteContent}
                newNoteChecklist={newNoteChecklist}
                setNewNoteChecklist={setNewNoteChecklist}
                selectedFriendsForNote={selectedFriendsForNote}
                setSelectedFriendsForNote={setSelectedFriendsForNote}
                setShowUserSearchModal={setShowUserSearchModal}
                newNoteMediaUrls={newNoteMediaUrls}
                setNewNoteMediaUrls={setNewNoteMediaUrls}
                newNoteReminderDateTime={newNoteReminderDateTime}
                setNewNoteReminderDateTime={setNewNoteReminderDateTime}
                newNoteIsPublishedToFeed={newNoteIsPublishedToFeed}
                setNewNoteIsPublishedToFeed={setNewNoteIsPublishedToFeed}
                isUploading={isUploading}
                uploadProgress={uploadProgress}
                handleSimulatedUpload={handleSimulatedUpload}
                handleCreateNote={handleCreateNote}
                handleEditClick={handleEditClick}
                handleDeleteNote={handleDeleteNote}
                handleToggleChecklistItem={handleToggleChecklistItem}
                handleShareNoteExternally={handleShareNoteExternally}
                triggerToast={triggerToast}
              />
            )}

            {/* GUIA 2: RENDA (Monetization & ERP) */}
            {activeTab === 'renda' && (
              <RendaTab
                deliveries={deliveries}
                freelanceJobs={freelanceJobs}
                setShowDeliveryModal={setShowDeliveryModal}
                setShowFazerEntregasModal={setShowFazerEntregasModal}
                setShowFreelaModal={setShowFreelaModal}
                setShowFazerFreelasModal={setShowFazerFreelasModal}
                setIsGestaoOpen={setIsGestaoOpen}
                setGestaoRole={setGestaoRole}
                triggerToast={triggerToast}
              />
            )}

            {/* GUIA 3: KYRUB (Social Feed, Discovery & Proximity map) */}
            {activeTab === 'kyrub' && (
              <KyrubTab
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                radiusKm={radiusKm}
                setRadiusKm={setRadiusKm}
                socialSubTab={socialSubTab}
                setSocialSubTab={setSocialSubTab}
                ofertasFilter={ofertasFilter}
                setOfertasFilter={setOfertasFilter}
                favoriteStoreIds={favoriteStoreIds}
                handleToggleFavoriteStore={handleToggleFavoriteStore}
                storesWithCoords={storesWithCoords}
                userCoords={userCoords}
                orders={orders}
                setSelectedStoreForMoments={setSelectedStoreForMoments}
                setShowMomentsModal={setShowMomentsModal}
                setVisitingStore={setVisitingStore}
                pracaFilter={pracaFilter}
                setPracaFilter={setPracaFilter}
                newPostText={newPostText}
                setNewPostText={setNewPostText}
                handlePublishPost={handlePublishPost}
                posts={posts}
                setPosts={setPosts}
                friends={friends}
                handleToggleFriend={handleToggleFriend}
                handleToggleFavoriteFriend={handleToggleFavoriteFriend}
                setSelectedChatUser={setSelectedChatUser}
                setShowChatModal={setShowChatModal}
                conectadosSubTab={conectadosSubTab}
                setConectadosSubTab={setConectadosSubTab}
                getSuggestions={getSuggestions}
                connectionRequests={connectionRequests}
                handleAcceptRequest={handleAcceptRequest}
                handleDeclineRequest={handleDeclineRequest}
                triggerToast={triggerToast}
                getDistance={getDistance}
              />
            )}
          </main>

          {/* 3. FIXED BOTTOM NAVIGATION BAR */}
          <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-900 py-3 px-6 flex justify-around items-center backdrop-blur-lg shadow-2xl">
            <button
              onClick={() => setActiveTab('perfil')}
              className={`flex flex-col items-center gap-1 text-[10px] font-bold uppercase transition-all ${
                activeTab === 'perfil' ? 'text-orange-500' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <CheckSquare className="w-5 h-5" />
              <span>Notas</span>
            </button>
            <button
              onClick={() => setActiveTab('renda')}
              className={`flex flex-col items-center gap-1 text-[10px] font-bold uppercase transition-all ${
                activeTab === 'renda' ? 'text-orange-500' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Briefcase className="w-5 h-5" />
              <span>Renda</span>
            </button>
            <button
              onClick={() => setActiveTab('kyrub')}
              className={`flex flex-col items-center gap-1 text-[10px] font-bold uppercase transition-all ${
                activeTab === 'kyrub' ? 'text-orange-500' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Compass className="w-5 h-5" />
              <span>Kyrub</span>
            </button>
          </nav>
        </div>
      )}

      {/* 4. MODAL DETALHADO DO ERP / GESTÃO (PRESERVA TODAS AS TELAS ANTERIORES) */}
      {isGestaoOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col">
          {/* Header Gestão */}
          <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4 font-sans shrink-0" id="erp-main-header">

            <MobileErpMenu
              activeSubTab={activeSubTab}
              isRetailer={gestaoRole === 'retailer'}
              canClosePanel={!isAdminSubdomain}
              onClosePanel={() => setIsGestaoOpen(false)}
              onOpenStoreConfig={() => setIsConfigModalOpen(true)}
              onSelectTab={setActiveSubTab}
            />

            {/* LADO ESQUERDO: Botão de fechar */}
            {!isAdminSubdomain && (
              <button
                onClick={() => setIsGestaoOpen(false)}
                className="hidden sm:flex text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-850 w-8 h-8 rounded-full items-center justify-center text-sm cursor-pointer shadow-sm shrink-0"
              >
                ✕
              </button>
            )}

            {/* CENTRO/DIREITA: Itens de navegação unificados e roláveis horizontalmente */}
            <div className="hidden sm:flex flex-1 min-w-0 items-center gap-2">
              {gestaoRole === 'retailer' ? (
                <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none flex-1 px-2" id="erp-tab-navigation-header">
                  {/* Botão Loja (estilizado como os itens do menu) */}
                  <button
                    onClick={() => setIsConfigModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    title="Configurar Perfil e Ambientes"
                    id="orange-house-config-btn"
                  >
                    <StoreIcon className="w-3.5 h-3.5" />
                    <span>Loja</span>
                  </button>

                  {/* Restantes abas de navegação */}
                  {[
                    { id: 'clientes', label: 'Clientes', icon: Users },
                    { id: 'caixa', label: 'Caixa', icon: DollarSign },
                    { id: 'pedidos', label: 'KDS/Vendas', icon: ClipboardList },
                    { id: 'reservas', label: 'Reservas', icon: Calendar },
                    { id: 'ponto', label: 'Ponto', icon: Fingerprint },
                    { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid }
                  ].map(tab => {
                    const Icon = tab.icon;
                    const isSelected = activeSubTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id as any)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
                          isSelected
                            ? 'bg-orange-500 text-slate-950 shadow-md shadow-orange-500/10'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-2 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center text-slate-950 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-wider text-teal-400">Admin</span>
                </div>
              )}
            </div>

          </div>

          {/* ERP Core Panel Container */}
          <div className="flex-1 overflow-y-auto px-6 py-8 max-w-7xl w-full mx-auto">
            {gestaoRole === 'retailer' && (
              <RetailerPanel
                activeRetailerId={activeRetailerId}
                activeRetailer={activeRetailer}
                stores={stores}
                products={products}
                orders={orders}
                setNewProductModal={setNewProductModal}
                setProducts={setProducts}
                setOrders={setOrders}
                setStores={setStores}
                triggerToast={triggerToast}
                activeSubTab={activeSubTab}
                setActiveSubTab={setActiveSubTab}
                atendimentoSpaces={atendimentoSpaces}
                producaoSpaces={producaoSpaces}
              />
            )}

            {gestaoRole === 'admin' && (
              <AdminPanel
                tenants={tenants}
                stores={stores}
                products={products}
                orders={orders}
                setTenants={setTenants}
                setStores={setStores}
                triggerToast={triggerToast}
              />
            )}

            {gestaoRole === 'sandbox' && (
              <SandboxPanel />
            )}
          </div>
        </div>
      )}

      {/* 5. BAAS WALLET ACCORDION SLIDEOVER */}
      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
        walletBalance={walletBalance}
        setWalletBalance={setWalletBalance}
        walletHistory={walletHistory}
        setWalletHistory={setWalletHistory}
        triggerToast={triggerToast}
      />

      {/* 6. CONSUMER B2C SHOPPING VITRINE OVERLAY MODAL */}
      {visitingStore && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col">
          <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={visitingStore.logo} alt={visitingStore.name} className="w-8 h-8 object-cover rounded-lg" />
              <div>
                <span className="font-mono text-[8px] uppercase font-bold text-orange-400">Vitrine de Compras B2C</span>
                <h3 className="text-sm font-black text-white uppercase">{visitingStore.name}</h3>
              </div>
            </div>
            <button
              onClick={() => setVisitingStore(null)}
              className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full mx-auto">
            <StorefrontPanel
              activeConsumerStore={visitingStore}
              products={products}
              cart={cart}
              setIsCartOpen={setIsCartOpen}
              handleAddToCart={handleAddToCart}
              stores={stores}
              setActiveConsumerStore={setVisitingStore}
            />
          </div>
        </div>
      )}

      {/* 7. MODAL DE CADASTRO DE PRODUTOS / SERVIÇOS (RETAILER NEW PRODUCT FORM) */}
      <NewProductModal
        isOpen={newProductModal}
        onClose={() => setNewProductModal(false)}
        handleCreateProduct={handleCreateProduct}
        newProdName={newProdName}
        setNewProdName={setNewProdName}
        newProdPrice={newProdPrice}
        setNewProdPrice={setNewProdPrice}
        newProdCategory={newProdCategory}
        setNewProdCategory={setNewProdCategory}
        newProdStock={newProdStock}
        setNewProdStock={setNewProdStock}
        newProdDesc={newProdDesc}
        setNewProdDesc={setNewProdDesc}
        newProdIsService={newProdIsService}
        setNewProdIsService={setNewProdIsService}
      />

      {/* 8. SLIDEOVER CARRINHO DE COMPRAS B2C */}
      <B2CCartDrawer
        isOpen={isCartOpen}
        visitingStore={visitingStore}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        updateCartQty={updateCartQty}
        checkoutCart={checkoutCart}
        buyerName={buyerName}
        setBuyerName={setBuyerName}
        buyerEmail={buyerEmail}
        setBuyerEmail={setBuyerEmail}
        buyerAddress={buyerAddress}
        setBuyerAddress={setBuyerAddress}
      />

      {/* 9. ONBOARDING GPS OVERLAY MODAL */}
      <GpsOverlayModal
        isOpen={showGpsOverlay}
        handleGpsPermission={handleGpsPermission}
      />

      {/* 10. TOAST COMPONENT */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-800 text-white px-5 py-3.5 rounded-2xl flex items-center gap-3 shadow-2xl shadow-black animate-slide-up" id="toast-notification">
          <div className={`w-2 h-2 rounded-full ${
            toast.type === 'success' ? 'bg-emerald-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
          }`} />
          <span className="text-[11px] font-bold font-mono uppercase tracking-wide">{toast.message}</span>
        </div>
      )}

      {/* MODAL SOLICITAR ENTREGA */}
      <DeliveryManagerModal
        isOpen={showDeliveryModal}
        onClose={() => setShowDeliveryModal(false)}
        mode="employer"
        deliveries={deliveries}
        setDeliveries={setDeliveries}
        profileName={profileName}
        walletBalance={walletBalance}
        setWalletBalance={setWalletBalance}
        walletHistory={walletHistory}
        setWalletHistory={setWalletHistory}
        triggerToast={triggerToast}
      />

      {/* MODAL SOLICITAR FREELA */}
      <FreelaManagerModal
        isOpen={showFreelaModal}
        onClose={() => setShowFreelaModal(false)}
        mode="employer"
        freelanceJobs={freelanceJobs}
        setFreelanceJobs={setFreelanceJobs}
        profileName={profileName}
        triggerToast={triggerToast}
      />

      {/* MODAL NOTAS COMPARTILHADAS COMIGO */}
      <SharedNotesModal
        isOpen={showSharedNotesModal}
        onClose={() => setShowSharedNotesModal(false)}
        notes={notes}
        handleToggleChecklistItem={handleToggleChecklistItem}
      />

      {/* MODAL BUSCA DE COLABORADORES */}
      <UserSearchModal
        isOpen={showUserSearchModal}
        onClose={() => setShowUserSearchModal(false)}
        userSearchEmail={userSearchEmail}
        setUserSearchEmail={setUserSearchEmail}
        appUsers={appUsers}
        selectedFriendsForNote={selectedFriendsForNote}
        setSelectedFriendsForNote={setSelectedFriendsForNote}
        triggerToast={triggerToast}
      />

      {/* MODAL FAZER ENTREGAS */}
      <DeliveryManagerModal
        isOpen={showFazerEntregasModal}
        onClose={() => setShowFazerEntregasModal(false)}
        mode="employee"
        deliveries={deliveries}
        setDeliveries={setDeliveries}
        profileName={profileName}
        walletBalance={walletBalance}
        setWalletBalance={setWalletBalance}
        walletHistory={walletHistory}
        setWalletHistory={setWalletHistory}
        triggerToast={triggerToast}
      />

      {/* MODAL FAZER FREELAS */}
      <FreelaManagerModal
        isOpen={showFazerFreelasModal}
        onClose={() => setShowFazerFreelasModal(false)}
        mode="employee"
        freelanceJobs={freelanceJobs}
        setFreelanceJobs={setFreelanceJobs}
        profileName={profileName}
        walletHistory={walletHistory}
        setWalletHistory={setWalletHistory}
        setWalletBalance={setWalletBalance}
        triggerToast={triggerToast}
      />

      {/* MODAL MEU PERFIL E SEGURANÇA */}
      <UserProfileModal
        isOpen={showUserProfileModal}
        onClose={() => setShowUserProfileModal(false)}
        profileName={profileName}
        setProfileName={setProfileName}
        profileEmail={profileEmail}
        profilePhotoUrl={profilePhotoUrl}
        accountTypeCliente={accountTypeCliente}
        setAccountTypeCliente={setAccountTypeCliente}
        accountTypeEntregador={accountTypeEntregador}
        setAccountTypeEntregador={setAccountTypeEntregador}
        accountTypeLojista={accountTypeLojista}
        setAccountTypeLojista={setAccountTypeLojista}
        isProfileVisible={isProfileVisible}
        setIsProfileVisible={setIsProfileVisible}
        biometricsActive={biometricsActive}
        setBiometricsActive={setBiometricsActive}
        transactionPin={transactionPin}
        setTransactionPin={setTransactionPin}
        kycDocType={kycDocType}
        setKycDocType={setKycDocType}
        kycStatus={kycStatus}
        setKycStatus={setKycStatus}
        facialValidated={facialValidated}
        setFacialValidated={setFacialValidated}
        isFacialScanning={isFacialScanning}
        setIsFacialScanning={setIsFacialScanning}
        profileAddress={profileAddress}
        setProfileAddress={setProfileAddress}
        profileWhatsApp={profileWhatsApp}
        setProfileWhatsApp={setProfileWhatsApp}
        kycCpf={kycCpf}
        setKycCpf={setKycCpf}
        kycCnh={kycCnh}
        setKycCnh={setKycCnh}
        kycCnpj={kycCnpj}
        setKycCnpj={setKycCnpj}
        triggerToast={triggerToast}
      />

      <ChatModal
        isOpen={showChatModal}
        onClose={() => {
          setShowChatModal(false);
          setSelectedChatUser(null);
        }}
        selectedChatUser={selectedChatUser}
        setSelectedChatUser={setSelectedChatUser}
        chatMessageText={chatMessageText}
        setChatMessageText={setChatMessageText}
      />

      {/* MOMENTS MODAL - STORE REVIEWS & SOCIAL INTEGRATION */}
      <MomentsModal
        isOpen={showMomentsModal}
        selectedStoreForMoments={selectedStoreForMoments}
        onClose={() => {
          setShowMomentsModal(false);
          setSelectedStoreForMoments(null);
        }}
        momentos={momentos}
        onPublishMoment={(data) => {
          if (!selectedStoreForMoments) return;
          const newMoment = {
            id: `m-new-${Date.now()}`,
            storeId: selectedStoreForMoments.id,
            user: profileName || 'Você',
            avatar: profilePhotoUrl || '',
            content: data.content,
            rating: data.rating,
            mediaUrl: data.mediaUrl || undefined,
            createdAt: new Date().toLocaleString('pt-BR'),
            publishedToFeed: data.publishedToPraca
          };

          setMomentos(prev => [newMoment, ...prev]);

          if (data.publishedToPraca) {
            const newPost: SocialPost = {
              id: `post-moment-${newMoment.id}`,
              user: profileName || 'Você',
              avatar: profilePhotoUrl || '',
              time: 'Agora mesmo',
              content: `Avaliou a loja ${selectedStoreForMoments.name} com ${'★'.repeat(data.rating)}: "${data.content}"`,
              likes: 0,
              mediaUrls: data.mediaUrl ? [data.mediaUrl] : undefined
            };
            setPosts(prev => [newPost, ...prev]);
          }
          triggerToast('Momento compartilhado!', 'success');
          setShowMomentsModal(false);
          setSelectedStoreForMoments(null);
        }}
      />

      {/* REAL-TIME ALARM / REMINDER FULL OVERLAY MODAL */}
      <ActiveAlarmModal
        isOpen={!!activeAlarmNote}
        activeAlarmNote={activeAlarmNote}
        onSnooze={(newReminder) => {
          if (!activeAlarmNote) return;
          setNotes(prev => prev.map(n => n.id === activeAlarmNote.id ? { ...n, reminderDateTime: newReminder } : n));
          setActiveAlarmNote(null);
          triggerToast('Soneca ativada por 1 minuto!', 'info');
        }}
        onDismiss={() => {
          if (!activeAlarmNote) return;
          setDismissedAlarms(prev => [...prev, activeAlarmNote.id]);
          setActiveAlarmNote(null);
          triggerToast('Alarme descartado com sucesso.', 'success');
        }}
      />

      {/* 5. MODAL DE CONFIGURAÇÃO DE PERFIL E AMBIENTES DA LOJA */}
      <StoreConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        configStoreName={configStoreName}
        setConfigStoreName={setConfigStoreName}
        configStoreBio={configStoreBio}
        setConfigStoreBio={setConfigStoreBio}
        configStoreAddress={configStoreAddress}
        setConfigStoreAddress={setConfigStoreAddress}
        configStoreContact={configStoreContact}
        setConfigStoreContact={setConfigStoreContact}
        configStoreKeywords={configStoreKeywords}
        setConfigStoreKeywords={setConfigStoreKeywords}
        newAtendimentoSpace={newAtendimentoSpace}
        setNewAtendimentoSpace={setNewAtendimentoSpace}
        handleAddAtendimentoSpace={handleAddAtendimentoSpace}
        atendimentoSpaces={atendimentoSpaces}
        handleRemoveAtendimentoSpace={handleRemoveAtendimentoSpace}
        newProducaoSpace={newProducaoSpace}
        setNewProducaoSpace={setNewProducaoSpace}
        handleAddProducaoSpace={handleAddProducaoSpace}
        producaoSpaces={producaoSpaces}
        handleRemoveProducaoSpace={handleRemoveProducaoSpace}
        handleSaveStoreProfile={handleSaveStoreProfile}
      />

      {/* MINIMAL FOOTER FOR PREMIUM INTEGRATION */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mb-20 text-center space-y-2">
        <p className="text-[9px] text-slate-500 font-mono">
          Kyrub Ecosystem Platform • Projetado para Google Cloud Run + Cloudflare Enterprise. Todos os direitos reservados.
        </p>
      </footer>

    </div>
  );
}
