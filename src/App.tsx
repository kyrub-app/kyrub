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

// Import helper functions
import { getDistance, formatWhatsApp, formatCpf, formatCnpj } from './utils/helpers';

// Firebase & Sync engine integration imports
import { db, auth } from './utils/firebase';
import { saveDocLWW, listenCollection, syncOfflineBatch, resolveConflictLWW } from './utils/syncEngine';
import { onAuthStateChanged, signInAnonymously, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, runTransaction, collection, onSnapshot, getDocs, deleteDoc } from 'firebase/firestore';

// Import fallback/seed initial mocks
import {
  appUsers,
  friends as initialFriends,
  posts as initialPosts,
  deliveries as initialDeliveries,
  freelanceJobs as initialFreelanceJobs,
  momentos as initialMomentos,
  connectionRequests as initialConnectionRequests,
  simulatedChatHistory as initialChatHistory,
  initialNotes,
  initialTenants,
  initialStores,
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
  CONNECTION_REQUESTS: 'kyrub_connection_requests',
  CHAT_HISTORY: 'kyrub_chat_history',
  WALLET_BALANCE: 'kyrub_wallet_balance',
  WALLET_HISTORY: 'kyrub_wallet_history',
  FAVORITE_STORES: 'kyrub_favorite_stores'
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
    return saved ? JSON.parse(saved) : initialStores;
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const triggerToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
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

  // GUIA 1 State: Productivity notes (Persistent)
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.NOTES);
    return saved ? JSON.parse(saved) : initialNotes;
  });

  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteChecklist, setNewNoteChecklist] = useState('');
  const [selectedFriendsForNote, setSelectedFriendsForNote] = useState<string[]>([]);
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);

  // GUIA 3 State: Social Friends & Posts (Persistent)
  const [friends, setFriends] = useState<Friend[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FRIENDS);
    return saved ? JSON.parse(saved) : initialFriends;
  });
  const [dbUsers, setDbUsers] = useState<any[]>([]);

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

  // Wallet and BaaS state (Persistent)
  const [walletBalance, setWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.WALLET_BALANCE);
    return saved ? parseFloat(saved) : 0.00;
  });
  const [pixTargetKey, setPixTargetKey] = useState('');
  const [pixAmount, setPixAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [walletHistory, setWalletHistory] = useState<any[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.WALLET_HISTORY);
    return saved ? JSON.parse(saved) : [];
  });

  // Social Sub-tab, GPS Slider Filter and Search states
  const [radiusKm, setRadiusKm] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [socialSubTab, setSocialSubTab] = useState<'lojas' | 'usuarios'>('lojas');

  // New states for restructure
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FAVORITE_STORES);
    return saved ? JSON.parse(saved) : ['s-1'];
  });
  const [ofertasFilter, setOfertasFilter] = useState<'todas' | 'novas' | 'favoritas' | 'cliente'>('todas');
  const [pracaFilter, setPracaFilter] = useState<'recentes' | 'favoritos' | 'conectados'>('recentes');
  const [conectadosSubTab, setConectadosSubTab] = useState<'sugestoes' | 'solicitacoes'>('sugestoes');
  const [connectionRequests, setConnectionRequests] = useState<any[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONNECTION_REQUESTS);
    return saved ? JSON.parse(saved) : initialConnectionRequests;
  });

  // Simulated private chat state (Persistent)
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatUser, setSelectedChatUser] = useState<any | null>(null);
  const [chatMessageText, setChatMessageText] = useState('');
  const [simulatedChatHistory, setSimulatedChatHistory] = useState<{ [key: string]: { sender: string, text: string, time: string }[] }>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    return saved ? JSON.parse(saved) : initialChatHistory;
  });

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
    pushTenants();
  }, [tenants, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.STORES, JSON.stringify(stores));
    const pushStores = async () => {
      for (const store of stores) {
        await saveDocLWW('tenants/tenant_default/stores', store.id, {
          ...store,
          updatedAt: (store as any).updatedAt || new Date().toISOString()
        });
      }
    };
    pushStores();
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
    pushProducts();
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
    pushOrders();
  }, [orders, isLoggedIn]);

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
    pushNotes();
  }, [notes, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.FRIENDS, JSON.stringify(friends));
    const pushFriends = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      for (const friend of friends) {
        await saveDocLWW(`users/${uid}/friends`, friend.id, {
          ...friend,
          updatedAt: (friend as any).updatedAt || new Date().toISOString()
        });
      }
    };
    pushFriends();
  }, [friends, isLoggedIn]);

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
    pushPosts();
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
    pushDeliveries();
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
    pushFreelance();
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
    pushMomentos();
  }, [momentos, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.CONNECTION_REQUESTS, JSON.stringify(connectionRequests));
  }, [connectionRequests, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(simulatedChatHistory));
  }, [simulatedChatHistory, isLoggedIn]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WALLET_BALANCE, walletBalance.toString());
  }, [walletBalance]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.WALLET_HISTORY, JSON.stringify(walletHistory));
  }, [walletHistory]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FAVORITE_STORES, JSON.stringify(favoriteStoreIds));
  }, [favoriteStoreIds]);

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
  const [deliveryParcelDesc, setDeliveryParcelDesc] = useState('');
  const [deliveryPickupPoint, setDeliveryPickupPoint] = useState('');
  const [deliveryDeliveryPoint, setDeliveryDeliveryPoint] = useState('');
  const [deliveryModalTab, setDeliveryModalTab] = useState<'solicitar' | 'publicados' | 'historico'>('solicitar');
  const [deliveryIncentive, setDeliveryIncentive] = useState('0');
  const [deliveryDistance, setDeliveryDistance] = useState(3.5);
  const [fazerEntregasModalTab, setFazerEntregasModalTab] = useState<'solicitacoes' | 'trajeto' | 'historico'>('solicitacoes');

  // New Freela Modal states
  const [showFreelaModal, setShowFreelaModal] = useState(false);
  const [freelaTitle, setFreelaTitle] = useState('');
  const [freelaDesc, setFreelaDesc] = useState('');
  const [freelaRequirements, setFreelaRequirements] = useState('');
  const [freelaPayment, setFreelaPayment] = useState('');
  const [freelaModalTab, setFreelaModalTab] = useState<'solicitar' | 'publicados' | 'historico'>('solicitar');
  const [fazerFreelasModalTab, setFazerFreelasModalTab] = useState<'solicitacoes' | 'fazendo' | 'historico'>('solicitacoes');
  const [editingFreelaId, setEditingFreelaId] = useState<string | null>(null);

  useEffect(() => {
    if (showDeliveryModal) {
      setDeliveryDistance(parseFloat((Math.random() * 4 + 1.5).toFixed(1)));
      setDeliveryIncentive('0');
      setDeliveryModalTab('solicitar');
    }
  }, [showDeliveryModal]);

  useEffect(() => {
    if (showFreelaModal) {
      setFreelaModalTab('solicitar');
    }
  }, [showFreelaModal]);

  // Notes Edit & Share state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [showSharedNotesModal, setShowSharedNotesModal] = useState(false);
  const [showUserSearchModal, setShowUserSearchModal] = useState(false);
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [showFazerEntregasModal, setShowFazerEntregasModal] = useState(false);
  const [showFazerFreelasModal, setShowFazerFreelasModal] = useState(false);

  useEffect(() => {
    if (showFazerFreelasModal) {
      setFazerFreelasModalTab('solicitacoes');
    }
  }, [showFazerFreelasModal]);

  useEffect(() => {
    if (showFazerEntregasModal) {
      setFazerEntregasModalTab('solicitacoes');
    }
  }, [showFazerEntregasModal]);

  useEffect(() => {
    if (isAdminSubdomain) {
      setIsLoggedIn(true);
      setIsGestaoOpen(true);
      setGestaoRole('admin');
    }
  }, [isAdminSubdomain]);

  // Notes/Tasks New Features State
  const [newNoteMediaUrls, setNewNoteMediaUrls] = useState<string[]>([]);
  const [newNoteReminderDateTime, setNewNoteReminderDateTime] = useState<string>('');
  const [newNoteIsPublishedToFeed, setNewNoteIsPublishedToFeed] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeAlarmNote, setActiveAlarmNote] = useState<Note | null>(null);
  const [dismissedAlarms, setDismissedAlarms] = useState<string[]>([]);

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

  // Active Retailer state
  const activeRetailerId = 't-3'; // Default organization
  const activeRetailer = tenants.find(t => t.id === activeRetailerId);

  const activeStore = useMemo(() => {
    return stores.find(s => s.id === activeRetailerId) || {
      id: activeRetailerId,
      name: 'Sua Loja Digital',
      description: 'Sua biografia da loja',
      address: 'Seu Endereço',
      contact: '(11) 99999-9999',
      keywords: [],
      logo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop&q=80',
      slug: 'sua-loja-digital',
      plan: 'free' as const,
      ownerEmail: 'usuario@kyrub.com'
    };
  }, [stores]);

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
    let unsubStoresInit = () => {};
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoggedIn(true);
        setProfileName(user.displayName || 'Você');
        setProfileEmail(user.email || 'usuario@kyrub.com');
        setProfilePhotoUrl(user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80');

        // Register authenticated user globally in /users/{uid} for real-time suggestions and multiplayer connections
        try {
          const userPayload = {
            id: user.uid,
            name: user.displayName || 'Você',
            email: user.email || 'usuario@kyrub.com',
            photoUrl: user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            isProfileVisible: true,
            updatedAt: new Date().toISOString()
          };
          setDoc(doc(db, 'users', user.uid), userPayload, { merge: true }).catch(err => console.error("Error writing user doc:", err));
        } catch (e) {
          console.error("Failed to write authenticated user doc", e);
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

          // Sync stores dynamically via onSnapshot
          unsubStoresInit = onSnapshot(collection(db, 'tenants/tenant_default/stores'), async (snapshot) => {
            const remoteStores: any[] = [];
            snapshot.forEach(docSnap => remoteStores.push({ id: docSnap.id, ...docSnap.data() }));
            if (remoteStores.length === 0) {
              for (const s of initialStores) {
                await setDoc(doc(db, 'tenants/tenant_default/stores', s.id), { ...s, updatedAt: new Date().toISOString() });
              }
              setStores(initialStores);
            } else {
              setStores(remoteStores);
            }
          }, (err) => {
            console.error("Error listening to stores initially:", err);
          });

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
        } catch (e) {
          console.error('Initial sync error:', e);
          triggerToast('Iniciando em modo offline resiliente (Cache local ativo).', 'info');
        }
      } else {
        setIsLoggedIn(false);
        unsubStoresInit();
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
        setSimulatedChatHistory({});
      }
    });

    return () => {
      unsubscribe();
      unsubStoresInit();
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

    // Listen to stores
    const unsubStores = onSnapshot(collection(db, 'tenants/tenant_default/stores'), (snapshot) => {
      const docs: any[] = [];
      snapshot.forEach(docSnap => docs.push({ id: docSnap.id, ...docSnap.data() }));
      setStores(docs);
    }, (err) => {
      console.error("Error listening to stores in unsubStores:", err);
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

    // Listen to current user's incoming connection requests in real-time
    const uid = auth.currentUser?.uid;
    let unsubConnectionRequests = () => {};
    if (uid) {
      unsubConnectionRequests = listenCollection(`users/${uid}/connection_requests`, (docs) => {
        setConnectionRequests(prev => {
          const mergedMap = new Map(prev.map(r => [r.id, r]));
          let changed = false;
          docs.forEach(remoteDoc => {
            const localDoc = mergedMap.get(remoteDoc.id);
            if (!localDoc) {
              mergedMap.set(remoteDoc.id, remoteDoc);
              changed = true;
            } else if (remoteDoc.updatedAt && (localDoc as any).updatedAt) {
              const remoteTime = new Date(remoteDoc.updatedAt).getTime();
              const localTime = new Date((localDoc as any).updatedAt).getTime();
              if (remoteTime > localTime) {
                mergedMap.set(remoteDoc.id, remoteDoc);
                changed = true;
              }
            }
          });
          return changed ? Array.from(mergedMap.values()) : prev;
        });
      });
    }

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

    // Listen to connections
    let unsubConnections = () => {};
    if (uid) {
      unsubConnections = listenCollection('connections', (docs) => {
        const incomingReqs = docs.filter(d => d.toUserId === uid);
        if (incomingReqs.length > 0) {
          setConnectionRequests(prev => {
            const mergedMap = new Map(prev.map(r => [r.id, r]));
            let changed = false;
            incomingReqs.forEach(remoteDoc => {
              const adaptedDoc = {
                ...remoteDoc,
                id: remoteDoc.fromUserId || remoteDoc.id,
                name: remoteDoc.fromUserName || remoteDoc.name || 'Conexão',
                avatar: remoteDoc.fromUserAvatar || remoteDoc.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
                role: remoteDoc.fromUserRole || remoteDoc.role || 'Cliente',
                bio: remoteDoc.fromUserBio || remoteDoc.bio || 'Membro do Kyrub',
                updatedAt: remoteDoc.updatedAt || new Date().toISOString()
              };
              const localDoc = mergedMap.get(adaptedDoc.id);
              if (!localDoc) {
                mergedMap.set(adaptedDoc.id, adaptedDoc);
                changed = true;
              } else if (adaptedDoc.updatedAt && (localDoc as any).updatedAt) {
                const remoteTime = new Date(adaptedDoc.updatedAt).getTime();
                const localTime = new Date((localDoc as any).updatedAt).getTime();
                if (remoteTime > localTime) {
                  mergedMap.set(adaptedDoc.id, adaptedDoc);
                  changed = true;
                }
              }
            });
            return changed ? Array.from(mergedMap.values()) : prev;
          });
        }
      });
    }

    return () => {
      unsubSocialFeed();
      unsubPosts();
      unsubMomentos();
      unsubStores();
      unsubDeliveryJobs();
      unsubDeliveries();
      unsubFreelance();
      unsubUsers();
      unsubConnectionRequests();
      unsubNotes();
      unsubSocialTasks();
      unsubSharedNotes();
      unsubConnections();
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

  // Create New Delivery Job Flow
  const handleCreateDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryParcelDesc || !deliveryPickupPoint || !deliveryDeliveryPoint) {
      triggerToast('Por favor, preencha todos os campos da entrega!', 'error');
      return;
    }
    const incentiveVal = parseFloat(deliveryIncentive) || 0;
    const finalPayment = 10.00 + (deliveryDistance * 2.00) + incentiveVal;

    const newJob: DeliveryJob = {
      id: `del-${Date.now()}`,
      from: deliveryPickupPoint,
      to: `${deliveryDeliveryPoint} (${deliveryParcelDesc})`,
      distance: deliveryDistance,
      payment: parseFloat(finalPayment.toFixed(2)),
      status: 'available',
      requestedBy: profileName || 'Usuário'
    };
    setDeliveries([newJob, ...deliveries]);
    setDeliveryParcelDesc('');
    setDeliveryPickupPoint('');
    setDeliveryDeliveryPoint('');
    setDeliveryIncentive('0');
    setDeliveryModalTab('publicados');
    triggerToast('Solicitação de entrega criada com sucesso!', 'success');
  };

  // Delete delivery job from state and firestore
  const handleDeleteDeliveryJob = async (id: string) => {
    setDeliveries(prev => prev.filter(job => job.id !== id));
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'delivery_jobs', id));
      triggerToast('Entrega excluída com sucesso!', 'success');
    } catch (e) {
      console.error('Error deleting delivery job:', e);
      triggerToast('Removido localmente.', 'info');
    }
  };

// Create New Freela Job Flow
  const handleCreateFreela = (e: React.FormEvent) => {
    e.preventDefault();
    if (!freelaTitle || !freelaDesc || !freelaPayment) {
      triggerToast('Por favor, preencha todos os campos do freela!', 'error');
      return;
    }
    const paymentNum = parseFloat(freelaPayment);
    if (isNaN(paymentNum) || paymentNum <= 0) {
      triggerToast('Por favor, insira um valor de pagamento válido!', 'error');
      return;
    }

    if (editingFreelaId) {
      setFreelanceJobs(prev =>
        prev.map(job => {
          if (job.id === editingFreelaId) {
            return {
              ...job,
              title: freelaTitle,
              description: `${freelaDesc} ${freelaRequirements ? `(Requisitos: ${freelaRequirements})` : ''}`,
              payment: paymentNum,
              updatedAt: new Date().toISOString()
            };
          }
          return job;
        })
      );
      setEditingFreelaId(null);
      setFreelaTitle('');
      setFreelaDesc('');
      setFreelaRequirements('');
      setFreelaPayment('');
      setFreelaModalTab('publicados');
      triggerToast('Oportunidade de freela atualizada com sucesso!', 'success');
    } else {
      const newFreela: FreelanceJob = {
        id: `fre-${Date.now()}`,
        title: freelaTitle,
        employer: profileName || 'Você',
        description: `${freelaDesc} (Requisitos: ${freelaRequirements})`,
        payment: paymentNum,
        distance: parseFloat((Math.random() * 3 + 0.5).toFixed(1)),
        status: 'open'
      };
      setFreelanceJobs([newFreela, ...freelanceJobs]);
      setFreelaTitle('');
      setFreelaDesc('');
      setFreelaRequirements('');
      setFreelaPayment('');
      setFreelaModalTab('publicados');
      triggerToast('Oportunidade de freela publicada com sucesso!', 'success');
    }
  };

  // Delete freelance job from state and firestore
  const handleDeleteFreelanceJob = async (id: string) => {
    setFreelanceJobs(prev => prev.filter(job => job.id !== id));
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'freelance_jobs', id));
      triggerToast('Freela excluído com sucesso da nuvem!', 'success');
    } catch (e) {
      console.error('Error deleting freelance job:', e);
      triggerToast('Removido localmente.', 'info');
    }
  };

  // Handle Login Flow
  const handleLogin = async (provider: 'google' | 'apple') => {
    try {
      await signInAnonymously(auth);
      setShowLoginModal(false);
      setShowGpsOverlay(true);
      triggerToast(`Conectado com sucesso via ${provider === 'google' ? 'Google' : 'Apple'} no Firebase!`, 'success');
    } catch (error) {
      console.error('Firebase Auth error, falling back local:', error);
      setIsLoggedIn(true);
      setShowLoginModal(false);
      setShowGpsOverlay(true);
      triggerToast(`Conectado localmente via ${provider === 'google' ? 'Google' : 'Apple'}!`, 'success');
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

  const handleSimulatedUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    
    setIsUploading(true);
    setUploadProgress(0);
    
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 10;
      setUploadProgress(currentProgress);
      if (currentProgress >= 100) {
        clearInterval(interval);
        
        // Match chosen files with cool corresponding unsplash/picsum links or a sample video URL
        const uploadedUrls = filesArray.map((file: File, i: number) => {
          if (file.type && file.type.startsWith('video')) {
            return 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
          } else {
            const randoms = [
              'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&fit=crop&q=80',
              'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&fit=crop&q=80',
              'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&fit=crop&q=80'
            ];
            return randoms[i % randoms.length] || `https://picsum.photos/id/${Math.floor(Math.random() * 100)}/600/400`;
          }
        });
        
        setNewNoteMediaUrls(prev => [...prev, ...uploadedUrls]);
        setIsUploading(false);
        triggerToast(`Simulado upload para Firebase Storage: /users/custom-user/notes/${editingNoteId || 'nova-nota'}/`, 'success');
      }
    }, 150);
  };

  // Add or Update custom note
  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() || !newNoteContent.trim()) {
      triggerToast('Preencha o título e conteúdo da nota!', 'error');
      return;
    }

    const checklistItems = newNoteChecklist
      ? newNoteChecklist.split(',').map((item, idx) => {
          const trimmedText = item.trim();
          // Keep completed state if editing
          const existingItem = editingNoteId 
            ? notes.find(n => n.id === editingNoteId)?.checklist.find(i => i.text.toLowerCase() === trimmedText.toLowerCase())
            : undefined;
          return {
            id: existingItem?.id || `item-${Date.now()}-${idx}`,
            text: trimmedText,
            done: existingItem?.done || false
          };
        })
      : [];

    const noteIdToUse = editingNoteId || `note-${Date.now()}`;

    if (editingNoteId) {
      setNotes(prev =>
        prev.map(note => {
          if (note.id !== editingNoteId) return note;
          const updatedNote = {
            ...note,
            title: newNoteTitle.toUpperCase(),
            content: newNoteContent,
            associatedUsers: ['Você', ...selectedFriendsForNote],
            checklist: checklistItems,
            mediaUrls: newNoteMediaUrls,
            reminderDateTime: newNoteReminderDateTime || null,
            isPublishedToFeed: newNoteIsPublishedToFeed,
            auditLogs: [
              { user: 'Você', action: 'Editou a nota de trabalho', timestamp: new Date().toLocaleString('pt-BR') },
              ...note.auditLogs
            ]
          };

          // Firestore Sync Simulation Logging
          console.log(`[Firestore] Atualizando documento em 'tasks/${note.id}'`, {
            id: note.id,
            title: updatedNote.title,
            content: updatedNote.content,
            mediaUrls: updatedNote.mediaUrls,
            reminderDateTime: updatedNote.reminderDateTime,
            isPublishedToFeed: updatedNote.isPublishedToFeed,
            checklist: updatedNote.checklist,
            updatedAt: new Date().toISOString()
          });

          return updatedNote;
        })
      );

// If published to feed is enabled, trigger public post
      if (newNoteIsPublishedToFeed) {
        const checklistStr = checklistItems.length > 0 
          ? `\n\n📋 TAREFAS:\n${checklistItems.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
          : '';
        const existsPost = posts.some(p => p.id === `post-shared-${editingNoteId}`);
        if (!existsPost) {
          const newPost: SocialPost = {
            id: `post-shared-${editingNoteId}`,
            user: profileName || 'Você',
            avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            time: 'Agora mesmo',
            content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
            likes: 0,
            mediaUrls: newNoteMediaUrls
          };
          setPosts(prev => [newPost, ...prev]);
        } else {
          setPosts(prev => prev.map(p => p.id === `post-shared-${editingNoteId}` ? {
            ...p,
            content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
            mediaUrls: newNoteMediaUrls
          } : p));
        }
      }

      setEditingNoteId(null);
      setNewNoteTitle('');
      setNewNoteContent('');
      setNewNoteChecklist('');
      setSelectedFriendsForNote([]);
      setNewNoteMediaUrls([]);
      setNewNoteReminderDateTime('');
      setNewNoteIsPublishedToFeed(false);
      setShowAddNoteForm(false);
      triggerToast('Nota de trabalho atualizada com sucesso!', 'success');
      return;
    }

    const newNote: Note = {
      id: noteIdToUse,
      title: newNoteTitle.toUpperCase(),
      content: newNoteContent,
      associatedUsers: ['Você', ...selectedFriendsForNote],
      checklist: checklistItems,
      mediaUrls: newNoteMediaUrls,
      reminderDateTime: newNoteReminderDateTime || null,
      isPublishedToFeed: newNoteIsPublishedToFeed,
      auditLogs: [
        { user: 'Você', action: 'Criou a nota de produtividade', timestamp: new Date().toLocaleString('pt-BR') }
      ]
    };

    // Firestore Sync Simulation Logging
    console.log(`[Firestore] Salvando novo documento em 'tasks/${noteIdToUse}'`, {
      id: noteIdToUse,
      title: newNote.title,
      content: newNote.content,
      mediaUrls: newNote.mediaUrls,
      reminderDateTime: newNote.reminderDateTime,
      isPublishedToFeed: newNote.isPublishedToFeed,
      checklist: newNote.checklist,
      createdAt: new Date().toISOString()
    });

setNotes([newNote, ...notes]);

    if (newNoteIsPublishedToFeed) {
      const checklistStr = checklistItems.length > 0 
        ? `\n\n📋 TAREFAS:\n${checklistItems.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
        : '';
      const newPost: SocialPost = {
        id: `post-shared-${noteIdToUse}`,
        user: profileName || 'Você',
        avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
        time: 'Agora mesmo',
        content: `📢 [NOTA COMPARTILHADA] *${newNoteTitle.toUpperCase()}*\n\n"${newNoteContent}"${checklistStr}`,
        likes: 0,
        mediaUrls: newNoteMediaUrls
      };
      setPosts(prev => [newPost, ...prev]);
      triggerToast('Nota salva e publicada no feed!', 'success');
    } else {
      triggerToast('Nota e checklist de tarefas criados!', 'success');
    }

    setNewNoteTitle('');
    setNewNoteContent('');
    setNewNoteChecklist('');
    setSelectedFriendsForNote([]);
    setNewNoteMediaUrls([]);
    setNewNoteReminderDateTime('');
    setNewNoteIsPublishedToFeed(false);
    setShowAddNoteForm(false);
  };

  const handleEditClick = (note: Note) => {
    setEditingNoteId(note.id);
    setNewNoteTitle(note.title);
    setNewNoteContent(note.content);
    setNewNoteChecklist(note.checklist.map(item => item.text).join(', '));
    setSelectedFriendsForNote(note.associatedUsers.filter(u => u !== 'Você'));
    
    // Load existing new fields on edit
    setNewNoteMediaUrls(note.mediaUrls || []);
    setNewNoteReminderDateTime(note.reminderDateTime || '');
    setNewNoteIsPublishedToFeed(note.isPublishedToFeed || false);

    setShowAddNoteForm(true);
    triggerToast(`Editando nota: ${note.title}`, 'info');
  };

  const handleDeleteNote = (noteId: string) => {
    // Firestore Delete simulation & physical delete
    console.log(`[Firestore] Deletando documento em 'tasks/${noteId}'`);
    deleteDoc(doc(db, 'tenants/tenant_default/tasks', noteId))
      .catch(err => console.error("Error deleting note in Firestore:", err));

    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setNewNoteTitle('');
      setNewNoteContent('');
      setNewNoteChecklist('');
      setSelectedFriendsForNote([]);
      setNewNoteMediaUrls([]);
      setNewNoteReminderDateTime('');
      setNewNoteIsPublishedToFeed(false);
    }
    triggerToast('Nota excluída com sucesso!', 'success');
  };

  // Toggle checklist item within a note (Adds audit log entry!)
  const handleToggleChecklistItem = (noteId: string, itemId: string) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        const updatedChecklist = note.checklist.map(item =>
          item.id === itemId ? { ...item, done: !item.done } : item
        );
        const toggledItem = note.checklist.find(i => i.id === itemId);
        const actionText = toggledItem
          ? `Marcou "${toggledItem.text}" como ${!toggledItem.done ? 'CONCLUÍDO' : 'PENDENTE'}`
          : 'Alterou item do checklist';
        
        return {
          ...note,
          checklist: updatedChecklist,
          auditLogs: [
            { user: 'Você', action: actionText, timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );
    triggerToast('Tarefa atualizada e auditoria registrada!', 'success');
  };

  // Toggle friends
  const handleToggleFriend = async (friendId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      triggerToast('Faça login para conectar com outros usuários!', 'error');
      return;
    }

    setFriends(prev => {
      const exists = prev.some(f => f.id === friendId);
      if (exists) {
        return prev.map(f => {
          if (f.id !== friendId) return f;
          const nowAdded = !f.added;
          triggerToast(nowAdded ? `${f.name} adicionado aos amigos!` : `${f.name} removido dos amigos.`, 'info');
          
          if (nowAdded) {
            // Write connection request to Firestore in real-time
            const requestPayload = {
              id: currentUser.uid,
              name: profileName || 'Você',
              role: accountTypeLojista ? 'Lojista' : accountTypeEntregador ? 'Entregador' : 'Cliente',
              avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
              bio: profileAddress || 'Membro do Kyrub',
              isProfileVisible: true,
              updatedAt: new Date().toISOString()
            };
            setDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid), requestPayload)
              .then(() => triggerToast('Solicitação enviada em tempo real!', 'success'))
              .catch(err => console.error("Error creating connection request doc:", err));
          } else {
            // Delete request if unconnecting
            deleteDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid))
              .catch(err => console.error("Error deleting connection request:", err));
          }
          return { ...f, added: nowAdded };
        });
      } else {
        // Find in database users directory
        const dbUser = dbUsers.find(u => u.id === friendId);
        if (dbUser) {
          const newFriend: Friend = {
            id: dbUser.id,
            name: dbUser.name || dbUser.email,
            role: dbUser.role || (dbUser.accountTypes?.lojista ? 'Lojista' : dbUser.accountTypes?.entregador ? 'Entregador' : 'Cliente'),
            added: true,
            avatar: dbUser.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            bio: dbUser.bio || dbUser.whatsapp || 'Membro do Kyrub',
            isProfileVisible: dbUser.isProfileVisible !== false,
            favorited: false
          };
          triggerToast(`${newFriend.name} adicionado aos amigos!`, 'info');

          // Send request in real-time
          const requestPayload = {
            id: currentUser.uid,
            name: profileName || 'Você',
            role: accountTypeLojista ? 'Lojista' : accountTypeEntregador ? 'Entregador' : 'Cliente',
            avatar: profilePhotoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
            bio: profileAddress || 'Membro do Kyrub',
            isProfileVisible: true,
            updatedAt: new Date().toISOString()
          };
          setDoc(doc(db, `users/${friendId}/connection_requests`, currentUser.uid), requestPayload)
            .then(() => triggerToast('Solicitação enviada em tempo real!', 'success'))
            .catch(err => console.error("Error creating connection request doc:", err));

          return [newFriend, ...prev];
        }
        return prev;
      }
    });
  };

  const getSuggestions = () => {
    const mergedMap = new Map<string, any>();
    
    // 1. Add local fallback/mock friends
    friends.forEach(f => {
      mergedMap.set(f.id, f);
    });

    // 2. Overwrite or add real users from Firestore `/users`
    dbUsers
      .filter(u => u.id !== auth.currentUser?.uid) // exclude current user
      .forEach(u => {
        const existingFriend = friends.find(f => f.id === u.id);
        mergedMap.set(u.id, {
          id: u.id,
          name: u.name || u.email,
          role: u.role || (u.accountTypes?.lojista ? 'Lojista' : u.accountTypes?.entregador ? 'Entregador' : 'Cliente'),
          added: existingFriend ? existingFriend.added : false,
          avatar: u.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&q=80',
          bio: u.bio || u.whatsapp || 'Membro do Kyrub',
          isProfileVisible: u.isProfileVisible !== false,
          favorited: existingFriend ? existingFriend.favorited : false
        });
      });

    // Filter to return only suggestions (not added yet)
    return Array.from(mergedMap.values()).filter(f => !f.added && f.isProfileVisible !== false);
  };

  const handleToggleFavoriteFriend = (friendId: string) => {
    setFriends(prev =>
      prev.map(f => {
        if (f.id !== friendId) return f;
        const nowFavorited = !(f as any).favorited;
        triggerToast(nowFavorited ? `${f.name} adicionado aos favoritos!` : `${f.name} removido dos favoritos.`, 'success');
        return { ...f, favorited: nowFavorited } as any;
      })
    );
  };

  const handleToggleFavoriteStore = (storeId: string) => {
    if (favoriteStoreIds.includes(storeId)) {
      setFavoriteStoreIds(prev => prev.filter(id => id !== storeId));
      triggerToast('Loja removida dos favoritos!', 'info');
    } else {
      setFavoriteStoreIds(prev => [...prev, storeId]);
      triggerToast('Loja favoritada!', 'success');
    }
  };

  const handleAcceptRequest = async (req: any) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const exists = friends.some(f => f.name === req.name);
    if (exists) {
      setFriends(prev => prev.map(f => f.name === req.name ? { ...f, added: true } : f));
    } else {
      const newFriend: Friend = {
        id: req.id,
        name: req.name,
        role: req.role,
        added: true,
        avatar: req.avatar,
        bio: req.bio || 'Sem biografia cadastrada no perfil.',
        isProfileVisible: true,
        favorited: false
      } as any;
      setFriends(prev => [...prev, newFriend]);
    }

    // Clean up request document from Firestore
    try {
      await deleteDoc(doc(db, `users/${currentUser.uid}/connection_requests`, req.id));
      triggerToast(`Solicitação de ${req.name} aceita! Conexão estabelecida.`, 'success');
    } catch (err) {
      console.error("Error deleting connection request doc:", err);
    }

    setConnectionRequests(prev => prev.filter(r => r.id !== req.id));
  };

  const handleDeclineRequest = async (reqId: string, reqName: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      await deleteDoc(doc(db, `users/${currentUser.uid}/connection_requests`, reqId));
      triggerToast(`Solicitação de ${reqName} recusada.`, 'info');
    } catch (err) {
      console.error("Error deleting connection request doc:", err);
    }

    setConnectionRequests(prev => prev.filter(r => r.id !== reqId));
  };

const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChatUser || !chatMessageText.trim()) return;

    const userId = selectedChatUser.id;
    const userMsg = {
      sender: profileName || 'Você',
      text: chatMessageText,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setSimulatedChatHistory(prev => ({
      ...prev,
      [userId]: [...(prev[userId] || []), userMsg]
    }));
    setChatMessageText('');

    setTimeout(() => {
      const responses = [
        "Que ótimo! Com certeza podemos negociar isso.",
        "Perfeito, vou verificar no estoque do ERP agora mesmo e te retorno.",
        "Obrigado pelo contato! Se quiser, posso gerar um split de faturamento via BaaS.",
        "Excelente! Vamos conversando por aqui."
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      const systemMsg = {
        sender: selectedChatUser.name,
        text: randomResponse,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };

      setSimulatedChatHistory(prev => ({
        ...prev,
        [userId]: [...(prev[userId] || []), systemMsg]
      }));
      triggerToast(`Nova mensagem de ${selectedChatUser.name}`, 'info');
    }, 1500);
  };

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

  // Share Note with a friend directly (Adds audit log entry!)
  const handleShareNoteWithFriend = (noteId: string, friendName: string) => {
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        if (note.associatedUsers.includes(friendName)) {
          triggerToast(`Esta nota já está compartilhada com ${friendName}.`, 'info');
          return note;
        }
        return {
          ...note,
          associatedUsers: [...note.associatedUsers, friendName],
          auditLogs: [
            { user: 'Você', action: `Compartilhou nota com ${friendName}`, timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );
    triggerToast(`Nota compartilhada com ${friendName}!`, 'success');
  };

  // Publish note externally to community/public feed
  const handleShareNoteExternally = (noteId: string) => {
    const noteToShare = notes.find(n => n.id === noteId);
    if (!noteToShare) return;

    if (noteToShare.shared) {
      triggerToast('Esta nota já foi compartilhada no feed!', 'info');
      return;
    }

    // 1. Set the shared flag to true in local state
    setNotes(prev =>
      prev.map(note => {
        if (note.id !== noteId) return note;
        return {
          ...note,
          shared: true,
          auditLogs: [
            { user: 'Você', action: 'Compartilhou nota publicamente no feed', timestamp: new Date().toLocaleString('pt-BR') },
            ...note.auditLogs
          ]
        };
      })
    );

    // 2. Add the social post to feed posts state
    const checklistStr = noteToShare.checklist.length > 0 
      ? `\n\n📋 TAREFAS:\n${noteToShare.checklist.map(item => `${item.done ? '✓' : '☐'} ${item.text}`).join('\n')}`
      : '';

const newPost: SocialPost = {
      id: `post-shared-${Date.now()}`,
      user: profileName || '',
      avatar: profilePhotoUrl || '',
      time: 'Agora mesmo',
      content: `📢 [NOTA COMPARTILHADA] *${noteToShare.title}*\n\n"${noteToShare.content}"${checklistStr}`,
      likes: 0,
      mediaUrls: noteToShare.mediaUrls || []
    };

    setPosts(prev => [newPost, ...prev]);
    triggerToast('Nota compartilhada com sucesso no feed principal!', 'success');
  };

  // Accept and update delivery job state
  const handleAcceptDelivery = (jobId: string) => {
    setDeliveries(prev =>
      prev.map(d => {
        if (d.id !== jobId) return d;
        triggerToast(`Entrega de ${d.from} aceita! Vá até a loja para coletar o pacote.`, 'success');
        return { ...d, status: 'accepted', acceptedBy: profileName || 'Você', updatedAt: new Date().toISOString() };
      })
    );
  };

  // Simulate progress of delivery
  const handleAdvanceDelivery = (jobId: string, nextStatus: 'delivering' | 'done') => {
    setDeliveries(prev =>
      prev.map(d => {
        if (d.id !== jobId) return d;
        if (nextStatus === 'done') {
          setWalletBalance(curr => curr + d.payment);
          setWalletHistory([
            { id: `tx-del-${Date.now()}`, type: 'Logística', desc: `Faturamento de entrega ID ${d.id}`, val: d.payment, date: new Date().toLocaleString('pt-BR') },
            ...walletHistory
          ]);
          triggerToast(`Pacote entregue! R$ ${d.payment.toFixed(2)} adicionados à sua carteira.`, 'success');
        } else {
          triggerToast(`Pacote coletado. A caminho do destino final!`, 'info');
        }
        return { ...d, status: nextStatus, updatedAt: new Date().toISOString() };
      })
    );
  };

  // Accept Gig jobs
  const handleApplyFreelance = (gigId: string) => {
    setFreelanceJobs(prev =>
      prev.map(g => {
        if (g.id !== gigId) return g;
        triggerToast(`Sua candidatura para "${g.title}" foi enviada para ${g.employer}!`, 'success');
        return { ...g, status: 'applied' };
      })
    );
  };

  // Simula contratação e conclusão do freelancer
  const handleSimulateGigDone = (gigId: string) => {
    setFreelanceJobs(prev =>
      prev.map(g => {
        if (g.id !== gigId) return g;
        setWalletBalance(curr => curr + g.payment);
        setWalletHistory([
          { id: `tx-gig-${Date.now()}`, type: 'Serviço Gig', desc: `Faturamento freela: ${g.title}`, val: g.payment, date: new Date().toLocaleString('pt-BR') },
          ...walletHistory
        ]);
        triggerToast(`Parabéns! Trabalho concluído e R$ ${g.payment.toFixed(2)} recebidos.`, 'success');
        return { ...g, status: 'done' };
      })
    );
  };

  // BaaS deposit simulation
  const handleSimulateDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(depositAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setWalletBalance(curr => curr + amountNum);
    setWalletHistory([
      { id: `tx-dep-${Date.now()}`, type: 'Depósito PIX', desc: 'Depósito em conta digital simulado', val: amountNum, date: new Date().toLocaleString('pt-BR') },
      ...walletHistory
    ]);
    setDepositAmount('');
    triggerToast(`Depósito de R$ ${amountNum.toFixed(2)} realizado!`, 'success');
  };

  // BaaS PIX transfer simulation
  const handleSimulatePix = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(pixAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;
    if (amountNum > walletBalance) {
      triggerToast('Saldo insuficiente para realizar este PIX!', 'error');
      return;
    }

    setWalletBalance(curr => curr - amountNum);
    setWalletHistory([
      { id: `tx-pix-${Date.now()}`, type: 'Transferência PIX', desc: `PIX para chave: ${pixTargetKey}`, val: -amountNum, date: new Date().toLocaleString('pt-BR') },
      ...walletHistory
    ]);
    setPixAmount('');
    setPixTargetKey('');
    triggerToast(`PIX de R$ ${amountNum.toFixed(2)} enviado com sucesso!`, 'success');
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
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans antialiased p-4 sm:p-6" id="staff-viewport">
        {/* Staff view header */}
        <header className="border-b border-slate-900 bg-slate-900/90 backdrop-blur-md py-4 px-6 rounded-3xl flex items-center justify-between mb-6 border border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-mono text-[8px] uppercase font-bold text-orange-500">Canal do Colaborador • ERP Kyrub</span>
              <h3 className="text-sm font-black text-white uppercase">Portal Operacional Staff</h3>
            </div>
          </div>
          <button
            onClick={handleGoBackToMain}
            className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer font-bold uppercase tracking-wider"
          >
            Voltar ao App
          </button>
        </header>

        {!isStaffLoggedIn ? (
          <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full py-12">
            <form onSubmit={handleStaffLogin} className="bg-slate-900 border border-slate-800/80 p-8 rounded-3xl space-y-5 w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl" />
              <div className="text-center space-y-1.5 pb-2">
                <h2 className="text-lg font-black text-white uppercase tracking-wider">Acesso Staff</h2>
                <p className="text-xs text-slate-400">Insira as credenciais operacionais fornecidas pelo lojista.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-bold">Email do Colaborador</label>
                  <input
                    type="email"
                    placeholder="staff@kyrub.com"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-bold">Senha de Acesso</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl transition-all shadow-lg shadow-orange-600/10 uppercase tracking-wider text-xs cursor-pointer"
              >
                Autenticar Painel
              </button>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/50 text-[10px] text-slate-500 font-mono text-center">
                <span>Dica de Teste:</span>
                <span className="block text-slate-400 font-bold mt-1">staff@kyrub.com / kyrub123</span>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
              <div>
                <span className="text-xs font-semibold tracking-wider text-orange-400 uppercase font-mono">Estabelecimento Parceiro</span>
                <h2 className="text-2xl font-black text-white tracking-tight">{activeStore?.name}</h2>
                <p className="text-slate-400 text-xs mt-0.5">Sua conta operacional possui privilégios de leitura e expedição física de produtos.</p>
              </div>
              <button
                onClick={handleStaffLogout}
                className="px-4 py-2 bg-red-950 hover:bg-red-900 text-red-300 font-bold rounded-xl text-xs transition-all uppercase cursor-pointer"
              >
                Encerrar Turno (Log Out)
              </button>
            </div>

            {/* Operational dashboard without financial data */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Orders List (Operational read-only view) */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
                <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <span>Pedidos Recebidos (Lista Operacional)</span>
                </h3>

                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                  {staffOrders.map(order => (
                    <div key={order.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-mono text-slate-500 uppercase">ID: {order.id}</span>
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase ${
                          order.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          order.status === 'shipped' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          order.status === 'processing' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {order.status === 'delivered' ? 'Entregue' :
                           order.status === 'shipped' ? 'Enviado' :
                           order.status === 'processing' ? 'Em Preparo' : 'Pendente'}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-mono text-slate-500 uppercase block">Cliente Destinatário</span>
                        <span className="text-xs font-bold text-slate-200">{order.buyerName}</span>
                      </div>

                      <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
                        <span className="text-[10px] font-mono text-slate-500 uppercase block">Itens para Separação</span>
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-slate-300">
                            <span>{item.name}</span>
                            <span className="font-mono text-orange-400 font-bold">x{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {staffOrders.length === 0 && (
                    <p className="text-center text-xs text-slate-500 py-12">Nenhum pedido recente registrado para separação.</p>
                  )}
                </div>
              </div>

              {/* Stock status view */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
                <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                  <span>Inventário & Estoque Físico</span>
                </h3>

                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {staffProducts.map(prod => (
                    <div key={prod.id} className="bg-slate-950 p-3 rounded-2xl border border-slate-850 flex gap-3">
                      <img src={prod.image} alt={prod.name} className="w-12 h-12 object-cover rounded-xl shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-xs text-slate-200 truncate">{prod.name}</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Categoria: {prod.category}</p>
                        <div className="flex justify-between items-center mt-2.5">
                          <span className="text-[10px] text-slate-500">Unidades em Estoque:</span>
                          <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg ${
                            prod.stock < 10 ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bg-slate-900 text-slate-300 border border-slate-800'
                          }`}>
                            {prod.stock} un
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {staffProducts.length === 0 && (
                    <p className="text-center text-xs text-slate-500 py-12">Nenhum produto cadastrado no inventário.</p>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        <footer className="border-t border-slate-900 py-4 mt-6 text-center text-[10px] text-slate-500 font-mono">
          Kyrub Ecosystem Platform • Operações Seguras sem Exposição de Margens • Faturamento Ocultado por Diretrizes de Compliance
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans antialiased selection:bg-orange-500/30 selection:text-white" id="root-app-container">
      
      {/* LANDING PAGE & LOGIN DETECT */}
      {!isLoggedIn ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" id="landing-page">
          <div className="w-full max-w-md text-center space-y-8">
            <div className="space-y-4">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-orange-500 to-teal-500 flex items-center justify-center shadow-2xl shadow-orange-500/10">
                <Zap className="w-9 h-9 text-slate-950 animate-pulse" />
              </div>
              <h1 className="text-4xl font-black text-white tracking-tight uppercase">Bem-vinda(o) a Kyrub</h1>
              <p className="text-slate-400 text-sm max-w-sm mx-auto">
                O ecossistema multi-tenant B2B2C completo para fornecedores, varejistas e profissionais de delivery.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl space-y-6">
              <button
                onClick={() => setShowLoginModal(true)}
                className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-orange-600/20 uppercase tracking-widest text-xs"
              >
                Entrar na Plataforma
              </button>
              <div className="flex justify-center gap-6 text-[10px] text-slate-500 font-mono uppercase">
                <span>Google Cloud Run</span>
                <span>•</span>
                <span>Cloudflare Guard</span>
              </div>
            </div>

            <button
              onClick={() => {
                window.history.pushState({}, '', '/staff');
                setCurrentPath('/staff');
              }}
              className="mt-6 text-[10px] text-slate-500 hover:text-orange-400 font-mono uppercase tracking-widest transition-colors cursor-pointer border border-slate-900 hover:border-orange-500/20 px-4 py-2 rounded-xl bg-slate-950"
              id="btn-goto-staff"
            >
              ⚙️ Acesso Operacional Staff
            </button>
          </div>

          {/* LOGIN MODAL */}
          {showLoginModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm space-y-6 shadow-2xl">
                <div className="text-center space-y-2">
                  <h3 className="text-lg font-black text-white uppercase tracking-wider">Identidade Kyrub</h3>
                  <p className="text-xs text-slate-400">Escolha um provedor para autenticar de forma segura.</p>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => handleLogin('google')}
                    className="w-full py-3 bg-white hover:bg-slate-100 text-slate-900 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-3"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.68 1.54 14.98 1 12 1 7.35 1 3.37 3.65 1.39 7.5l3.85 2.99c.92-2.76 3.51-4.45 6.76-4.45z"/>
                      <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.44h6.45c-.28 1.48-1.12 2.73-2.38 3.58l3.7 2.87c2.16-1.99 3.42-4.92 3.42-8.55z"/>
                      <path fill="#FBBC05" d="M5.24 10.49c-.24-.72-.37-1.49-.37-2.29s.13-1.57.37-2.29L1.39 2.92C.5 4.71 0 6.71 0 8.8s.5 4.09 1.39 5.88l3.85-2.99z"/>
                      <path fill="#34A853" d="M12 18.96c3.25 0 5.97-1.07 7.96-2.91l-3.7-2.87c-1.11.75-2.52 1.19-4.26 1.19-3.25 0-5.84-1.69-6.76-4.45L1.39 12.92c1.98 3.85 5.96 6.04 10.61 6.04z"/>
                    </svg>
                    <span>Continuar com Google</span>
                  </button>
                  <button
                    onClick={() => handleLogin('apple')}
                    className="w-full py-3 bg-slate-950 hover:bg-black text-white border border-slate-800 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-3"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.5-.63.73-1.18 1.87-1.03 2.98 1.12.09 2.27-.58 2.98-1.42z"/>
                    </svg>
                    <span>Continuar com Apple</span>
                  </button>
                </div>
                <button
                  onClick={() => setShowLoginModal(false)}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl text-xs transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
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
              <div className="space-y-6 animate-fade-in" id="perfil-tab-container">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-black text-white uppercase">Meu Dia</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSharedNotesModal(true)}
                      className="flex items-center justify-center bg-slate-900 border border-slate-800 text-teal-400 hover:text-teal-300 p-2 rounded-xl text-xs transition-all relative"
                      title="Notas Compartilhadas Comigo"
                      id="btn-notas-compartilhadas"
                    >
                      <Users className="w-4 h-4" />
                      {notes.filter(n => n.auditLogs[n.auditLogs.length - 1]?.user !== 'Você').length > 0 && (
                        <span className="absolute -top-1 -right-1 bg-teal-500 text-slate-950 font-mono text-[8px] font-bold px-1 rounded-full">
                          {notes.filter(n => n.auditLogs[n.auditLogs.length - 1]?.user !== 'Você').length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        if (showAddNoteForm) {
                          setEditingNoteId(null);
                          setNewNoteTitle('');
                          setNewNoteContent('');
                          setNewNoteChecklist('');
                          setSelectedFriendsForNote([]);
                        }
                        setShowAddNoteForm(!showAddNoteForm);
                      }}
                      className="flex items-center gap-1 bg-teal-500 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs hover:bg-teal-400 transition-all"
                    >
                      {showAddNoteForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      <span>{editingNoteId ? 'Editando' : 'Nova Nota'}</span>
                    </button>
                  </div>
                </div>

                {/* Form to Create Note */}
                {showAddNoteForm && (
                  <form onSubmit={handleCreateNote} className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                    <h3 className="text-xs font-mono uppercase text-slate-300 font-bold">
                      {editingNoteId ? 'Editar Nota / Checklist' : 'Criar Nota / Checklist'}
                    </h3>
                    
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Título da Nota"
                        value={newNoteTitle}
                        onChange={(e) => setNewNoteTitle(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        required
                      />
                      <textarea
                        placeholder="Conteúdo descritivo..."
                        value={newNoteContent}
                        onChange={(e) => setNewNoteContent(e.target.value)}
                        rows={2}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        required
                      />
                      <input
                        type="text"
                        placeholder="Checklist (separe os itens por vírgula)"
                        value={newNoteChecklist}
                        onChange={(e) => setNewNoteChecklist(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                      />

                      {/* Share checkbox selection with clickable link and search modal */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <button
                            type="button"
                            onClick={() => setShowUserSearchModal(true)}
                            className="text-[10px] text-teal-400 hover:text-teal-300 uppercase font-mono font-bold flex items-center gap-1 hover:underline cursor-pointer"
                            id="btn-add-usuario-link"
                          >
                            <span>ADD USUÁRIO</span>
                            <span className="text-[9px] bg-teal-500/10 border border-teal-500/30 text-teal-300 px-1.5 py-0.5 rounded-md font-mono">+ BUSCAR</span>
                          </button>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5">
                          {selectedFriendsForNote.length === 0 ? (
                            <span className="text-[10px] text-slate-500 italic font-mono">Nenhum colaborador adicionado</span>
                          ) : (
                            selectedFriendsForNote.map(name => (
                              <button
                                type="button"
                                key={name}
                                onClick={() => {
                                  setSelectedFriendsForNote(prev => prev.filter(n => n !== name));
                                  triggerToast(`${name} removido`, 'info');
                                }}
                                className="px-2 py-0.5 rounded bg-teal-500/10 border border-teal-500/30 text-teal-400 text-[10px] font-mono hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all flex items-center gap-1 cursor-pointer"
                                title="Clique para remover"
                              >
                                <span>{name}</span>
                                <span className="font-bold text-[9px]">✕</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Media Upload, Alarm Settings & Auto-Publish Panel */}
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80 space-y-3.5">
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 font-bold border-b border-slate-800/80 pb-2">
                        <span>🛠️ COMPONENTES ADICIONAIS</span>
                        <span className="text-[9px] text-teal-400">UPGRADE FIRESTORE</span>
                      </div>

                      {/* Media Input & Alarm Picker */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        {/* Media Upload Label */}
                        <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer hover:bg-slate-800/50 transition-colors text-xs flex-1">
                          <Camera className="w-4 h-4 text-orange-400" />
                          <span className="font-medium">Adicionar Mídia</span>
                          <input
                            type="file"
                            multiple
                            accept="image/*,video/*"
                            className="hidden"
                            onChange={handleSimulatedUpload}
                            disabled={isUploading}
                          />
                        </label>

                        {/* Date Picker Input */}
                        <div className="flex-1 relative">
                          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-orange-400">
                            <Bell className="w-3.5 h-3.5" />
                          </div>
                          <input
                            type="datetime-local"
                            value={newNoteReminderDateTime}
                            onChange={(e) => {
                              setNewNoteReminderDateTime(e.target.value);
                              if (e.target.value) {
                                triggerToast(`🔔 Alarme agendado para ${new Date(e.target.value).toLocaleString()}`, 'success');
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-200 rounded-xl pl-8 pr-7 py-2 text-xs focus:outline-none focus:border-orange-500/50"
                            title="Agendar Alarme / Notificação"
                          />
                          {newNoteReminderDateTime && (
                            <button
                              type="button"
                              onClick={() => {
                                setNewNoteReminderDateTime('');
                                triggerToast('Alarme removido', 'info');
                              }}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-400 text-xs font-bold"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Storage Simulated Progress Indicator */}
                      {isUploading && (
                        <div className="space-y-1.5 bg-slate-900/50 p-2.5 rounded-xl border border-slate-800">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span className="text-orange-400 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping"></span>
                              Enviando para o Storage...
                            </span>
                            <span className="text-slate-400 font-bold">{uploadProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-orange-500 h-full transition-all duration-150"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <span className="text-[8px] text-slate-500 block font-mono">
                            Pasta Firebase: <span className="text-slate-400">/users/kyrub-owner/notes/{editingNoteId || 'nova-nota'}/</span>
                          </span>
                        </div>
                      )}

                      {/* Previews Row */}
                      {newNoteMediaUrls.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-mono uppercase text-slate-500 block">Arquivos Anexados ({newNoteMediaUrls.length})</span>
                          <div className="flex flex-wrap gap-2 p-2 bg-slate-900 rounded-xl border border-slate-800/40">
                            {newNoteMediaUrls.map((url, i) => (
                              <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-800 group">
                                {url.includes('sample/ForBiggerBlazes.mp4') ? (
                                  <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-[8px] text-orange-400 font-mono font-bold leading-none p-1 text-center">
                                    <Play className="w-3.5 h-3.5 mb-0.5" />
                                    VÍDEO
                                  </div>
                                ) : (
                                  <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewNoteMediaUrls(prev => prev.filter((_, idx) => idx !== i));
                                    triggerToast('Mídia removida', 'info');
                                  }}
                                  className="absolute top-0 right-0 bg-red-600 hover:bg-red-500 text-white w-4 h-4 rounded-bl flex items-center justify-center text-[9px] font-bold"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Auto-publish selector */}
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newNoteIsPublishedToFeed}
                          onChange={(e) => setNewNoteIsPublishedToFeed(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-800 bg-slate-950 text-teal-500 focus:ring-teal-500/20"
                        />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-300">Publicar Automaticamente no Feed Comunitário</span>
                          <span className="text-[8px] text-slate-500 font-mono">Simula gravação reativa de gatilho no Firebase</span>
                        </div>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase"
                    >
                      {editingNoteId ? 'Atualizar Nota de Trabalho' : 'Salvar Nota de Trabalho'}
                    </button>
                  </form>
                )}

                {/* Grid Layout of Notes - 2 Columns on Mobile, responsive */}
                <div className="grid grid-cols-2 gap-3.5" id="notes-grid">
                  {notes.map(note => (
                    <div key={note.id} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex justify-between items-start">
                          <span className="text-xs font-black text-white tracking-wide uppercase truncate block w-[85%]">
                            {note.title}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px] mt-1.5 leading-relaxed">{note.content}</p>

                        {/* Attached Media Small Gallery */}
                        {note.mediaUrls && note.mediaUrls.length > 0 && (
                          <div className="mt-2.5 grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/60">
                            {note.mediaUrls.slice(0, 3).map((url, i) => (
                              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-800">
                                {url.includes('sample/ForBiggerBlazes.mp4') ? (
                                  <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-[7px] text-orange-400 font-mono font-bold leading-none">
                                    <Play className="w-2.5 h-2.5 mb-0.5" />
                                    VID
                                  </div>
                                ) : (
                                  <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                )}
                                {note.mediaUrls!.length > 3 && i === 2 && (
                                  <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center text-[9px] font-bold text-white">
                                    +{note.mediaUrls!.length - 3}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Active Scheduled Alarm Badge */}
                        {note.reminderDateTime && (
                          <div className="mt-2.5 flex items-center justify-between bg-orange-950/40 border border-orange-500/20 px-2.5 py-1.5 rounded-xl">
                            <div className="flex items-center gap-1.5 text-orange-400">
                              <Clock className="w-3.5 h-3.5 animate-pulse" />
                              <span className="text-[9px] font-mono font-bold">
                                {new Date(note.reminderDateTime).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <span className="text-[8px] bg-orange-500 text-slate-950 font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider scale-90">
                              Alarme
                            </span>
                          </div>
                        )}

                        {/* Checklist displaying task execution */}
                        {note.checklist.length > 0 && (
                          <div className="mt-3.5 space-y-2 border-t border-slate-800/60 pt-3">
                            <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist de Tarefas</span>
                            {note.checklist.map(item => (
                              <label key={item.id} className="flex items-start gap-1.5 cursor-pointer text-[10px] text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  onChange={() => handleToggleChecklistItem(note.id, item.id)}
                                  className="mt-0.5 accent-teal-500"
                                />
                                <span className={item.done ? 'line-through text-slate-500' : ''}>{item.text}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 border-t border-slate-800/60 pt-3">
                        {/* Associated Users / Shared */}
                        {note.associatedUsers.length > 0 && (
                          <div className="flex flex-wrap gap-1 items-center">
                            <Users className="w-3 h-3 text-slate-500" />
                            {note.associatedUsers.map((user, idx) => (
                              <span key={idx} className="bg-slate-950 px-1.5 py-0.5 rounded text-[9px] text-slate-400 border border-slate-800">
                                {user}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Audit Log (Last Modification) */}
                        <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-[9px] font-mono text-slate-500 space-y-1">
                          <span className="text-[8px] uppercase font-bold text-orange-400 block">Histórico de Auditoria</span>
                          {note.auditLogs.slice(0, 1).map((log, i) => (
                            <p key={i} className="truncate">
                              {log.user}: <span className="text-slate-300">{log.action}</span> - {log.timestamp.split(', ')[1] || log.timestamp}
                            </p>
                          ))}
                        </div>

                        {/* Quick Actions Footer */}
                        <div className="flex items-center justify-between border-t border-slate-800/40 pt-3 mt-1.5" id={`note-footer-${note.id}`}>
                          {/* Left: Public Share button */}
                          <div className="flex items-center">
                            {note.shared ? (
                              <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-bold animate-fade-in">
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Compartilhado</span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleShareNoteExternally(note.id)}
                                className="text-[10px] text-teal-400 hover:text-teal-300 font-mono font-bold flex items-center gap-1 hover:underline cursor-pointer transition-all"
                                title="Publicar nota no feed público"
                                id={`btn-share-note-${note.id}`}
                              >
                                <Share2 className="w-3 h-3" />
                                <span>+ Compartilhar</span>
                              </button>
                            )}
                          </div>

                          {/* Right: Edit & Delete buttons */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEditClick(note)}
                              className="p-1 text-slate-400 hover:text-teal-400 transition-all"
                              title="Editar Nota"
                              id={`btn-edit-note-${note.id}`}
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(note.id)}
                              className="p-1 text-slate-400 hover:text-red-400 transition-all"
                              title="Excluir Nota"
                              id={`btn-delete-note-${note.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GUIA 2: RENDA (Monetization & ERP) */}
            {activeTab === 'renda' && (
              <div className="space-y-6 animate-fade-in" id="renda-tab-container">
                
                {/* LINE 1: Dual cards side by side - 99entregas and 99freelas */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Delivery Vacancies Portals */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-3 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-orange-500" />
                        <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Entregas</h3>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Gerencie entregas locais do seu negócio ou faça fretes sob demanda para faturar no ecossistema de varejo.
                      </p>
                    </div>
                    <div className="space-y-2 pt-1">
                      <button
                        onClick={() => setShowDeliveryModal(true)}
                        className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-orange-600/10 cursor-pointer"
                        id="btn-solicitar-entrega"
                      >
                        Solicitar Entrega
                      </button>
                      <button
                        onClick={() => setShowFazerEntregasModal(true)}
                        className="w-full py-2 bg-slate-950 border border-slate-800 text-orange-400 hover:text-orange-300 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        id="btn-fazer-entregas"
                      >
                        <span>Fazer Entregas</span>
                        {deliveries.filter(d => d.status === 'available').length > 0 && (
                          <span className="bg-orange-500 text-slate-950 text-[8px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                            {deliveries.filter(d => d.status === 'available').length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Freelancer Vacancies Portals */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-3 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-4 h-4 text-teal-400" />
                        <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Freelas</h3>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Contrate profissionais sob demanda para sua loja ou preste serviços especializados para empresas locais.
                      </p>
                    </div>
                    <div className="space-y-2 pt-1">
                      <button
                        onClick={() => setShowFreelaModal(true)}
                        className="w-full py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-teal-500/10 cursor-pointer"
                        id="btn-solicitar-freela"
                      >
                        Solicitar Freela
                      </button>
                      <button
                        onClick={() => setShowFazerFreelasModal(true)}
                        className="w-full py-2 bg-slate-950 border border-slate-800 text-teal-400 hover:text-teal-300 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        id="btn-fazer-freela"
                      >
                        <span>Fazer Freela</span>
                        {freelanceJobs.filter(f => f.status === 'open').length > 0 && (
                          <span className="bg-teal-500 text-slate-950 text-[8px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                            {freelanceJobs.filter(f => f.status === 'open').length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* LINE 2: Retailer Management Card - Width 1 column mobile */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 flex flex-col justify-between" id="user-store-card">
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-orange-500" />
                      <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Ofertas</h3>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Crie sua loja e veja aqui um dashboard com os principais relatórios para vc gerenciar seu negócio.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setIsGestaoOpen(true);
                        setGestaoRole('retailer');
                        triggerToast('Inicializando Tenant de Lojista... Bem-vindo ao Painel de Clientes!', 'success');
                      }}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-slate-950 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-orange-600/10 cursor-pointer text-center block"
                      id="btn-criar-loja-ofertas"
                    >
                      Criar Loja
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* GUIA 3: KYRUB (Social Feed, Discovery & Proximity map) */}
            {activeTab === 'kyrub' && (
              <div className="space-y-6 animate-fade-in" id="kyrub-tab-container">
                
                {/* Header: Keyword Search & Radius adjustments */}
                <div className="space-y-3.5 bg-slate-900 p-4 rounded-3xl border border-slate-800">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Buscar lojas, produtos ou usuários..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* GPS Distance Adjustment slider */}
                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-orange-500" />
                      Filtro de Distância (GPS):
                    </span>
                    <div className="flex items-center gap-2 font-bold text-orange-400">
                      <input
                        type="range"
                        min="1"
                        max="50"
                        value={radiusKm}
                        onChange={(e) => setRadiusKm(Number(e.target.value))}
                        className="w-24 h-1 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                      <span>{radiusKm} KM</span>
                    </div>
                  </div>
                </div>

                {/* Two internal tabs: Ofertas and Praça */}
                <div className="flex border-b border-slate-800" id="social-tabs">
                  <button
                    onClick={() => setSocialSubTab('lojas')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                      socialSubTab === 'lojas' 
                        ? 'border-orange-500 text-white' 
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Ofertas
                  </button>
                  <button
                    onClick={() => setSocialSubTab('usuarios')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                      socialSubTab === 'usuarios' 
                        ? 'border-orange-500 text-white' 
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Praça
                  </button>
                </div>
 
                {/* Sub Tab: OFERTAS (Ex-Lojas Próximas) */}
                {socialSubTab === 'lojas' && (
                  <div className="space-y-4 animate-fade-in">
                    {/* Horizontal Filters Bar */}
                    <div className="flex items-center justify-around bg-slate-900/60 p-3 rounded-2xl border border-slate-800/80">
                      <button
                        onClick={() => setOfertasFilter(ofertasFilter === 'novas' ? 'todas' : 'novas')}
                        className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                          ofertasFilter === 'novas'
                            ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                            : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>Novas</span>
                      </button>
                      
                      <button
                        onClick={() => setOfertasFilter(ofertasFilter === 'favoritas' ? 'todas' : 'favoritas')}
                        className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                          ofertasFilter === 'favoritas'
                            ? 'bg-red-500/20 border-red-500 text-red-400'
                            : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>Favoritas</span>
                      </button>

                      <button
                        onClick={() => setOfertasFilter(ofertasFilter === 'cliente' ? 'todas' : 'cliente')}
                        className={`px-4 py-2 rounded-full border transition-all cursor-pointer text-xs font-bold uppercase ${
                          ofertasFilter === 'cliente'
                            ? 'bg-teal-500/20 border-teal-500 text-teal-400'
                            : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>Cliente</span>
                      </button>
                    </div>

                    {/* Stores Grid Layout (2 columns / compact card height) */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {storesWithCoords
                        .filter(store => {
                          // Search query (checks name, description and keywords)
                          if (searchQuery) {
                            const q = searchQuery.toLowerCase();
                            const matchesName = store.name.toLowerCase().includes(q);
                            const matchesDesc = store.description.toLowerCase().includes(q);
                            const matchesKeywords = store.keywords?.some((kw: string) => kw.toLowerCase().includes(q)) || false;
                            if (!matchesName && !matchesDesc && !matchesKeywords) {
                              return false;
                            }
                          }
                          // Distance Filter
                          if (userCoords) {
                            const dist = getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng);
                            if (dist > radiusKm) return false;
                          }
                          // Specific sub-filter
                          if (ofertasFilter === 'novas') return store.isNew;
                          if (ofertasFilter === 'favoritas') return favoriteStoreIds.includes(store.id);
                          if (ofertasFilter === 'cliente') return orders.some(o => o.storeId === store.id);
                          return true;
                        })
                        .map(store => {
                          const dist = userCoords ? getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng) : 1.2;
                          return (
                            <div key={store.id} className="relative rounded-3xl overflow-hidden border border-slate-800 bg-slate-950 flex flex-col justify-between h-[148px] group hover:border-slate-700 transition-all shadow-xl">
                              {/* Automatic Vitrine Slide background */}
                              <StoreOfferCarousel images={store.offerImages} />

                              {/* Top Indicators/Actions Overlay */}
                              <div className="absolute top-0 inset-x-0 p-2 flex justify-between items-start z-10">
                                {/* Canto Superior Esquerdo: Logo da Loja com Balão de Status */}
                                <div className="relative w-8.5 h-8.5 shrink-0">
                                  <img 
                                    src={store.logo} 
                                    alt={store.name} 
                                    className="w-8.5 h-8.5 object-cover rounded-xl border border-slate-800 bg-slate-900 shadow-md" 
                                    referrerPolicy="no-referrer" 
                                  />
                                  <span 
                                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-950 shadow-sm ${
                                      store.status === 'open' ? 'bg-emerald-500 animate-pulse' :
                                      store.status === 'delayed' ? 'bg-amber-500 animate-pulse' :
                                      'bg-slate-500'
                                    }`} 
                                    title={
                                      store.status === 'open' ? 'Aberta' :
                                      store.status === 'delayed' ? 'Alerta: +20 pedidos' :
                                      'Pausada'
                                    }
                                  />
                                </div>

                                {/* Canto Superior Direito: Favorite Toggle (Heart) */}
                                <button
                                  onClick={() => handleToggleFavoriteStore(store.id)}
                                  className="p-1 bg-slate-950/85 backdrop-blur-md rounded-full border border-slate-800/80 hover:scale-110 transition-transform cursor-pointer"
                                >
                                  <Heart
                                    className={`w-3 h-3 transition-all ${
                                      favoriteStoreIds.includes(store.id) ? 'text-red-500 fill-red-500' : 'text-slate-400'
                                    }`}
                                  />
                                </button>
                              </div>

                              {/* Bottom Information (Nome da Loja com fonte aumentada + Tags SEO Local) */}
                              <div className="mt-auto p-2 border-t border-slate-900/40 relative z-10 flex flex-col justify-end bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
                                <h3 className="font-black text-[13px] text-white uppercase tracking-wider truncate" title={store.name}>
                                  {store.name}
                                </h3>
                                <p className="text-[8.5px] text-slate-400 line-clamp-1 leading-none mb-1">{store.description}</p>
                                
                                <div className="flex items-center justify-between text-[8px] font-mono text-slate-500">
                                  <span className="shrink-0 font-bold text-slate-400">📍 {dist.toFixed(1)} KM</span>
                                  <div className="flex items-center gap-1 truncate text-[7px] text-orange-400/90 font-bold max-w-[65%]">
                                    {store.keywords?.slice(0, 3).map((kw: string) => `#${kw}`).join(' ')}
                                  </div>
                                </div>
                              </div>

                              {/* Bottom: Minimalist Buttons without Icons */}
                              <div className="grid grid-cols-2 border-t border-slate-850 relative z-10 bg-slate-950/95 rounded-b-3xl">
                                <button
                                  onClick={() => {
                                    setSelectedStoreForMoments(store);
                                    setShowMomentsModal(true);
                                  }}
                                  className="py-1.5 text-[8.5px] font-mono font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-900 border-r border-slate-850 transition-colors text-center cursor-pointer"
                                >
                                  MOMENTOS
                                </button>
                                <button
                                  onClick={() => setVisitingStore(store)}
                                  className="py-1.5 text-[8.5px] font-mono font-black uppercase tracking-widest text-teal-400 hover:text-teal-300 hover:bg-slate-900 transition-colors text-center cursor-pointer"
                                >
                                  ENTRAR
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {storesWithCoords.filter(store => {
                      if (searchQuery) {
                        const q = searchQuery.toLowerCase();
                        if (!store.name.toLowerCase().includes(q) && !store.description.toLowerCase().includes(q)) return false;
                      }
                      if (userCoords) {
                        const dist = getDistance(userCoords.lat, userCoords.lng, store.lat, store.lng);
                        if (dist > radiusKm) return false;
                      }
                      if (ofertasFilter === 'novas') return store.isNew;
                      if (ofertasFilter === 'favoritas') return favoriteStoreIds.includes(store.id);
                      if (ofertasFilter === 'cliente') return orders.some(o => o.storeId === store.id);
                      return true;
                    }).length === 0 && (
                      <div className="text-center py-12 text-slate-500 text-xs">
                        Nenhuma oferta encontrada com esses filtros. Tente redefinir acima!
                      </div>
                    )}
                  </div>
                )}

                {/* Sub Tab: PRAÇA (Ex-Usuários) */}
                {socialSubTab === 'usuarios' && (
                  <div className="space-y-5 animate-fade-in">
                    
                    {/* Horizontal 3-Filter Selection Bar */}
                    <div className="flex bg-slate-900/80 p-1 rounded-2xl border border-slate-800 gap-1 shadow-lg">
                      <button
                        onClick={() => setPracaFilter('recentes')}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                          pracaFilter === 'recentes'
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Recentes
                      </button>
                      <button
                        onClick={() => setPracaFilter('favoritos')}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                          pracaFilter === 'favoritos'
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Favoritos
                      </button>
                      <button
                        onClick={() => setPracaFilter('conectados')}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer ${
                          pracaFilter === 'conectados'
                            ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Conectados
                      </button>
                    </div>

                    {/* PRACA: RECENTES OR FAVORITOS VIEW */}
                    {(pracaFilter === 'recentes' || pracaFilter === 'favoritos') && (
                      <div className="space-y-4">
                        {/* Status Publish Form (Only on Recentes) */}
                        {pracaFilter === 'recentes' && (
                          <form onSubmit={handlePublishPost} className="bg-slate-900 p-4 rounded-3xl border border-slate-800/80 space-y-3">
                            <textarea
                              value={newPostText}
                              onChange={(e) => setNewPostText(e.target.value)}
                              placeholder="O que está acontecendo no seu negócio ou região?"
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                              rows={2}
                            />
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] text-slate-500 font-mono">Compartilhar com a comunidade local</span>
                              <button
                                type="submit"
                                className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase cursor-pointer"
                              >
                                Postar Status
                              </button>
                            </div>
                          </form>
                        )}

                        {/* Feed Posts */}
                        <div className="space-y-4">
                          {posts
                            .filter(post => {
                              if (pracaFilter === 'favoritos') {
                                if (post.user.includes('Você')) return true;
                                const matchFriend = friends.find(f => f.name === post.user || post.user.includes(f.name));
                                return (matchFriend as any)?.favorited || false;
                              }
                              return true;
                            })
                            .map(post => (
                              <div key={post.id} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                                <div className="flex gap-3 items-center">
                                  <img src={post.avatar} alt={post.user} className="w-9 h-9 object-cover rounded-full" referrerPolicy="no-referrer" />
                                  <div>
                                    <h4 className="text-xs font-bold text-slate-200">{post.user}</h4>
                                    <span className="text-[9px] font-mono text-slate-500">{post.time}</span>
                                  </div>
                                </div>
                                <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-line">{post.content}</p>
                                
                                {post.mediaUrls && post.mediaUrls.length > 0 && (
                                  <div className="py-1">
                                    <MediaCarousel mediaUrls={post.mediaUrls} />
                                  </div>
                                )}
                                
                                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono pt-2.5 border-t border-slate-800/60">
                                  <button 
                                    onClick={() => {
                                      setPosts(curr => curr.map(p => p.id === post.id ? { ...p, likes: p.likes + 1 } : p));
                                      triggerToast('Status curtido!', 'success');
                                    }}
                                    className="hover:text-white flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <ThumbsUp className="w-3.5 h-3.5 text-orange-500" />
                                    <span>{post.likes} curtidas</span>
                                  </button>
                                  <span className="text-[9px] text-orange-400">Kyrub Social Network</span>
                                </div>
                              </div>
                            ))}

                          {posts.filter(post => {
                            if (pracaFilter === 'favoritos') {
                              if (post.user.includes('Você')) return true;
                              const matchFriend = friends.find(f => f.name === post.user || post.user.includes(f.name));
                              return (matchFriend as any)?.favorited || false;
                            }
                            return true;
                          }).length === 0 && (
                            <div className="text-center py-12 text-slate-500 text-xs">
                              Nenhuma publicação encontrada para os filtros selecionados.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* PRACA: CONECTADOS / DIRECTORY VIEW (Tied to isProfileVisible: true) */}
                    {pracaFilter === 'conectados' && (
                      <div className="space-y-6">
                        
                        {/* Seção Superior: Conectados */}
                        <div className="space-y-3">
                          <h4 className="text-[10px] font-mono uppercase text-slate-400 tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                            <span>Meus Contatos Conectados ({friends.filter(f => f.added && (f as any).isProfileVisible !== false).length})</span>
                          </h4>
                          
                          <div className="grid grid-cols-1 gap-3">
                            {friends
                              .filter(f => f.added && (f as any).isProfileVisible !== false)
                              .map(friend => (
                                <div key={friend.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                                  <div className="flex gap-3 items-start">
                                    <img 
                                      src={friend.avatar} 
                                      alt={friend.name} 
                                      className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="space-y-1 min-w-0 flex-1">
                                      <div className="flex justify-between items-start gap-1">
                                        <h4 className="text-xs font-black text-white uppercase truncate">{friend.name}</h4>
                                        <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                          {friend.role}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                                        "{ (friend as any).bio || 'Sem biografia cadastrada no perfil.' }"
                                      </p>
                                    </div>
                                  </div>

                                  {/* 3 Action Buttons */}
                                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-950">
                                    <button
                                      onClick={() => handleToggleFriend(friend.id)}
                                      className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer text-center"
                                    >
                                      Desconectar
                                    </button>

                                    <button
                                      onClick={() => handleToggleFavoriteFriend(friend.id)}
                                      className={`py-1.5 px-2 rounded-xl border transition-all text-center text-[9px] font-black uppercase cursor-pointer ${
                                        (friend as any).favorited
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                          : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300'
                                      }`}
                                    >
                                      {(friend as any).favorited ? '★ Favorito' : '☆ Favoritar'}
                                    </button>

                                    <button
                                      onClick={() => {
                                        setSelectedChatUser(friend);
                                        setShowChatModal(true);
                                      }}
                                      className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-orange-600 text-white hover:bg-orange-500 transition-all text-center cursor-pointer shadow-lg shadow-orange-600/15"
                                    >
                                      💬 Chat
                                    </button>
                                  </div>
                                </div>
                              ))}

                            {friends.filter(f => f.added && (f as any).isProfileVisible !== false).length === 0 && (
                              <div className="text-center py-6 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                                Você ainda não possui contatos ativos na rede. Conecte-se abaixo!
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Seção Inferior: Sistema de Sub-abas */}
                        <div className="space-y-4 pt-2 border-t border-slate-900">
                          {/* Inner Tabs Bar */}
                          <div className="flex border-b border-slate-800/80 gap-4" id="conectados-internal-tabs">
                            <button
                              onClick={() => setConectadosSubTab('sugestoes')}
                              className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                                conectadosSubTab === 'sugestoes'
                                  ? 'border-orange-500 text-white'
                                  : 'border-transparent text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              Sugestões ({getSuggestions().length})
                            </button>
                            <button
                              onClick={() => setConectadosSubTab('solicitacoes')}
                              className={`pb-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                                conectadosSubTab === 'solicitacoes'
                                  ? 'border-orange-500 text-white'
                                  : 'border-transparent text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              Solicitações ({connectionRequests.length})
                            </button>
                          </div>

                          {/* Render Sub-aba 1: Sugestões */}
                          {conectadosSubTab === 'sugestoes' && (
                            <div className="grid grid-cols-1 gap-3 animate-fade-in">
                              {getSuggestions().map(friend => (
                                  <div key={friend.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                                    <div className="flex gap-3 items-start">
                                      <img 
                                        src={friend.avatar} 
                                        alt={friend.name} 
                                        className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                                        referrerPolicy="no-referrer"
                                      />
                                      <div className="space-y-1 min-w-0 flex-1">
                                        <div className="flex justify-between items-start gap-1">
                                          <h4 className="text-xs font-black text-white uppercase truncate">{friend.name}</h4>
                                          <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                            {friend.role}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                                          "{ (friend as any).bio || 'Sem biografia cadastrada no perfil.' }"
                                        </p>
                                      </div>
                                    </div>

                                    {/* 3 Action Buttons */}
                                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-950">
                                      <button
                                        onClick={() => handleToggleFriend(friend.id)}
                                        className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-teal-500 text-slate-950 hover:bg-teal-400 transition-all text-center cursor-pointer"
                                      >
                                        Conectar
                                      </button>

                                      <button
                                        onClick={() => handleToggleFavoriteFriend(friend.id)}
                                        className={`py-1.5 px-2 rounded-xl border transition-all text-center text-[9px] font-black uppercase cursor-pointer ${
                                          (friend as any).favorited
                                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                            : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-300'
                                        }`}
                                      >
                                        {(friend as any).favorited ? '★ Favorito' : '☆ Favoritar'}
                                      </button>

                                      <button
                                        disabled
                                        className="py-1.5 px-2 rounded-xl text-[9px] font-black uppercase bg-slate-950 border border-slate-850 text-slate-600 text-center cursor-not-allowed opacity-50"
                                        title="Conecte-se primeiro para liberar o chat privado"
                                      >
                                        🚫 Chat
                                      </button>
                                    </div>
                                  </div>
                                ))}

                              {friends.filter(f => !f.added && (f as any).isProfileVisible !== false).length === 0 && (
                                <div className="text-center py-6 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                                  Nenhuma sugestão pública disponível no momento.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Render Sub-aba 2: Solicitações */}
                          {conectadosSubTab === 'solicitacoes' && (
                            <div className="grid grid-cols-1 gap-3 animate-fade-in">
                              {connectionRequests.map(req => (
                                <div key={req.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all">
                                  <div className="flex gap-3 items-start">
                                    <img 
                                      src={req.avatar} 
                                      alt={req.name} 
                                      className="w-12 h-12 rounded-full object-cover border border-slate-800 shrink-0" 
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="space-y-1 min-w-0 flex-1">
                                      <div className="flex justify-between items-start gap-1">
                                        <h4 className="text-xs font-black text-white uppercase truncate">{req.name}</h4>
                                        <span className="text-[8px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 font-mono uppercase shrink-0">
                                          {req.role}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed italic">
                                        "{ req.bio || 'Sem biografia cadastrada no perfil.' }"
                                      </p>
                                    </div>
                                  </div>

                                  {/* Approve / Refuse Buttons */}
                                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-950">
                                    <button
                                      onClick={() => handleAcceptRequest(req)}
                                      className="py-2 px-3 rounded-xl text-[10px] font-black uppercase bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-center cursor-pointer shadow-lg shadow-emerald-600/10"
                                    >
                                      ✓ Aceitar Conexão
                                    </button>
                                    <button
                                      onClick={() => handleDeclineRequest(req.id, req.name)}
                                      className="py-2 px-3 rounded-xl text-[10px] font-black uppercase bg-slate-950 border border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-white transition-all text-center cursor-pointer"
                                    >
                                      ✕ Recusar
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {connectionRequests.length === 0 && (
                                <div className="text-center py-8 bg-slate-900/40 rounded-2xl border border-slate-900/60 text-slate-500 text-xs italic">
                                  Nenhuma solicitação de conexão pendente.
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                      </div>
                    )}

                  </div>
                )}
              </div>
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
            
            {/* LADO ESQUERDO: Botão de fechar */}
            {!isAdminSubdomain && (
              <button
                onClick={() => setIsGestaoOpen(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-850 w-8 h-8 rounded-full flex items-center justify-center text-sm cursor-pointer shadow-sm shrink-0"
              >
                ✕
              </button>
            )}

            {/* CENTRO/DIREITA: Itens de navegação unificados e roláveis horizontalmente */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {gestaoRole === 'retailer' ? (
                <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none flex-1 px-2" id="erp-tab-navigation-header">
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
      {isWalletOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-teal-400" />
                  <h3 className="text-lg font-black text-white uppercase tracking-wider">Conta Digital Kyrub</h3>
                </div>
                <button 
                  onClick={() => setIsWalletOpen(false)}
                  className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Digital Balance */}
              <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 text-center space-y-2 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/5 rounded-full blur-2xl" />
                <span className="text-[9px] font-mono text-slate-500 uppercase block">Saldo Disponível (Simulado)</span>
                <p className="text-3xl font-black text-teal-400 font-mono">R$ {walletBalance.toFixed(2)}</p>
                <div className="text-[10px] text-slate-400 font-mono bg-slate-900/60 py-1.5 rounded-lg border border-slate-900">
                  Agência: <strong className="text-slate-200">0001</strong> | Conta: <strong className="text-slate-200">99042-9</strong>
                </div>
              </div>

              {/* Simulate Pix / Transfer */}
              <div className="space-y-3.5">
                <span className="text-[10px] font-mono uppercase text-slate-500 block">Enviar Transferência PIX</span>
                <form onSubmit={handleSimulatePix} className="space-y-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-800/60">
                  <input
                    type="text"
                    placeholder="Chave PIX (Email, CPF ou Telefone)"
                    value={pixTargetKey}
                    onChange={(e) => setPixTargetKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Valor R$ (ex: 50.00)"
                    value={pixAmount}
                    onChange={(e) => setPixAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    className="w-full py-2 bg-teal-500 text-slate-950 font-bold rounded-xl text-xs uppercase"
                  >
                    Confirmar Envio PIX
                  </button>
                </form>

                <span className="text-[10px] font-mono uppercase text-slate-500 block">Simular Depósito Bancário</span>
                <form onSubmit={handleSimulateDeposit} className="space-y-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-800/60">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Valor R$ do depósito"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs uppercase"
                  >
                    Gerar Boleto / PIX Depósito
                  </button>
                </form>
              </div>

              {/* Transaction History ledger */}
              <div className="space-y-3">
                <span className="text-[10px] font-mono uppercase text-slate-500 block">Extrato Recente (BaaS Split Audit)</span>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {walletHistory.map(hist => (
                    <div key={hist.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                      <div>
                        <span className="text-slate-300 font-bold block">{hist.desc}</span>
                        <span className="text-[9px] text-slate-500">{hist.date} • {hist.type}</span>
                      </div>
                      <strong className={`font-mono font-black ${hist.val > 0 ? 'text-teal-400' : 'text-red-400'}`}>
                        {hist.val > 0 ? '+' : ''}R$ {hist.val.toFixed(2)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
      {newProductModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-teal-400" />
                <span>Cadastrar Novo Item no Kyrub</span>
              </h3>
              <button 
                onClick={() => setNewProductModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Nome do Item</label>
                  <input 
                    type="text" 
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    placeholder="ex: Smart Watch G2"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-teal-500" 
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Preço de Venda (B2C)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={newProdPrice}
                    onChange={(e) => setNewProdPrice(e.target.value)}
                    placeholder="R$ 150.00"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none" 
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Categoria</label>
                  <select 
                    value={newProdCategory}
                    onChange={(e) => setNewProdCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                  >
                    <option value="Eletrônicos">Eletrônicos</option>
                    <option value="Moda">Moda</option>
                    <option value="Serviços">Serviços</option>
                    <option value="Alimentação">Alimentação</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Estoque Inicial</label>
                  <input 
                    type="number" 
                    value={newProdStock}
                    onChange={(e) => setNewProdStock(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Descrição Curta</label>
                <textarea 
                  value={newProdDesc}
                  onChange={(e) => setNewProdDesc(e.target.value)}
                  rows={2}
                  placeholder="Descreva detalhes ou termos do produto/serviço..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none" 
                />
              </div>

              <div className="flex items-center gap-2.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <input 
                  type="checkbox" 
                  id="isService" 
                  checked={newProdIsService}
                  onChange={(e) => setNewProdIsService(e.target.checked)}
                  className="accent-teal-500" 
                />
                <label htmlFor="isService" className="text-xs text-slate-300 cursor-pointer">Este item é um Serviço (agendável/digital)</label>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setNewProductModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  Confirmar Cadastro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. SLIDEOVER CARRINHO DE COMPRAS B2C */}
      {isCartOpen && visitingStore && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 flex flex-col justify-between overflow-y-auto">
            
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" style={{ color: visitingStore.primaryColor }} />
                  <span>Seu Carrinho</span>
                </h3>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="text-slate-500 hover:text-slate-300 font-bold text-sm"
                >
                  Fechar ✕
                </button>
              </div>

              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                {cart.map(item => (
                  <div key={item.product.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800/60 flex gap-3">
                    <img src={item.product.image} alt={item.product.name} className="w-12 h-12 object-cover rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <h4 className="font-bold text-xs text-slate-200 truncate">{item.product.name}</h4>
                      <p className="font-mono text-xs text-white">R$ {item.product.price.toFixed(2)}</p>
                      
                      <div className="flex items-center gap-2 pt-1">
                        <button 
                          onClick={() => updateCartQty(item.product.id, item.quantity - 1)}
                          className="bg-slate-900 text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-xs"
                        >
                          -
                        </button>
                        <span className="text-xs font-bold text-slate-300 font-mono">{item.quantity}</span>
                        <button 
                          onClick={() => updateCartQty(item.product.id, item.quantity + 1)}
                          className="bg-slate-900 text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {cart.length === 0 && (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    Seu carrinho está vazio. Adicione produtos na vitrine.
                  </div>
                )}
              </div>
            </div>

            {/* Checkout Form */}
            {cart.length > 0 && (
              <form onSubmit={checkoutCart} className="border-t border-slate-800/80 pt-6 space-y-4">
                <div className="space-y-2.5">
                  <h4 className="text-xs font-mono uppercase text-slate-400">Dados do Destinatário</h4>
                  
                  <input 
                    type="text" 
                    placeholder="Seu Nome Completo" 
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                    required
                  />

                  <input 
                    type="email" 
                    placeholder="Seu Email" 
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                    required
                  />

                  <input 
                    type="text" 
                    placeholder="Endereço de Entrega" 
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                  />
                </div>

                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Subtotal:</span>
                    <span className="font-mono text-slate-200">R$ {cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Frete Simulador:</span>
                    <span className="text-emerald-400 uppercase font-mono text-[10px] font-bold">Grátis</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white border-t border-slate-900 pt-2">
                    <span>Total Compra:</span>
                    <span className="font-mono" style={{ color: visitingStore.primaryColor }}>
                      R$ {cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full text-white font-black py-3 rounded-xl text-xs transition-all shadow-md uppercase tracking-wider cursor-pointer"
                  style={{ backgroundColor: visitingStore.primaryColor }}
                >
                  Confirmar Pedido B2C
                </button>
              </form>
            )}

          </div>
        </div>
      )}

      {/* 9. ONBOARDING GPS OVERLAY MODAL */}
      {showGpsOverlay && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm space-y-5 text-center shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl" />
            <div className="w-12 h-12 bg-orange-950 border border-orange-900/60 text-orange-400 rounded-2xl flex items-center justify-center mx-auto">
              <MapPin className="w-6 h-6" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-base font-black text-white uppercase tracking-wider">Acesso ao GPS Necessário</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Kyrub deseja acessar sua localização por GPS para encontrar lojistas, entregadores e amigos próximos por proximidade geográfica.
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => handleGpsPermission(true)}
                className="w-full py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-xl text-xs transition-all uppercase tracking-widest"
              >
                Permitir Acesso ao GPS
              </button>
              <button
                onClick={() => handleGpsPermission(false)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl text-xs transition-all uppercase"
              >
                Recusar e Continuar
              </button>
            </div>
          </div>
        </div>
      )}

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
      {showDeliveryModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-solicitar-entrega">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-orange-500" />
                <span>Logística & Entregas Kyrub</span>
              </h3>
              <button 
                onClick={() => setShowDeliveryModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Abas */}
            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button
                type="button"
                onClick={() => setDeliveryModalTab('solicitar')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  deliveryModalTab === 'solicitar' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Solicitar
              </button>
              <button
                type="button"
                onClick={() => setDeliveryModalTab('publicados')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  deliveryModalTab === 'publicados' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Publicados
              </button>
              <button
                type="button"
                onClick={() => setDeliveryModalTab('historico')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  deliveryModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Histórico
              </button>
            </div>

            {/* Conteúdo Aba Solicitar */}
            {deliveryModalTab === 'solicitar' && (
              <form onSubmit={handleCreateDelivery} className="space-y-4 text-xs">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Descrição da Encomenda</label>
                    <input 
                      type="text" 
                      value={deliveryParcelDesc}
                      onChange={(e) => setDeliveryParcelDesc(e.target.value)}
                      placeholder="ex: Vestido Classic, Embalagem de Presente"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Ponto de Coleta (Origem)</label>
                    <input 
                      type="text" 
                      value={deliveryPickupPoint}
                      onChange={(e) => setDeliveryPickupPoint(e.target.value)}
                      placeholder="ex: Bella Boutique (Rua Augusta 450)"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Ponto de Entrega (Destino)</label>
                    <input 
                      type="text" 
                      value={deliveryDeliveryPoint}
                      onChange={(e) => setDeliveryDeliveryPoint(e.target.value)}
                      placeholder="ex: Av. Paulista 1000, Apto 42"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Incentivo Adicional (R$)</label>
                    <input 
                      type="number" 
                      value={deliveryIncentive}
                      onChange={(e) => setDeliveryIncentive(e.target.value)}
                      placeholder="Opcional. ex: 5.00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" 
                    />
                  </div>

                  {/* Detalhes de Preço Real-time */}
                  <div className="bg-slate-950 border border-slate-850 p-3 rounded-2xl space-y-2 font-mono text-[10px]">
                    <span className="text-[9px] font-bold text-slate-500 uppercase block border-b border-slate-900 pb-1">Cálculo de Frete (União de Entregadores)</span>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Distância Estimada:</span>
                      <span className="text-white font-bold">{deliveryDistance} KM</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Taxa Mínima Base:</span>
                      <span className="text-white">R$ 10.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Taxa por Distância (R$ 2.00/KM):</span>
                      <span className="text-white">R$ {(deliveryDistance * 2.00).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Incentivo Adicional:</span>
                      <span className="text-orange-400">R$ {(parseFloat(deliveryIncentive) || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-900 pt-1.5 text-xs font-black">
                      <span className="text-slate-300 uppercase">Valor Total do Frete:</span>
                      <span className="text-orange-500">R$ {(10.00 + (deliveryDistance * 2) + (parseFloat(deliveryIncentive) || 0)).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setShowDeliveryModal(false)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Publicar Entrega
                  </button>
                </div>
              </form>
            )}

            {/* Conteúdo Aba Publicados */}
            {deliveryModalTab === 'publicados' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status !== 'done').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                    Nenhuma entrega publicada ativa no momento.
                  </div>
                ) : (
                  deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status !== 'done').map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                            ID: {job.id}
                          </span>
                          <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.to}</h4>
                          <p className="text-[10px] text-slate-400 pt-1 font-mono">Retirada: {job.from}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-orange-500 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] text-slate-500 font-mono">{job.distance} KM</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                        <div className="text-[9px] font-mono">
                          {job.status === 'available' && (
                            <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-bold">
                              Aguardando Entregador
                            </span>
                          )}
                          {job.status === 'accepted' && (
                            <span className="text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold">
                              Aceita por {job.acceptedBy || 'Entregador'}
                            </span>
                          )}
                          {job.status === 'delivering' && (
                            <span className="text-sky-400 bg-sky-400/5 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">
                              Em Trajeto ({job.acceptedBy})
                            </span>
                          )}
                        </div>

                        {job.status === 'available' ? (
                          <button
                            onClick={() => handleDeleteDeliveryJob(job.id)}
                            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[9px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                          >
                            Cancelar
                          </button>
                        ) : (
                          <span className="text-[9px] text-slate-500 font-mono">Não Cancelável</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Conteúdo Aba Histórico */}
            {deliveryModalTab === 'historico' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status === 'done').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                    Nenhuma entrega concluída no seu histórico.
                  </div>
                ) : (
                  deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status === 'done').map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                            ID: {job.id}
                          </span>
                          <h4 className="text-xs font-black text-slate-300 uppercase truncate mt-1">{job.to}</h4>
                          <p className="text-[10px] text-slate-500 pt-1 font-mono">Retirada: {job.from}</p>
                          {job.acceptedBy && (
                            <p className="text-[9px] text-slate-400 pt-1 font-mono">Entregue por: {job.acceptedBy}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-bold inline-block">
                            Concluída
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL SOLICITAR FREELA */}
      {showFreelaModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-solicitar-freela">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-teal-400" />
                <span>Gestão de Freelas Kyrub</span>
              </h3>
              <button 
                onClick={() => {
                  setShowFreelaModal(false);
                  setEditingFreelaId(null);
                }}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            {/* Abas */}
            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button
                type="button"
                onClick={() => setFreelaModalTab('solicitar')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'solicitar' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Solicitar Serviço
              </button>
              <button
                type="button"
                onClick={() => setFreelaModalTab('publicados')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'publicados' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Publicados
              </button>
              <button
                type="button"
                onClick={() => setFreelaModalTab('historico')}
                className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                  freelaModalTab === 'historico' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                }`}
              >
                Histórico
              </button>
            </div>

            {/* Conteúdo da Aba Solicitar */}
            {freelaModalTab === 'solicitar' && (
              <form onSubmit={handleCreateFreela} className="space-y-4 text-xs">
                {editingFreelaId && (
                  <div className="p-3 bg-teal-500/10 border border-teal-500/20 rounded-xl text-teal-400 text-[10px] flex justify-between items-center">
                    <span>Modo Edição Ativo (ID: {editingFreelaId})</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setEditingFreelaId(null);
                        setFreelaTitle('');
                        setFreelaDesc('');
                        setFreelaRequirements('');
                        setFreelaPayment('');
                      }}
                      className="text-xs hover:underline uppercase font-bold"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Título do Serviço</label>
                    <input 
                      type="text" 
                      value={freelaTitle}
                      onChange={(e) => setFreelaTitle(e.target.value)}
                      placeholder="ex: Fotógrafo Auxiliar ou Repositor"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Descrição do Freela</label>
                    <textarea 
                      value={freelaDesc}
                      onChange={(e) => setFreelaDesc(e.target.value)}
                      placeholder="Descreva o que o freelancer precisa fazer..."
                      rows={2}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Requisitos Básicos</label>
                    <input 
                      type="text" 
                      value={freelaRequirements}
                      onChange={(e) => setFreelaRequirements(e.target.value)}
                      placeholder="ex: Trazer câmera própria ou ter experiência"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Pagamento Oferecido (R$)</label>
                    <input 
                      type="number" 
                      value={freelaPayment}
                      onChange={(e) => setFreelaPayment(e.target.value)}
                      placeholder="ex: 150.00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500" 
                      required
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFreelaModal(false);
                      setEditingFreelaId(null);
                    }}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider"
                  >
                    {editingFreelaId ? 'Atualizar Freela' : 'Publicar Freela'}
                  </button>
                </div>
              </form>
            )}

            {/* Conteúdo da Aba Publicados */}
            {freelaModalTab === 'publicados' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {freelanceJobs.filter(job => 
                  (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status !== 'done'
                ).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    Nenhum freela publicado ativo encontrado.
                  </div>
                ) : (
                  freelanceJobs.filter(job => 
                    (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status !== 'done'
                  ).map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <h4 className="text-xs font-black text-white uppercase">{job.title}</h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-slate-900 border border-slate-800 text-slate-400 rounded font-mono uppercase font-semibold inline-block">
                            {job.status === 'open' ? 'Aberto' : 'Candidatura'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2.5 pt-2 border-t border-slate-900/80">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFreelaId(job.id);
                            setFreelaTitle(job.title);
                            setFreelaDesc(job.description);
                            setFreelaRequirements('');
                            setFreelaPayment(job.payment.toString());
                            setFreelaModalTab('solicitar');
                          }}
                          className="flex-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFreelanceJob(job.id)}
                          className="flex-1 bg-red-950/40 hover:bg-red-900/45 border border-red-900/50 text-red-400 font-bold py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-all"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Conteúdo da Aba Histórico */}
            {freelaModalTab === 'historico' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {freelanceJobs.filter(job => 
                  (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status === 'done'
                ).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic">
                    Nenhum histórico de freela finalizado encontrado.
                  </div>
                ) : (
                  freelanceJobs.filter(job => 
                    (job.employer === (profileName || 'Você') || job.employer === 'Você') && job.status === 'done'
                  ).map(job => (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <h4 className="text-xs font-black text-slate-300 uppercase">{job.title}</h4>
                          <p className="text-[11px] text-slate-500 leading-relaxed pt-1">{job.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                          <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-black inline-block">
                            Concluído
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL NOTAS COMPARTILHADAS COMIGO */}
      {showSharedNotesModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-notas-compartilhadas">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-400" />
                <span>Notas Compartilhadas Comigo</span>
              </h3>
              <button 
                onClick={() => setShowSharedNotesModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {notes.filter(note => note.auditLogs[note.auditLogs.length - 1]?.user !== 'Você').length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs italic">
                  Nenhuma nota compartilhada com você no momento.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {notes.filter(note => note.auditLogs[note.auditLogs.length - 1]?.user !== 'Você').map(note => {
                    const creator = note.auditLogs[note.auditLogs.length - 1]?.user || 'Outro Usuário';
                    return (
                      <div key={note.id} className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-mono text-orange-400 uppercase font-bold">Criada por: {creator}</span>
                            <h4 className="text-sm font-black text-white uppercase mt-0.5">{note.title}</h4>
                          </div>
                          <span className="text-[9px] bg-slate-900 px-2 py-0.5 rounded text-slate-400 border border-slate-800 font-mono">
                            ID: {note.id}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed">{note.content}</p>

                        {note.checklist.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-slate-900">
                            <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist Compartilhado</span>
                            <div className="space-y-1.5">
                              {note.checklist.map(item => (
                                <label key={item.id} className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={item.done}
                                    onChange={() => handleToggleChecklistItem(note.id, item.id)}
                                    className="mt-0.5 accent-teal-500"
                                  />
                                  <span className={item.done ? 'line-through text-slate-500' : ''}>{item.text}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 pt-2 border-t border-slate-900">
                          <span className="truncate max-w-[70%]">Membros: {note.associatedUsers.join(', ')}</span>
                          <span>Auditada: {note.auditLogs[0]?.timestamp.split(', ')[1] || 'Recente'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowSharedNotesModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BUSCA DE COLABORADORES */}
      {showUserSearchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-busca-colaboradores">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-400" />
                <span>Buscar Colaboradores</span>
              </h3>
              <button 
                onClick={() => {
                  setShowUserSearchModal(false);
                  setUserSearchEmail('');
                }}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1.5">Digite o e-mail ou nome do usuário:</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="ex: pedro.eletronicos@kyrub.com ou Maria"
                    value={userSearchEmail}
                    onChange={(e) => setUserSearchEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500"
                    autoFocus
                  />
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                </div>
              </div>

              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                <span className="text-[9px] font-mono uppercase text-slate-500 block">Resultados em tempo real</span>
                
                {appUsers.filter(u => 
                  u.email.toLowerCase().includes(userSearchEmail.toLowerCase()) || 
                  u.name.toLowerCase().includes(userSearchEmail.toLowerCase())
                ).length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-xs italic">
                    Nenhum usuário correspondente encontrado.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {appUsers.filter(u => 
                      u.email.toLowerCase().includes(userSearchEmail.toLowerCase()) || 
                      u.name.toLowerCase().includes(userSearchEmail.toLowerCase())
                    ).map(user => {
                      const isAlreadyAdded = selectedFriendsForNote.includes(user.name);
                      return (
                        <div key={user.id} className="bg-slate-950 border border-slate-850 p-3 rounded-xl flex items-center justify-between gap-3 hover:border-slate-800 transition-colors">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full object-cover border border-slate-800 shrink-0" referrerPolicy="no-referrer" />
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-white truncate">{user.name}</h4>
                              <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                              <span className="text-[8px] px-1.5 py-0.2 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">{user.role}</span>
                            </div>
                          </div>
                          
                          <button
                            type="button"
                            onClick={() => {
                              if (!isAlreadyAdded) {
                                setSelectedFriendsForNote(prev => [...prev, user.name]);
                                triggerToast(`${user.name} adicionado!`, 'success');
                              } else {
                                setSelectedFriendsForNote(prev => prev.filter(n => n !== user.name));
                                triggerToast(`${user.name} removido!`, 'info');
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all shrink-0 cursor-pointer ${
                              isAlreadyAdded 
                                ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25' 
                                : 'bg-teal-500 text-slate-950 hover:bg-teal-400'
                            }`}
                          >
                            {isAlreadyAdded ? 'Remover' : '+ Adicionar'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowUserSearchModal(false);
                  setUserSearchEmail('');
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer"
              >
                Concluir Seleção
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FAZER ENTREGAS */}
      {showFazerEntregasModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-fazer-entregas">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-orange-500" />
                <span>Painel de Entregas Kyrub</span>
              </h3>
              <button 
                onClick={() => setShowFazerEntregasModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Trabalhe como entregador autônomo no ecossistema local. Aceite ofertas de frete de lojistas próximos, colete e entregue os pacotes para receber o saldo instantaneamente.
              </p>

              {/* Abas do Entregador */}
              <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
                <button
                  type="button"
                  onClick={() => setFazerEntregasModalTab('solicitacoes')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerEntregasModalTab === 'solicitacoes' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Solicitações
                </button>
                <button
                  type="button"
                  onClick={() => setFazerEntregasModalTab('trajeto')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerEntregasModalTab === 'trajeto' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Em Trajeto
                </button>
                <button
                  type="button"
                  onClick={() => setFazerEntregasModalTab('historico')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerEntregasModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Histórico
                </button>
              </div>

              {/* Conteúdo Aba Solicitações */}
              {fazerEntregasModalTab === 'solicitacoes' && (
                <div className="space-y-3">
                  {deliveries.filter(d => d.status === 'available' && d.requestedBy !== (profileName || 'Usuário')).length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Nenhuma oferta de entrega disponível no momento.
                    </div>
                  ) : (
                    deliveries.filter(d => d.status === 'available' && d.requestedBy !== (profileName || 'Usuário')).map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 min-w-0">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              ID: {job.id}
                            </span>
                            <div className="text-xs text-slate-300 font-bold mt-1">
                              De: <span className="text-white">{job.from}</span>
                            </div>
                            <div className="text-xs text-slate-300">
                              Para: <span className="text-slate-400">{job.to}</span>
                            </div>
                            {job.requestedBy && (
                              <p className="text-[9px] text-slate-500 pt-1 font-mono">Solicitante: {job.requestedBy}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-orange-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{job.distance} KM</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                          <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold">
                            Disponível
                          </span>
                          <button
                            onClick={() => handleAcceptDelivery(job.id)}
                            className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                          >
                            Aceitar Entrega
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Conteúdo Aba Em Trajeto */}
              {fazerEntregasModalTab === 'trajeto' && (
                <div className="space-y-3">
                  {deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && d.acceptedBy === (profileName || 'Você')).length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Você não possui entregas em andamento.
                    </div>
                  ) : (
                    deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && d.acceptedBy === (profileName || 'Você')).map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 min-w-0">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              ID: {job.id}
                            </span>
                            <div className="text-xs text-slate-300 font-bold mt-1">
                              De: <span className="text-white">{job.from}</span>
                            </div>
                            <div className="text-xs text-slate-300">
                              Para: <span className="text-slate-400">{job.to}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-orange-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{job.distance} KM</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                          <div className="text-[9px] font-mono">
                            {job.status === 'accepted' ? (
                              <span className="text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold">
                                Coleta Pendente
                              </span>
                            ) : (
                              <span className="text-sky-400 bg-sky-400/5 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">
                                A caminho do destino
                              </span>
                            )}
                          </div>

                          <div>
                            {job.status === 'accepted' ? (
                              <button
                                onClick={() => handleAdvanceDelivery(job.id, 'delivering')}
                                className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                              >
                                Coletar Pacote
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAdvanceDelivery(job.id, 'done')}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                              >
                                Concluir Entrega
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Conteúdo Aba Histórico */}
              {fazerEntregasModalTab === 'historico' && (
                <div className="space-y-3">
                  {deliveries.filter(d => d.status === 'done' && d.acceptedBy === (profileName || 'Você')).length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Você ainda não concluiu nenhuma entrega.
                    </div>
                  ) : (
                    deliveries.filter(d => d.status === 'done' && d.acceptedBy === (profileName || 'Você')).map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              ID: {job.id}
                            </span>
                            <h4 className="text-xs font-black text-slate-300 uppercase truncate mt-1">{job.to}</h4>
                            <p className="text-[10px] text-slate-500 pt-1 font-mono font-semibold">Retirada: {job.from}</p>
                            {job.requestedBy && (
                              <p className="text-[9px] text-slate-400 pt-1 font-mono">Solicitante: {job.requestedBy}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-bold inline-block">
                              Paga & Concluída
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowFazerEntregasModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] transition-all uppercase tracking-wider cursor-pointer"
              >
                Voltar ao Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FAZER FREELAS */}
      {showFazerFreelasModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-fazer-freelas">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-teal-400" />
                <span>Painel Freelancer Kyrub</span>
              </h3>
              <button 
                onClick={() => setShowFazerFreelasModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Trabalhe de forma independente prestando serviços sob demanda para as lojas parceiras. Acompanhe suas candidaturas e execute as tarefas aceitas.
              </p>

              {/* Abas */}
              <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
                <button
                  type="button"
                  onClick={() => setFazerFreelasModalTab('solicitacoes')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerFreelasModalTab === 'solicitacoes' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Solicitações
                </button>
                <button
                  type="button"
                  onClick={() => setFazerFreelasModalTab('fazendo')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerFreelasModalTab === 'fazendo' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Fazendo
                </button>
                <button
                  type="button"
                  onClick={() => setFazerFreelasModalTab('historico')}
                  className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${
                    fazerFreelasModalTab === 'historico' ? 'border-teal-400 text-teal-400' : 'border-transparent text-slate-500 hover:text-slate-400'
                  }`}
                >
                  Histórico
                </button>
              </div>

              {/* Aba Solicitações */}
              {fazerFreelasModalTab === 'solicitacoes' && (
                <div className="space-y-3">
                  {freelanceJobs.filter(job => job.status === 'open').length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Nenhuma vaga freelancer aberta disponível no momento.
                    </div>
                  ) : (
                    freelanceJobs.filter(job => job.status === 'open').map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 min-w-0 text-xs">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              Contratante: {job.employer}
                            </span>
                            <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.title}</h4>
                            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[9px] text-slate-500 font-mono">{job.distance} KM</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                          <span className="text-[9px] text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold font-mono uppercase">
                            Aberta
                          </span>
                          <button
                            onClick={() => handleApplyFreelance(job.id)}
                            className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                          >
                            Candidatar-se
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Aba Fazendo */}
              {fazerFreelasModalTab === 'fazendo' && (
                <div className="space-y-3">
                  {freelanceJobs.filter(job => job.status === 'applied').length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Nenhum freela aceito em andamento no momento.
                    </div>
                  ) : (
                    freelanceJobs.filter(job => job.status === 'applied').map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 min-w-0 text-xs">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              Contratante: {job.employer}
                            </span>
                            <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.title}</h4>
                            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{job.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-teal-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[9px] text-slate-500 font-mono">{job.distance} KM</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                          <span className="text-[9px] text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-bold font-mono uppercase">
                            Em Andamento
                          </span>
                          <button
                            onClick={() => handleSimulateGigDone(job.id)}
                            className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono"
                          >
                            Concluir Trabalho
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Aba Histórico */}
              {fazerFreelasModalTab === 'historico' && (
                <div className="space-y-3">
                  {freelanceJobs.filter(job => job.status === 'done').length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">
                      Você não possui histórico de freelas concluídos.
                    </div>
                  ) : (
                    freelanceJobs.filter(job => job.status === 'done').map(job => (
                      <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2 text-xs">
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1 min-w-0">
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">
                              Contratante: {job.employer}
                            </span>
                            <h4 className="text-xs font-black text-slate-300 mt-1.5 truncate">{job.title}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">{job.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-bold text-slate-400 font-mono block">R$ {job.payment.toFixed(2)}</span>
                            <span className="text-[9px] px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full font-bold font-mono uppercase inline-block mt-1">
                              Pago
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowFazerFreelasModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] transition-all uppercase tracking-wider cursor-pointer"
              >
                Voltar ao Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MEU PERFIL E SEGURANÇA */}
      {showUserProfileModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="modal-user-profile">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto animate-scale-up text-xs">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-teal-400" />
                <span>Meu Perfil e Segurança</span>
              </h3>
              <button 
                onClick={() => setShowUserProfileModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* BLOC 1: Identidade */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img 
                    src={profilePhotoUrl || undefined} 
                    alt={profileName} 
                    className="w-16 h-16 rounded-full object-cover border-2 border-teal-500/80" 
                  />
                  <div className="absolute -bottom-1 -right-1 bg-teal-500 text-slate-950 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">
                    G
                  </div>
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-black text-white uppercase">{profileName}</h4>
                  <p className="text-slate-400 text-[10px] font-mono">{profileEmail}</p>
                  <span className="text-[8px] bg-teal-400/10 border border-teal-400/20 text-teal-400 font-bold font-mono px-2 py-0.5 rounded uppercase">
                    Autenticado via Google
                  </span>
                </div>
              </div>

              {/* Account tags selection/visuals */}
              <div className="space-y-1.5 pt-2 border-t border-slate-900">
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Tipos de Conta Ativos</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountTypeCliente(!accountTypeCliente)}
                    className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                      accountTypeCliente 
                        ? 'bg-orange-500 text-slate-950 text-[10px]' 
                        : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                    }`}
                  >
                    Cliente
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountTypeEntregador(!accountTypeEntregador)}
                    className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                      accountTypeEntregador 
                        ? 'bg-teal-500 text-slate-950 text-[10px]' 
                        : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                    }`}
                  >
                    Entregador
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountTypeLojista(!accountTypeLojista)}
                    className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                      accountTypeLojista 
                        ? 'bg-indigo-500 text-white text-[10px]' 
                        : 'bg-slate-900 border border-slate-800 text-slate-500 text-[10px]'
                    }`}
                  >
                    Lojista
                  </button>
                </div>
              </div>

              {/* Privacy Setting Toggle */}
              <div className="space-y-1.5 pt-2.5 border-t border-slate-900 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-300 uppercase font-mono block">Tornar meu perfil visível na Praça</span>
                  <p className="text-[9px] text-slate-500">Permite que outros usuários se conectem e enviem mensagens.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProfileVisible(!isProfileVisible)}
                  className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isProfileVisible ? 'bg-orange-500' : 'bg-slate-800'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                      isProfileVisible ? 'translate-x-4.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* BLOC 2: Dados Cadastrais */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
              <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-orange-400">
                <span>Dados Cadastrais</span>
              </h4>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono uppercase">Endereço de Atuação/Faturamento</label>
                  <input
                    type="text"
                    value={profileAddress}
                    onChange={(e) => setProfileAddress(e.target.value)}
                    placeholder="Rua, Número, Bairro, Cidade - UF"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 font-mono uppercase">WhatsApp</label>
                  <input
                    type="text"
                    value={profileWhatsApp}
                    onChange={(e) => setProfileWhatsApp(formatWhatsApp(e.target.value))}
                    placeholder="(11) 99999-9999"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* BLOC 3: Segurança Financeira */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
              <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-teal-400">
                <span>Segurança Financeira (BaaS Guard)</span>
              </h4>
              <div className="flex items-center justify-between bg-slate-900/50 p-2.5 rounded-xl border border-slate-900">
                <div>
                  <span className="font-bold text-slate-200 block">Biometria Nativa Local</span>
                  <p className="text-[9px] text-slate-500">Exigir autenticação biométrica do dispositivo antes de confirmar splits e transações.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setBiometricsActive(!biometricsActive)}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
                    biometricsActive ? 'bg-teal-500' : 'bg-slate-800'
                  }`}
                >
                  <span className={`w-4 h-4 bg-slate-950 rounded-full shadow-md transform transition-transform ${
                    biometricsActive ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono uppercase flex items-center gap-1">
                  <span>PIN Transacional BaaS (4 dígitos)</span>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={transactionPin}
                    onChange={(e) => setTransactionPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="••••"
                    maxLength={4}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-white font-mono tracking-[0.5em] focus:outline-none focus:border-teal-500"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔒</span>
                </div>
                <p className="text-[9px] text-slate-500 font-mono">Senha segura criptografada e armazenada localmente com assinatura hash no Firestore.</p>
              </div>
            </div>

            {/* BLOC 4: Onboarding de Documentos / KYC */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                <h4 className="font-black text-white uppercase tracking-wider text-[11px] text-indigo-400">
                  <span>Onboarding de Documentos &amp; KYC</span>
                </h4>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] uppercase font-mono text-slate-500 font-bold">Status:</span>
                  <span className={`text-[9px] font-black font-mono uppercase px-2 py-0.5 rounded-full ${
                    kycStatus === 'Verificado' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : kycStatus === 'Em Análise' 
                      ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400 animate-pulse' 
                      : 'bg-slate-900 border border-slate-800 text-slate-500'
                  }`}>
                    {kycStatus}
                  </span>
                </div>
              </div>

              {/* Onboarding Selector */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono uppercase block">Tipo de Perfil Profissional para Validação</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setKycDocType('bike'); setKycStatus('Pendente'); }}
                    className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                      kycDocType === 'bike' 
                        ? 'bg-indigo-600 border-indigo-500 text-white' 
                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Entregador Bike
                  </button>
                  <button
                    type="button"
                    onClick={() => { setKycDocType('motorized'); setKycStatus('Pendente'); }}
                    className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                      kycDocType === 'motorized' 
                        ? 'bg-indigo-600 border-indigo-500 text-white' 
                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Motorizado (CNH)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setKycDocType('lojista'); setKycStatus('Pendente'); }}
                    className={`py-1.5 rounded-lg border font-bold uppercase text-[9px] transition-all text-center ${
                      kycDocType === 'lojista' 
                        ? 'bg-indigo-600 border-indigo-500 text-white' 
                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Lojista (CNPJ)
                  </button>
                </div>
              </div>

              {/* Conditional input fields */}
              <div className="bg-slate-900/55 p-3 rounded-xl space-y-3.5 border border-slate-900">
                {kycDocType === 'bike' && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-mono uppercase">CPF do Entregador</label>
                    <input
                      type="text"
                      value={kycCpf}
                      onChange={(e) => setKycCpf(formatCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[8px] text-slate-500 leading-tight mt-1">
                      Necessário para emissão de relatórios de fretes e seguro de acidentes pessoais no modal de bike.
                    </p>
                  </div>
                )}

                {kycDocType === 'motorized' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-mono uppercase">CNH (Com EAR)</label>
                      <input
                        type="text"
                        value={kycCnh}
                        onChange={(e) => setKycCnh(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        placeholder="Digite o número de registro da CNH"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-[8px] text-orange-400 font-bold block mt-1">⚠️ Obrigatório conter a observação "EAR" (Exerce Atividade Remunerada)</span>
                    </div>
                  </div>
                )}

                {kycDocType === 'lojista' && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-mono uppercase">CNPJ da Empresa</label>
                    <input
                      type="text"
                      value={kycCnpj}
                      onChange={(e) => setKycCnpj(formatCnpj(e.target.value))}
                      placeholder="00.000.000/0001-00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[8px] text-slate-500 leading-tight mt-1">
                      Utilizado para faturamento e integração com a Receita Federal para emissão automatizada de NF-e e splits B2B.
                    </p>
                  </div>
                )}

                {/* Upload document placeholder button */}
                <div className="border border-dashed border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center space-y-2 bg-slate-950 text-center">
                  <span className="text-lg">📁</span>
                  <div>
                    <span className="text-[10px] font-bold text-slate-300 block">Anexar Cópia do Documento Oficial</span>
                    <span className="text-[8px] text-slate-500">Formatos aceitos: PDF, PNG, JPG (Max: 5MB)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setKycStatus('Em Análise');
                      triggerToast('Documento enviado com sucesso para análise no KYC!', 'success');
                      
                      // Auto-simulate verification after 4 seconds
                      setTimeout(() => {
                        setKycStatus('Verificado');
                        triggerToast('Onboarding KYC verificado com sucesso!', 'success');
                      }, 4000);
                    }}
                    className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-bold rounded-lg text-[9px] uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Simular Envio / Upload
                  </button>
                </div>
              </div>
            </div>

            {/* BLOC 5: Validação Facial */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-3">
              <h4 className="font-black text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5 text-orange-400">
                <span>Validação Facial Liveness Antifraude</span>
              </h4>
              
              {isFacialScanning ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center space-y-4 animate-pulse">
                  <div className="relative w-28 h-28 rounded-full border-4 border-dashed border-orange-500 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-slate-950 flex items-center justify-center">
                      <span className="text-2xl animate-pulse">👤</span>
                    </div>
                  </div>
                  <div className="text-center space-y-1">
                    <span className="text-[10px] font-bold text-orange-400 block">Escaneando Biometria Facial...</span>
                    <span className="text-[8px] text-slate-500">Mantenha o rosto centralizado e pisque para validar.</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-900">
                  <div className="space-y-0.5">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <span>Status da Validação:</span>
                      {facialValidated ? (
                        <span className="text-emerald-400 font-bold font-mono">✓ Validado</span>
                      ) : (
                        <span className="text-slate-500 font-mono">Não Realizada</span>
                      )}
                    </span>
                    <p className="text-[9px] text-slate-500 leading-tight">Biometria liveness exigida para autorizar saques e transferências de PIX acima de R$ 1.000,00.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsFacialScanning(true);
                      triggerToast('Iniciando captura de biometria facial...', 'info');
                      
                      setTimeout(() => {
                        setIsFacialScanning(false);
                        setFacialValidated(true);
                        triggerToast('✓ Reconhecimento facial antifraude validado com sucesso!', 'success');
                      }, 3000);
                    }}
                    className={`shrink-0 px-3 py-2 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                      facialValidated 
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25'
                        : 'bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-600/10'
                    }`}
                  >
                    {facialValidated ? 'Refazer Scanner' : 'Iniciar Facial'}
                  </button>
                </div>
              )}
            </div>

            {/* Actions: Save / Cancel */}
            <div className="flex gap-3 border-t border-slate-800/80 pt-4">
              <button
                type="button"
                onClick={() => setShowUserProfileModal(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl transition-all uppercase tracking-wider cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerToast('⏱ Persistindo dados no Firestore...', 'info');
                  
                  // Simulate Firebase Write I/O latency
                  setTimeout(() => {
                    console.log("[Firestore] Salvando dados cadastrais no document users/" + profileEmail, {
                      name: profileName,
                      email: profileEmail,
                      photoUrl: profilePhotoUrl,
                      accountTypes: { cliente: accountTypeCliente, entregador: accountTypeEntregador, lojista: accountTypeLojista },
                      address: profileAddress,
                      whatsapp: profileWhatsApp,
                      biometricsActive,
                      transactionPin,
                      kycDocType,
                      kycCpf,
                      kycCnh,
                      kycCnpj,
                      kycStatus,
                      facialValidated,
                      updatedAt: new Date().toISOString()
                    });
                    
                    triggerToast('✓ Perfil e Segurança persistidos com segurança no Firestore!', 'success');
                    setShowUserProfileModal(false);
                  }, 800); // 800ms simulation
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 rounded-xl transition-all uppercase tracking-wider cursor-pointer text-center"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHAT MODAL - PEER TO PEER SOCIAL COMMUNICATION */}
      {showChatModal && selectedChatUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="chat-modal">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl shadow-2xl relative flex flex-col h-[500px] overflow-hidden animate-scale-up text-xs">
            {/* Header */}
            <div className="flex items-center justify-between bg-slate-950 p-4 border-b border-slate-800/60 shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={selectedChatUser.avatar} alt={selectedChatUser.name} className="w-10 h-10 rounded-full object-cover border border-slate-800" referrerPolicy="no-referrer" />
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-white uppercase tracking-wide">{selectedChatUser.name}</h4>
                  <span className="text-[8px] font-mono text-slate-500 uppercase">{selectedChatUser.role}</span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowChatModal(false);
                  setSelectedChatUser(null);
                }}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Chat History Messages Container */}
            <div className="flex-1 p-4 overflow-y-auto bg-slate-950/40 space-y-3.5 flex flex-col-reverse">
              <div className="space-y-3.5">
                {(simulatedChatHistory[selectedChatUser.id] || [])
                  .map((msg, i) => {
                    const isMe = msg.sender.includes('Você') || msg.sender === 'me';
                    return (
                      <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                        <div className={`max-w-[80%] rounded-2xl p-3 space-y-1 ${
                          isMe 
                            ? 'bg-orange-600 text-white rounded-tr-none' 
                            : 'bg-slate-850 text-slate-200 rounded-tl-none border border-slate-800/80'
                        }`}>
                          <p className="text-xs leading-relaxed break-words">{msg.text}</p>
                          <span className={`text-[8px] font-mono block text-right ${
                            isMe ? 'text-orange-200' : 'text-slate-500'
                          }`}>
                            {msg.time}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                {(!simulatedChatHistory[selectedChatUser.id] || simulatedChatHistory[selectedChatUser.id].length === 0) && (
                  <div className="text-center py-12 text-slate-500 text-xs italic">
                    Nenhuma mensagem anterior. Digite algo abaixo para iniciar o chat criptografado local!
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Message Input Form */}
            <form 
              onSubmit={handleSendChatMessage}
              className="p-3 bg-slate-950 border-t border-slate-800/80 shrink-0 flex gap-2"
            >
              <input
                type="text"
                value={chatMessageText}
                onChange={(e) => setChatMessageText(e.target.value)}
                placeholder="Escreva uma mensagem privada..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 font-sans"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Enviar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MOMENTS MODAL - STORE REVIEWS & SOCIAL INTEGRATION */}
      {showMomentsModal && selectedStoreForMoments && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="moments-modal">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-5 max-h-[85vh] overflow-y-auto animate-scale-up text-xs">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-3.5">
                <img src={selectedStoreForMoments.logo} alt={selectedStoreForMoments.name} className="w-10 h-10 rounded-xl object-cover border border-slate-850" referrerPolicy="no-referrer" />
                <div>
                  <span className="text-[9px] font-mono text-slate-500 uppercase font-black">Histórico de Visitas & Reviews</span>
                  <h3 className="text-sm font-black text-white uppercase tracking-wide">{selectedStoreForMoments.name}</h3>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowMomentsModal(false);
                  setSelectedStoreForMoments(null);
                  setNewMomentContent('');
                  setNewMomentRating(5);
                  setNewMomentPhoto('');
                }}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* List Existing Moments */}
            <div className="space-y-3">
              <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">Momentos Compartilhados por Clientes</span>
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {momentos.filter(m => m.storeId === selectedStoreForMoments.id).length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-900">
                    Ainda não há avaliações de Momentos para esta loja. Publique o primeiro abaixo!
                  </div>
                ) : (
                  momentos
                    .filter(m => m.storeId === selectedStoreForMoments.id)
                    .map(mom => (
                      <div key={mom.id} className="bg-slate-950 border border-slate-850 p-3.5 rounded-2xl space-y-2.5">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs">👤</span>
                            <div>
                              <h5 className="text-[11px] font-bold text-white uppercase">{mom.user}</h5>
                              <span className="text-[8px] font-mono text-slate-500">{mom.createdAt}</span>
                            </div>
                          </div>
                          {/* Stars */}
                          <div className="flex gap-0.5 text-[9px] text-amber-400 font-bold font-mono">
                            {'★'.repeat(mom.rating)}
                            {'☆'.repeat(5 - mom.rating)}
                          </div>
                        </div>

                        <p className="text-slate-300 text-xs leading-relaxed">{mom.content}</p>

                        {/* Optional Attached Moment Image */}
                        {mom.mediaUrl && (
                          <div className="relative rounded-xl overflow-hidden max-h-36 border border-slate-900 bg-slate-900/60">
                            <img src={mom.mediaUrl} alt="Oferta Relacionada" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        )}

                        {mom.publishedToFeed && (
                          <div className="flex items-center gap-1.5 text-[8px] font-mono text-orange-400 uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                            <span>Sincronizado na Praça Local</span>
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* Write a New Moment Form */}
            <form 
              onSubmit={handlePublishMoment}
              className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-4"
            >
              <h4 className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">Publicar Meu Momento / Review</h4>

              <div className="space-y-3">
                {/* Text Content */}
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-500 font-mono uppercase">O que você achou das ofertas ou da visita?</label>
                  <textarea
                    value={newMomentContent}
                    onChange={(e) => setNewMomentContent(e.target.value)}
                    placeholder="Ex: Excelente atendimento! Comprei as ferramentas em oferta e ganhei desconto no PIX."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    rows={2.5}
                    required
                  />
                </div>

                {/* Rating (Stars Selector) */}
                <div className="flex items-center justify-between border-b border-slate-900 pb-2.5">
                  <span className="text-[9px] text-slate-400 font-mono uppercase">Sua Nota de Avaliação:</span>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setNewMomentRating(star)}
                        className={`text-base cursor-pointer hover:scale-125 transition-transform ${
                          star <= newMomentRating ? 'text-amber-400' : 'text-slate-700'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>

                {/* Simulated Photo attachment selector */}
                <div className="space-y-1.5">
                  <span className="text-[9px] text-slate-400 font-mono uppercase block">Vincular Foto da Vitrine da Loja:</span>
                  <div className="grid grid-cols-4 gap-2">
                    {selectedStoreForMoments.offerImages.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setNewMomentPhoto(newMomentPhoto === img ? '' : img)}
                        className={`relative rounded-lg overflow-hidden h-12 border-2 transition-all cursor-pointer ${
                          newMomentPhoto === img 
                            ? 'border-orange-500 scale-95 shadow-md shadow-orange-500/20' 
                            : 'border-transparent hover:border-slate-800'
                        }`}
                      >
                        <img src={img} alt="vitrine template" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cross-Post Switch Toggle */}
                <div className="flex items-center justify-between p-2.5 bg-slate-900/55 rounded-xl border border-slate-900/80 mt-2">
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-mono text-slate-300 uppercase block">Compartilhar na Praça Social</span>
                    <p className="text-[8px] text-slate-500">Publicará este momento automaticamente no feed geral da Praça.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewMomentPublishToPraca(!newMomentPublishToPraca)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      newMomentPublishToPraca ? 'bg-orange-500' : 'bg-slate-850'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                        newMomentPublishToPraca ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Publish Button */}
              <button
                type="submit"
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
              >
                Publicar Momento
              </button>
            </form>
          </div>
        </div>
      )}

      {/* REAL-TIME ALARM / REMINDER FULL OVERLAY MODAL */}
      {activeAlarmNote && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" id="active-alarm-modal">
          <div className="bg-slate-900 border-2 border-orange-500/50 w-full max-w-sm p-6 rounded-3xl shadow-2xl shadow-orange-500/10 text-center space-y-5 relative overflow-hidden animate-scale-up">
            
            {/* Animated Ring Accent */}
            <div className="absolute -top-12 -left-12 w-24 h-24 bg-orange-500/10 rounded-full blur-xl animate-pulse"></div>
            <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-teal-500/10 rounded-full blur-xl animate-pulse"></div>

            <div className="flex flex-col items-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 animate-bounce">
                <Bell className="w-8 h-8 text-orange-500" />
              </div>
              <div>
                <span className="text-[10px] font-mono text-orange-400 uppercase font-black tracking-widest block">🔔 ALARME DE TAREFA ATIVO</span>
                <h3 className="text-base font-black text-white uppercase mt-1 tracking-wide">{activeAlarmNote.title}</h3>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-300 text-xs leading-relaxed">
              {activeAlarmNote.content}
            </div>

            {activeAlarmNote.checklist && activeAlarmNote.checklist.length > 0 && (
              <div className="text-left bg-slate-950/50 p-3 rounded-2xl border border-slate-800/60 space-y-1.5">
                <span className="text-[9px] font-mono uppercase text-slate-500 block">Checklist Associado</span>
                {activeAlarmNote.checklist.slice(0, 3).map(item => (
                  <div key={item.id} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span className={item.done ? 'text-emerald-400 font-bold font-mono' : 'text-slate-600 font-bold font-mono'}>
                      {item.done ? '✓' : '☐'}
                    </span>
                    <span className={item.done ? 'line-through text-slate-600' : ''}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  // Soneca/Remind in 1 minute
                  const now = new Date();
                  now.setMinutes(now.getMinutes() + 1);
                  const year = now.getFullYear();
                  const month = String(now.getMonth() + 1).padStart(2, '0');
                  const day = String(now.getDate()).padStart(2, '0');
                  const hours = String(now.getHours()).padStart(2, '0');
                  const minutes = String(now.getMinutes()).padStart(2, '0');
                  const newReminder = `${year}-${month}-${day}T${hours}:${minutes}`;

                  setNotes(prev => prev.map(n => n.id === activeAlarmNote.id ? { ...n, reminderDateTime: newReminder } : n));
                  setActiveAlarmNote(null);
                  triggerToast('Soneca ativada por 1 minuto!', 'info');
                }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] uppercase tracking-wider transition-all cursor-pointer"
              >
                Soneca (1m)
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setDismissedAlarms(prev => [...prev, activeAlarmNote.id]);
                  setActiveAlarmNote(null);
                  triggerToast('Alarme descartado com sucesso.', 'success');
                }}
                className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black py-2.5 rounded-xl text-[11px] uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-orange-600/20"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL DE CONFIGURAÇÃO DE PERFIL E AMBIENTES DA LOJA */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans animate-fade-in my-8">
            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-850 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-orange-500 flex items-center justify-center">
                  <StoreIcon className="w-3.5 h-3.5 text-slate-950" />
                </div>
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Configurações da Loja</h3>
              </div>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="text-slate-400 hover:text-white font-bold bg-slate-900 border border-slate-800 w-6 h-6 rounded-full flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Tabs Selector */}
            <div className="flex border-b border-slate-850 bg-slate-950/50">
              <button
                onClick={() => setConfigActiveTab('perfil')}
                className={`flex-1 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                  configActiveTab === 'perfil'
                    ? 'border-orange-500 text-white bg-slate-900/40'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                Perfil
              </button>
              <button
                onClick={() => setConfigActiveTab('ambiente')}
                className={`flex-1 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                  configActiveTab === 'ambiente'
                    ? 'border-orange-500 text-white bg-slate-900/40'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                Ambiente
              </button>
            </div>

            {/* Content Container */}
            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-5">
              {configActiveTab === 'perfil' ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Nome da Loja</label>
                    <input
                      type="text"
                      value={configStoreName}
                      onChange={(e) => setConfigStoreName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                      placeholder="Nome Fantasia..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Biografia (Descrição)</label>
                    <textarea
                      value={configStoreBio}
                      onChange={(e) => setConfigStoreBio(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750 h-20 resize-none"
                      placeholder="Fale brevemente sobre o seu negócio..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Endereço</label>
                    <input
                      type="text"
                      value={configStoreAddress}
                      onChange={(e) => setConfigStoreAddress(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                      placeholder="Rua, número, bairro..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Contato</label>
                    <input
                      type="text"
                      value={configStoreContact}
                      onChange={(e) => setConfigStoreContact(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                      placeholder="(DD) 99999-9999..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Palavras-chave de SEO Local (Separadas por vírgula)</label>
                    <input
                      type="text"
                      value={configStoreKeywords}
                      onChange={(e) => setConfigStoreKeywords(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                      placeholder="pizza, bar, lanches, entrega rapida..."
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-6 animate-fade-in">
                  {/* Atendimento Spaces */}
                  <div className="space-y-3 bg-slate-950/40 border border-slate-850 p-4 rounded-2xl">
                    <h4 className="text-[10px] font-mono text-orange-400 uppercase font-black">Espaços de Atendimento</h4>
                    
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newAtendimentoSpace}
                        onChange={(e) => setNewAtendimentoSpace(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddAtendimentoSpace()}
                        className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none uppercase"
                        placeholder="Novo espaço (ex: MESA 5)..."
                      />
                      <button
                        onClick={handleAddAtendimentoSpace}
                        className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs uppercase cursor-pointer"
                      >
                        + Adicionar
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {atendimentoSpaces.map(space => (
                        <span key={space} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-[10px] text-slate-300 px-2.5 py-1 rounded-full font-bold">
                          {space}
                          <button
                            onClick={() => handleRemoveAtendimentoSpace(space)}
                            className="text-red-400 hover:text-red-300 ml-1 font-bold font-mono focus:outline-none text-xs"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Producao Spaces */}
                  <div className="space-y-3 bg-slate-950/40 border border-slate-850 p-4 rounded-2xl">
                    <h4 className="text-[10px] font-mono text-teal-400 uppercase font-black">Espaços de Produção</h4>
                    
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newProducaoSpace}
                        onChange={(e) => setNewProducaoSpace(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddProducaoSpace()}
                        className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none uppercase"
                        placeholder="Novo espaço (ex: SALADAS)..."
                      />
                      <button
                        onClick={handleAddProducaoSpace}
                        className="bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs uppercase cursor-pointer"
                      >
                        + Adicionar
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {producaoSpaces.map(space => (
                        <span key={space} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-[10px] text-slate-300 px-2.5 py-1 rounded-full font-bold">
                          {space}
                          <button
                            onClick={() => handleRemoveProducaoSpace(space)}
                            className="text-red-400 hover:text-red-300 ml-1 font-bold font-mono focus:outline-none text-xs"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-950 px-6 py-4 border-t border-slate-850 flex justify-end gap-3">
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="bg-slate-900 hover:bg-slate-850 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs uppercase cursor-pointer"
              >
                Fechar
              </button>
              {configActiveTab === 'perfil' && (
                <button
                  onClick={handleSaveStoreProfile}
                  className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                >
                  Salvar Alterações
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MINIMAL FOOTER FOR PREMIUM INTEGRATION */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mb-20 text-center space-y-2">
        <p className="text-[9px] text-slate-500 font-mono">
          Kyrub Ecosystem Platform • Projetado para Google Cloud Run + Cloudflare Enterprise. Todos os direitos reservados.
        </p>
      </footer>

    </div>
  )}
