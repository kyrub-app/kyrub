import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark,
  Camera,
  Check,
  CircleUserRound,
  Clock3,
  Compass,
  EllipsisVertical,
  Flag,
  Heart,
  ImagePlus,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Search,
  Send,
  ShoppingBag,
  Star,
  Store as StoreIcon,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { onAuthStateChanged, updateProfile, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { Friend, SocialPost } from '../types';
import { usePublicSocialFeed } from '../hooks/usePublicSocialFeed';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { auth, db, storage } from '../utils/firebase';
import { buildPublicStorefrontPath } from '../utils/appRoutes';
import { MediaCarousel } from './MediaCarousel';

type ProfileTab = 'publications' | 'status' | 'connected' | 'square';
type ConnectionSection = 'connected' | 'suggestions' | 'requests';
type ToastType = 'success' | 'error' | 'info' | 'warning';
type ComposerType = 'feed' | 'status';

type ExtendedSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  taggedUsers?: string[];
  taggedUserIds?: string[];
  createdAt?: string;
  visibility?: 'public' | 'private' | 'connections';
  audienceIds?: string[];
};

type ProfileState = {
  name: string;
  email: string;
  photoUrl: string;
  bio: string;
  isProfileVisible: boolean;
};

type MarketplaceStore = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
  offerImages: string[];
  keywords: string[];
  status: 'open' | 'delayed' | 'closed';
};

type StoreMoment = {
  id: string;
  storeId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  rating: number;
  mediaUrl: string;
  publishedToSquare: boolean;
  createdAtIso: string;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_STATUSES = 9;
const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;
const getGooglePhotoKey = (uid: string) => `kyrub_google_profile_photo_${uid}`;
const getFavoriteStoresKey = (uid: string) => `kyrub_favorite_stores_${uid}`;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const readStoredPosts = (rawValue: string | null): ExtendedSocialPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as ExtendedSocialPost[]) : [];
  } catch {
    return [];
  }
};

const profileHandle = (email: string, name: string): string => {
  const source = email.split('@')[0]?.trim() || name || 'usuario';
  return source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 30);
};

const postTimestamp = (post: ExtendedSocialPost): number => {
  const parsed = Date.parse(post.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const isActiveStatus = (post: ExtendedSocialPost, now: number): boolean =>
  post.publicationType === 'status' &&
  postTimestamp(post) > 0 &&
  now - postTimestamp(post) < STATUS_TTL_MS;

const remainingStatusLabel = (post: ExtendedSocialPost, now: number): string => {
  const remaining = Math.max(0, STATUS_TTL_MS - (now - postTimestamp(post)));
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
  return `${hours} h restantes`;
};

const tenantToMarketplaceStore = (
  id: string,
  data: Record<string, unknown>
): MarketplaceStore | null => {
  if (data.publicationStatus !== 'published') return null;
  const name = readString(data.name);
  if (!name) return null;
  const status =
    data.status === 'open' || data.status === 'delayed'
      ? data.status
      : 'closed';
  return {
    id: readString(data.id) || id,
    name,
    slug: readString(data.slug),
    description: readString(data.description),
    logo: readString(data.logo),
    banner: readString(data.banner),
    offerImages: readStringList(data.offerImages),
    keywords: readStringList(data.keywords),
    status,
  };
};

const mapStoreMoment = (
  id: string,
  data: Record<string, unknown>
): StoreMoment | null => {
  const storeId = readString(data.storeId);
  const userId = readString(data.userId);
  const content = readString(data.content);
  if (!storeId || !userId || !content) return null;
  const rawRating = typeof data.rating === 'number' ? data.rating : 0;
  return {
    id,
    storeId,
    userId,
    userName: readString(data.userName) || 'Usuário Kyrub',
    userAvatar: readString(data.userAvatar),
    content,
    rating: Math.min(5, Math.max(1, Math.round(rawRating || 1))),
    mediaUrl: readString(data.mediaUrl),
    publishedToSquare: data.publishedToSquare === true,
    createdAtIso: readString(data.createdAtIso),
  };
};

function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center bg-slate-950 text-slate-500`}
      role="img"
      aria-label={`Foto de ${name || 'usuário'} não informada`}
    >
      <CircleUserRound className="h-1/2 w-1/2" />
    </span>
  );
}

function EmptyState({
  title,
  description,
  icon: Icon = CircleUserRound,
}: {
  title: string;
  description: string;
  icon?: typeof CircleUserRound;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-700" />
      <h4 className="mt-3 text-xs font-black uppercase text-slate-300">
        {title}
      </h4>
      <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-slate-500">
        {description}
      </p>
    </div>
  );
}

function SocialCard({
  post,
  saved,
  liked,
  currentUserId,
  statusLabel,
  onToggleSave,
  onToggleLike,
  onReport,
}: {
  post: ExtendedSocialPost;
  saved: boolean;
  liked: boolean;
  currentUserId: string;
  statusLabel?: string;
  onToggleSave?: () => void;
  onToggleLike: () => void;
  onReport: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isStatus = post.publicationType === 'status';
  const isOwnPost = post.authorId === currentUserId;

  return (
    <article className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
      <header className="relative flex items-center gap-3">
        <Avatar
          src={post.avatar}
          name={post.user}
          className={`h-10 w-10 rounded-full border-2 object-cover ${
            isStatus ? 'border-teal-400' : 'border-slate-800'
          }`}
        />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-xs font-black text-slate-100">
            {post.user}
          </h4>
          <span className="font-mono text-[9px] text-slate-500">
            {post.time}
          </span>
        </div>
        {statusLabel && (
          <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[8px] font-black uppercase text-teal-300">
            {statusLabel}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {!isStatus && onToggleSave && (
            <button
              type="button"
              onClick={onToggleSave}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                saved
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-amber-300'
              }`}
              aria-label={saved ? 'Remover dos salvos' : 'Salvar publicação'}
              title={saved ? 'Remover dos salvos' : 'Salvar publicação'}
            >
              <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(current => !current)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Mais opções da publicação"
          >
            <EllipsisVertical className="h-4 w-4" />
          </button>
        </div>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-20 min-w-48 rounded-2xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl">
            {isOwnPost ? (
              <div className="px-3 py-2 text-[9px] text-slate-600">
                Esta publicação é sua.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onReport();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[9px] font-black uppercase text-red-300 hover:bg-red-500/10"
              >
                <Flag className="h-4 w-4" />
                Denunciar publicação
              </button>
            )}
          </div>
        )}
      </header>

      {post.content && (
        <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">
          {post.content}
        </p>
      )}

      {post.taggedUsers && post.taggedUsers.length > 0 && (
        <p className="text-[9px] font-mono text-teal-400">
          com {post.taggedUsers.map(name => `@${name}`).join(', ')}
        </p>
      )}

      {post.mediaUrls && post.mediaUrls.length > 0 && (
        <MediaCarousel mediaUrls={post.mediaUrls} />
      )}

      <button
        type="button"
        onClick={onToggleLike}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[9px] font-black uppercase ${
          liked
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            : 'border-slate-800 bg-slate-950 text-slate-400'
        }`}
      >
        <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
        {post.likes} {post.likes === 1 ? 'curtida' : 'curtidas'}
      </button>
    </article>
  );
}

export function ProfileSocialHubBridge() {
  const [open, setOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [activeTab, setActiveTab] =
    useState<ProfileTab>('publications');
  const [connectionSection, setConnectionSection] =
    useState<ConnectionSection>('connected');
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<ProfileState>({
    name: '',
    email: '',
    photoUrl: '',
    bio: '',
    isProfileVisible: true,
  });
  const [draftName, setDraftName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [postMediaUrls, setPostMediaUrls] = useState<string[]>([]);
  const [shareToSquare, setShareToSquare] = useState<
    Record<ComposerType, boolean>
  >({ feed: false, status: false });
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [selectedTaggedUserIds, setSelectedTaggedUserIds] = useState<
    string[]
  >([]);
  const [now, setNow] = useState(Date.now());
  const [squareSearch, setSquareSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [stores, setStores] = useState<MarketplaceStore[]>([]);
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<Set<string>>(
    new Set()
  );
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [storeMoments, setStoreMoments] = useState<StoreMoment[]>([]);
  const [momentStore, setMomentStore] = useState<MarketplaceStore | null>(null);
  const [momentContent, setMomentContent] = useState('');
  const [momentRating, setMomentRating] = useState(5);
  const [momentMediaUrl, setMomentMediaUrl] = useState('');
  const [momentShareToSquare, setMomentShareToSquare] = useState(true);
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);
  const [chatTarget, setChatTarget] = useState<Friend | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const socialFeed = usePublicSocialFeed();

  const triggerToast = (
    message: string,
    type: ToastType = 'info'
  ) => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3500);
  };

  const directory = useSocialDirectoryV2({
    profileName: profile.name,
    profilePhotoUrl: profile.photoUrl,
    profileAddress: profile.bio,
    accountTypeLojista: false,
    accountTypeEntregador: false,
    isLoggedIn: Boolean(user),
    triggerToast,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      if (!nextUser) {
        setOpen(false);
        return;
      }
      const storedGooglePhoto = localStorage.getItem(
        getGooglePhotoKey(nextUser.uid)
      );
      if (!storedGooglePhoto && nextUser.photoURL) {
        localStorage.setItem(
          getGooglePhotoKey(nextUser.uid),
          nextUser.photoURL
        );
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), snapshot => {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      setProfile(current => ({
        ...current,
        name:
          readString(data?.name) ||
          user.displayName ||
          user.email?.split('@')[0] ||
          'Usuário Kyrub',
        email: readString(data?.email) || user.email || '',
        photoUrl: readString(data?.photoUrl) || user.photoURL || '',
        isProfileVisible: data?.isProfileVisible !== false,
      }));
    });
    const unsubscribePublicProfile = onSnapshot(
      doc(db, `users/${user.uid}/public_profile/main`),
      snapshot => {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        setProfile(current => ({
          ...current,
          bio: readString(data?.bio),
          photoUrl: readString(data?.photoUrl) || current.photoUrl,
          name: readString(data?.name) || current.name,
        }));
      },
      () => undefined
    );
    return () => {
      unsubscribeUser();
      unsubscribePublicProfile();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'users'), snapshot => {
      directory.setDbUsers(
        snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      );
    });
  }, [directory.setDbUsers, user]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let bound: HTMLElement | null = null;
    const intercept = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
      setOpen(true);
    };
    const bind = () => {
      const next = document.getElementById('header-user-profile-trigger');
      if (next === bound) return;
      bound?.removeEventListener('click', intercept, true);
      bound = next;
      bound?.addEventListener('click', intercept, true);
    };
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      bound?.removeEventListener('click', intercept, true);
    };
  }, []);

  useEffect(() => {
    const image = document.querySelector<HTMLImageElement>(
      '#header-user-profile-trigger img'
    );
    if (image && profile.photoUrl) image.src = profile.photoUrl;
    const title = document.querySelector<HTMLElement>(
      '#header-user-profile-trigger h1 span'
    );
    if (title && profile.name) {
      title.textContent = profile.name.split(' ')[0] ?? profile.name;
    }
  }, [profile.name, profile.photoUrl]);

  useEffect(() => {
    if (!open) return;
    setDraftName(profile.name);
    setDraftBio(profile.bio);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (momentStore) setMomentStore(null);
      else if (savedOpen) setSavedOpen(false);
      else if (marketplaceOpen) setMarketplaceOpen(false);
      else if (editOpen) setEditOpen(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    editOpen,
    marketplaceOpen,
    momentStore,
    open,
    profile.bio,
    profile.name,
    savedOpen,
  ]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(
        collection(db, 'tenants'),
        where('publicationStatus', '==', 'published')
      ),
      snapshot => {
        setStores(
          snapshot.docs.flatMap(item => {
            const store = tenantToMarketplaceStore(
              item.id,
              item.data() as Record<string, unknown>
            );
            return store ? [store] : [];
          })
        );
      },
      () => setStores([])
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      collection(db, 'reviews'),
      snapshot => {
        setStoreMoments(
          snapshot.docs.flatMap(item => {
            const moment = mapStoreMoment(
              item.id,
              item.data() as Record<string, unknown>
            );
            return moment ? [moment] : [];
          })
        );
      },
      () => setStoreMoments([])
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    try {
      const parsed = JSON.parse(
        localStorage.getItem(getFavoriteStoresKey(user.uid)) ?? '[]'
      );
      setFavoriteStoreIds(
        new Set(
          Array.isArray(parsed)
            ? parsed.filter(value => typeof value === 'string')
            : []
        )
      );
    } catch {
      setFavoriteStoreIds(new Set());
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      collection(db, `users/${user.uid}/favorites`),
      snapshot => {
        setSavedPostIds(
          new Set(
            snapshot.docs.flatMap(item => {
              const data = item.data() as Record<string, unknown>;
              return data.kind === 'social_post' &&
                typeof data.postId === 'string'
                ? [data.postId]
                : [];
            })
          )
        );
      }
    );
  }, [user]);

  const allPosts = socialFeed.posts as ExtendedSocialPost[];
  const ownFeedPosts = useMemo(
    () =>
      allPosts.filter(
        post =>
          post.authorId === user?.uid && post.publicationType !== 'status'
      ),
    [allPosts, user?.uid]
  );
  const activeStatuses = useMemo(
    () => allPosts.filter(post => isActiveStatus(post, now)),
    [allPosts, now]
  );
  const ownStatuses = useMemo(
    () => activeStatuses.filter(post => post.authorId === user?.uid),
    [activeStatuses, user?.uid]
  );
  const squarePosts = useMemo(
    () =>
      allPosts.filter(
        post =>
          post.visibility === 'public' &&
          (post.publicationType !== 'status' || isActiveStatus(post, now))
      ),
    [allPosts, now]
  );
  const savedPosts = useMemo(
    () =>
      allPosts.filter(
        post =>
          post.publicationType !== 'status' && savedPostIds.has(post.id)
      ),
    [allPosts, savedPostIds]
  );
  const connectedStatuses = useMemo(() => {
    const connectedIds = new Set(
      directory.friends.filter(friend => friend.added).map(friend => friend.id)
    );
    return activeStatuses.filter(
      post => post.authorId && connectedIds.has(post.authorId)
    );
  }, [activeStatuses, directory.friends]);
  const selectedTaggedFriends = useMemo(
    () =>
      directory.friends.filter(friend =>
        selectedTaggedUserIds.includes(friend.id)
      ),
    [directory.friends, selectedTaggedUserIds]
  );

  const persistLocalPost = (post: ExtendedSocialPost) => {
    if (!user) return;
    const key = getUserPostsKey(user.uid);
    const current = readStoredPosts(
      localStorage.getItem(key) ?? localStorage.getItem(LEGACY_POSTS_KEY)
    );
    const next = [post, ...current.filter(item => item.id !== post.id)];
    localStorage.setItem(key, JSON.stringify(next));
    localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('kyrub-social-posts-updated', {
        detail: { uid: user.uid, posts: next, source: 'local' },
      })
    );
  };

  const publish = (publicationType: ComposerType) => {
    if (!user) return;
    if (!newPostText.trim() && postMediaUrls.length === 0) {
      triggerToast(
        'Escreva algo ou adicione uma imagem antes de publicar.',
        'info'
      );
      return;
    }
    if (
      publicationType === 'status' &&
      ownStatuses.length >= MAX_ACTIVE_STATUSES
    ) {
      triggerToast(
        'Você já possui 9 status ativos. Aguarde um deles completar 24 horas.',
        'warning'
      );
      return;
    }

    const createdAt = new Date().toISOString();
    const sendToSquare = shareToSquare[publicationType];
    const visibility =
      publicationType === 'status'
        ? sendToSquare
          ? 'public'
          : 'connections'
        : sendToSquare
          ? 'public'
          : 'private';

    persistLocalPost({
      id: `${publicationType}-${Date.now()}`,
      authorId: user.uid,
      user:
        profile.name ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Usuário Kyrub',
      avatar: profile.photoUrl || user.photoURL || '',
      time: 'Agora mesmo',
      createdAt,
      content: newPostText.trim(),
      likes: 0,
      mediaUrls: postMediaUrls,
      publicationType,
      visibility,
      taggedUsers: selectedTaggedFriends.map(friend => friend.name),
      taggedUserIds: selectedTaggedFriends.map(friend => friend.id),
    });

    setNewPostText('');
    setPostMediaUrls([]);
    setSelectedTaggedUserIds([]);
    setTagPickerOpen(false);
    setShareToSquare(current => ({
      ...current,
      [publicationType]: false,
    }));

    triggerToast(
      publicationType === 'status'
        ? sendToSquare
          ? 'Status publicado para conectados e enviado à Praça por 24 horas.'
          : 'Status publicado por 24 horas para seus conectados.'
        : sendToSquare
          ? 'Publicação enviada para sua linha do tempo e para a Praça.'
          : 'Publicação adicionada à sua linha do tempo.',
      'success'
    );
  };

  const readPostImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(file =>
      file.type.startsWith('image/')
    );
    event.target.value = '';
    const slots = Math.max(0, 9 - postMediaUrls.length);
    const selected = files.slice(0, slots);
    const encoded = await Promise.all(
      selected.map(
        file =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );
    setPostMediaUrls(current => [...current, ...encoded].slice(0, 9));
  };

  const toggleSavedPost = async (postId: string) => {
    if (!user) return;
    const favoriteId = `social_${postId.replaceAll('/', '_')}`.slice(0, 500);
    const reference = doc(
      db,
      `users/${user.uid}/favorites/${favoriteId}`
    );
    try {
      if (savedPostIds.has(postId)) await deleteDoc(reference);
      else {
        await setDoc(reference, {
          kind: 'social_post',
          postId,
          createdAt: serverTimestamp(),
        });
      }
    } catch {
      triggerToast('Não foi possível atualizar os itens salvos.', 'error');
    }
  };

  const reportPost = async (post: ExtendedSocialPost) => {
    if (!user || post.authorId === user.uid) return;
    const reportId = `${post.id.replaceAll('/', '_')}__${user.uid}`.slice(
      0,
      1000
    );
    try {
      await setDoc(doc(db, 'social_post_reports', reportId), {
        reportId,
        postId: post.id,
        reporterId: user.uid,
        authorId: post.authorId || '',
        reason: 'user_report',
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      triggerToast(
        'Denúncia enviada para análise. A publicação não foi removida automaticamente.',
        'success'
      );
    } catch (error) {
      console.warn('Não foi possível denunciar a publicação.', error);
      triggerToast('Não foi possível enviar a denúncia.', 'error');
    }
  };

  const toggleFavoriteStore = (storeId: string) => {
    if (!user) return;
    setFavoriteStoreIds(current => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      localStorage.setItem(
        getFavoriteStoresKey(user.uid),
        JSON.stringify([...next])
      );
      return next;
    });
  };

  const openStore = (store: MarketplaceStore) => {
    const path = buildPublicStorefrontPath(store.slug);
    if (!path) {
      triggerToast('Esta loja ainda não possui uma vitrine pública válida.', 'info');
      return;
    }
    window.location.assign(path);
  };

  const saveProfile = async () => {
    if (!user) return;
    const name =
      draftName.trim() ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'Usuário Kyrub';
    const bio = draftBio.trim().slice(0, 280);
    try {
      await Promise.all([
        setDoc(
          doc(db, 'users', user.uid),
          {
            name,
            photoUrl: profile.photoUrl || user.photoURL || '',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        setDoc(
          doc(db, `users/${user.uid}/public_profile/main`),
          {
            userId: user.uid,
            name,
            bio,
            photoUrl: profile.photoUrl || user.photoURL || '',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        updateProfile(user, {
          displayName: name,
          photoURL: profile.photoUrl || user.photoURL || null,
        }),
      ]);
      setProfile(current => ({ ...current, name, bio }));
      setEditOpen(false);
      triggerToast('Perfil atualizado.', 'success');
    } catch (error) {
      console.warn('Não foi possível salvar o perfil social.', error);
      triggerToast('Não foi possível salvar o perfil agora.', 'error');
    }
  };

  const uploadProfilePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!user || !file) return;
    if (!file.type.startsWith('image/')) {
      triggerToast('Selecione uma imagem válida.', 'warning');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      triggerToast('A imagem deve ter no máximo 8 MB.', 'warning');
      return;
    }
    setPhotoBusy(true);
    try {
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const imageReference = ref(
        storage,
        `profile-images/${user.uid}/avatar.${extension}`
      );
      await uploadBytes(imageReference, file, { contentType: file.type });
      const photoUrl = await getDownloadURL(imageReference);
      await Promise.all([
        setDoc(
          doc(db, 'users', user.uid),
          { photoUrl, updatedAt: serverTimestamp() },
          { merge: true }
        ),
        setDoc(
          doc(db, `users/${user.uid}/public_profile/main`),
          {
            userId: user.uid,
            name: profile.name,
            bio: profile.bio,
            photoUrl,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        updateProfile(user, { photoURL: photoUrl }),
      ]);
      setProfile(current => ({ ...current, photoUrl }));
      triggerToast('Foto do perfil atualizada.', 'success');
    } catch (error) {
      console.warn('Não foi possível enviar a foto do perfil.', error);
      triggerToast(
        'A foto personalizada depende do Firebase Storage ativo.',
        'error'
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const restoreGooglePhoto = async () => {
    if (!user) return;
    const photoUrl = localStorage.getItem(getGooglePhotoKey(user.uid)) || '';
    if (!photoUrl) {
      triggerToast('A foto original do Google não está disponível.', 'info');
      return;
    }
    try {
      await Promise.all([
        setDoc(
          doc(db, 'users', user.uid),
          { photoUrl, updatedAt: serverTimestamp() },
          { merge: true }
        ),
        setDoc(
          doc(db, `users/${user.uid}/public_profile/main`),
          {
            userId: user.uid,
            name: profile.name,
            bio: profile.bio,
            photoUrl,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        updateProfile(user, { photoURL: photoUrl }),
      ]);
      setProfile(current => ({ ...current, photoUrl }));
      triggerToast('Foto do Google restaurada.', 'success');
    } catch {
      triggerToast('Não foi possível restaurar a foto.', 'error');
    }
  };

  const publishMoment = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !momentStore || !momentContent.trim()) return;
    const momentReference = doc(collection(db, 'reviews'));
    const createdAtIso = new Date().toISOString();
    try {
      await setDoc(momentReference, {
        storeId: momentStore.id,
        userId: user.uid,
        userName:
          profile.name || user.displayName || user.email?.split('@')[0] ||
          'Usuário Kyrub',
        userAvatar: profile.photoUrl || user.photoURL || '',
        content: momentContent.trim().slice(0, 1500),
        rating: momentRating,
        mediaUrl: momentMediaUrl,
        publishedToSquare: momentShareToSquare,
        createdAtIso,
        createdAt: serverTimestamp(),
      });

      if (momentShareToSquare) {
        persistLocalPost({
          id: `feed-moment-${momentReference.id}`,
          authorId: user.uid,
          user:
            profile.name || user.displayName || user.email?.split('@')[0] ||
            'Usuário Kyrub',
          avatar: profile.photoUrl || user.photoURL || '',
          time: 'Agora mesmo',
          createdAt: createdAtIso,
          content: `Avaliou a loja ${momentStore.name} com ${'★'.repeat(
            momentRating
          )}: “${momentContent.trim()}”`,
          likes: 0,
          mediaUrls: momentMediaUrl ? [momentMediaUrl] : [],
          publicationType: 'feed',
          visibility: 'public',
          taggedUsers: [],
          taggedUserIds: [],
        });
      }

      setMomentContent('');
      setMomentRating(5);
      setMomentMediaUrl('');
      setMomentShareToSquare(true);
      triggerToast('Momento publicado.', 'success');
    } catch (error) {
      console.warn('Não foi possível publicar o momento.', error);
      triggerToast('Não foi possível publicar o momento.', 'error');
    }
  };

  const toggleTaggedUser = (friendId: string) => {
    setSelectedTaggedUserIds(current =>
      current.includes(friendId)
        ? current.filter(id => id !== friendId)
        : [...current, friendId].slice(0, 30)
    );
  };

  const handleLike = (postId: string) => {
    void socialFeed.toggleLike(postId).catch(error => {
      console.warn('Não foi possível atualizar a curtida.', error);
      triggerToast('Não foi possível atualizar a curtida.', 'error');
    });
  };

  if (!open || !user) return null;

  const tabs: Array<{ id: ProfileTab; label: string; count?: number }> = [
    { id: 'publications', label: 'Publicações', count: ownFeedPosts.length },
    { id: 'status', label: 'Status', count: ownStatuses.length },
    { id: 'connected', label: 'Conectados', count: directory.friends.length },
    { id: 'square', label: 'Praça' },
  ];

  const renderComposer = (type: ComposerType) => (
    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <textarea
        value={newPostText}
        onChange={event =>
          setNewPostText(event.target.value.slice(0, 3000))
        }
        rows={3}
        placeholder={
          type === 'status'
            ? 'Compartilhe uma atualização por 24 horas...'
            : 'O que você quer publicar na sua linha do tempo?'
        }
        className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none focus:border-orange-500/60"
      />

      {postMediaUrls.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {postMediaUrls.map((url, index) => (
            <div
              key={`${url.slice(0, 24)}-${index}`}
              className="relative aspect-square overflow-hidden rounded-xl"
            >
              <img
                src={url}
                alt={`Imagem ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setPostMediaUrls(current =>
                    current.filter((_, itemIndex) => itemIndex !== index)
                  )
                }
                className="absolute right-1 top-1 rounded-full bg-slate-950/90 p-1 text-white"
                aria-label={`Remover imagem ${index + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedTaggedFriends.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTaggedFriends.map(friend => (
            <button
              key={friend.id}
              type="button"
              onClick={() => toggleTaggedUser(friend.id)}
              className="flex items-center gap-1 rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-1.5 text-[8px] font-black text-teal-300"
            >
              @{friend.name}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {tagPickerOpen && (
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-[9px] font-black uppercase text-white">
                Marcar conectados
              </h4>
              <p className="text-[8px] text-slate-500">
                Somente usuários que já fazem parte da sua lista.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTagPickerOpen(false)}
              className="text-slate-500"
              aria-label="Fechar seleção de usuários"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {directory.friends.map(friend => {
              const selected = selectedTaggedUserIds.includes(friend.id);
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => toggleTaggedUser(friend.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${
                    selected
                      ? 'border-teal-500/40 bg-teal-500/10'
                      : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <Avatar
                    src={friend.avatar}
                    name={friend.name}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-white">
                    {friend.name}
                  </span>
                  {selected && <Check className="h-4 w-4 text-teal-300" />}
                </button>
              );
            })}
            {directory.friends.length === 0 && (
              <p className="py-4 text-center text-[9px] text-slate-600">
                Você ainda não possui usuários conectados para marcar.
              </p>
            )}
          </div>
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <input
          type="checkbox"
          checked={shareToSquare[type]}
          onChange={event =>
            setShareToSquare(current => ({
              ...current,
              [type]: event.target.checked,
            }))
          }
          className="mt-0.5 h-4 w-4 accent-orange-500"
        />
        <span className="min-w-0">
          <strong className="block text-[9px] font-black uppercase text-slate-200">
            Enviar para a Praça
          </strong>
          <span className="mt-0.5 block text-[8px] leading-relaxed text-slate-500">
            {type === 'status'
              ? 'Quando selecionado, o Status também fica visível no feed geral durante as 24 horas.'
              : 'Quando selecionado, a publicação também aparece no feed geral do Kyrub.'}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <div className="flex flex-wrap gap-2">
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-400">
            <ImagePlus className="h-4 w-4" />
            Imagens {postMediaUrls.length}/9
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={readPostImages}
            />
          </label>
          <button
            type="button"
            onClick={() => setTagPickerOpen(current => !current)}
            className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[9px] font-black uppercase ${
              selectedTaggedUserIds.length > 0
                ? 'border-teal-500/35 bg-teal-500/10 text-teal-300'
                : 'border-slate-800 bg-slate-950 text-slate-400'
            }`}
            aria-label="Marcar usuários conectados"
          >
            <UserPlus className="h-4 w-4" />
            Marcar {selectedTaggedUserIds.length || ''}
          </button>
        </div>
        <button
          type="button"
          onClick={() => publish(type)}
          className={`flex h-10 items-center gap-2 rounded-xl px-4 text-[9px] font-black uppercase ${
            type === 'status'
              ? 'bg-teal-500 text-slate-950'
              : 'bg-orange-500 text-slate-950'
          }`}
        >
          {type === 'status' ? (
            <Clock3 className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Publicar
        </button>
      </div>
    </section>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4"
      id="profile-social-hub-modal"
    >
      <section className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 shadow-2xl sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3 sm:px-5">
          <div>
            <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
              Meu perfil
            </span>
            <h2 className="text-base font-black text-white">Painel pessoal</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500"
            aria-label="Fechar meu perfil"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <section className="border-b border-slate-900 bg-gradient-to-b from-slate-900/90 to-slate-950 px-4 py-5 sm:px-5">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <Avatar
                  src={profile.photoUrl}
                  name={profile.name}
                  className="h-20 w-20 rounded-full border-2 border-orange-500 object-cover sm:h-24 sm:w-24"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(true);
                    window.setTimeout(() => fileInputRef.current?.click(), 0);
                  }}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-950 bg-orange-500 text-slate-950"
                  aria-label="Alterar foto do perfil"
                >
                  {photoBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-black text-white">
                      {profile.name}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                      @{profileHandle(profile.email, profile.name)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMarketplaceOpen(true)}
                    className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orange-500/35 bg-orange-500/10 text-orange-300"
                    title="Abrir Ofertas"
                    aria-label="Abrir Ofertas"
                  >
                    <ShoppingBag className="h-5 w-5" />
                    {stores.length > 0 && (
                      <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-500 px-1 text-center text-[8px] font-black text-slate-950">
                        {stores.length}
                      </span>
                    )}
                  </button>
                </div>
                <p className="mt-3 line-clamp-3 text-[10px] leading-relaxed text-slate-400">
                  {profile.bio ||
                    'Adicione uma breve apresentação para contar aos conectados quem você é.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(profile.name);
                      setDraftBio(profile.bio);
                      setEditOpen(true);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] font-black uppercase text-slate-300"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Editar perfil
                  </button>
                  <button
                    type="button"
                    onClick={() => setSavedOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[9px] font-black uppercase text-amber-300"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    Salvos {savedPosts.length}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <nav
            className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-slate-900 bg-slate-950/95 px-3 py-2 backdrop-blur-md"
            aria-label="Seções do perfil"
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase ${
                  activeTab === tab.id
                    ? 'bg-orange-500 text-slate-950'
                    : 'border border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                {tab.label}
                {typeof tab.count === 'number' ? ` ${tab.count}` : ''}
              </button>
            ))}
          </nav>

          <div className="space-y-4 p-4 sm:p-5">
            {activeTab === 'publications' && (
              <>
                {renderComposer('feed')}
                {ownFeedPosts.map(post => (
                  <SocialCard
                    key={post.id}
                    post={post}
                    saved={savedPostIds.has(post.id)}
                    liked={socialFeed.likedPostIds.has(post.id)}
                    currentUserId={user.uid}
                    onToggleSave={() => void toggleSavedPost(post.id)}
                    onToggleLike={() => handleLike(post.id)}
                    onReport={() => void reportPost(post)}
                  />
                ))}
                {ownFeedPosts.length === 0 && (
                  <EmptyState
                    title="Nenhuma publicação"
                    description="Suas publicações permanentes aparecerão aqui. Marque Enviar para a Praça quando quiser compartilhá-las no feed geral."
                  />
                )}
              </>
            )}

            {activeTab === 'status' && (
              <>
                <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3 text-[10px] leading-relaxed text-teal-200">
                  Você pode manter até 9 status ativos. Cada texto ou conjunto de
                  imagens desaparece da visualização após 24 horas.
                </div>
                {renderComposer('status')}
                {ownStatuses.map(post => (
                  <SocialCard
                    key={post.id}
                    post={post}
                    saved={false}
                    liked={socialFeed.likedPostIds.has(post.id)}
                    currentUserId={user.uid}
                    statusLabel={remainingStatusLabel(post, now)}
                    onToggleLike={() => handleLike(post.id)}
                    onReport={() => void reportPost(post)}
                  />
                ))}
                {ownStatuses.length === 0 && (
                  <EmptyState
                    title="Nenhum status ativo"
                    description="Publique uma imagem ou texto para seus usuários conectados."
                    icon={Clock3}
                  />
                )}
              </>
            )}

            {activeTab === 'connected' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      id: 'connected' as const,
                      label: 'Minha lista',
                      count: directory.friends.length,
                    },
                    {
                      id: 'suggestions' as const,
                      label: 'Sugestões',
                      count: directory.getSuggestions().length,
                    },
                    {
                      id: 'requests' as const,
                      label: 'Solicitações',
                      count: directory.connectionRequests.length,
                    },
                  ].map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setConnectionSection(item.id)}
                      className={`rounded-2xl border p-3 text-center ${
                        connectionSection === item.id
                          ? 'border-teal-500/40 bg-teal-500/10'
                          : 'border-slate-800 bg-slate-900'
                      }`}
                    >
                      <strong className="block text-sm text-white">
                        {item.count}
                      </strong>
                      <span className="mt-1 block text-[8px] font-black uppercase text-slate-500">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>

                {connectionSection === 'connected' && (
                  <div className="space-y-3">
                    {directory.friends.map(friend => {
                      const latestStatus = connectedStatuses.find(
                        post => post.authorId === friend.id
                      );
                      return (
                        <article
                          key={friend.id}
                          className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar
                              src={friend.avatar}
                              name={friend.name}
                              className={`h-12 w-12 rounded-full border-2 object-cover ${
                                latestStatus
                                  ? 'border-orange-500'
                                  : 'border-slate-800'
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-xs font-black text-white">
                                {friend.name}
                              </h4>
                              <p className="truncate text-[9px] text-slate-500">
                                {latestStatus?.content || friend.bio || friend.role}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                directory.handleToggleFavoriteFriend(friend.id)
                              }
                              className={`p-2 ${
                                friend.favorited
                                  ? 'text-amber-400'
                                  : 'text-slate-600'
                              }`}
                              aria-label="Favoritar contato"
                            >
                              <Star className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setChatTarget(friend)}
                              className="flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-2 text-[9px] font-black uppercase text-slate-950"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              Chat
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void directory.handleToggleFriend(friend.id)
                              }
                              className="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-2 text-[9px] font-black uppercase text-red-300"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Remover
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {directory.friends.length === 0 && (
                      <EmptyState
                        title="Nenhuma conexão"
                        description="Aceite solicitações ou encontre pessoas nas sugestões."
                        icon={Users}
                      />
                    )}
                  </div>
                )}

                {connectionSection === 'suggestions' && (
                  <div className="space-y-3">
                    {directory.getSuggestions().map(friend => (
                      <article
                        key={friend.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <Avatar
                          src={friend.avatar}
                          name={friend.name}
                          className="h-11 w-11 rounded-full border border-slate-800 object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-xs font-black text-white">
                            {friend.name}
                          </h4>
                          <p className="truncate text-[9px] text-slate-500">
                            {friend.bio || friend.role}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void directory.handleToggleFriend(friend.id)
                          }
                          className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3 py-2 text-[9px] font-black uppercase text-slate-950"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {friend.connectionStatus === 'pending_sent'
                            ? 'Cancelar'
                            : 'Conectar'}
                        </button>
                      </article>
                    ))}
                    {directory.getSuggestions().length === 0 && (
                      <EmptyState
                        title="Sem sugestões"
                        description="Novos usuários públicos aparecerão aqui."
                        icon={UserPlus}
                      />
                    )}
                  </div>
                )}

                {connectionSection === 'requests' && (
                  <div className="space-y-3">
                    {directory.connectionRequests.map(request => (
                      <article
                        key={request.id}
                        className="rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={request.avatar}
                            name={request.name}
                            className="h-11 w-11 rounded-full border border-slate-800 object-cover"
                          />
                          <div className="min-w-0">
                            <h4 className="truncate text-xs font-black text-white">
                              {request.name}
                            </h4>
                            <p className="truncate text-[9px] text-slate-500">
                              {request.bio || request.role}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void directory.handleAcceptRequest(request)
                            }
                            className="rounded-xl bg-emerald-500 py-2 text-[9px] font-black uppercase text-slate-950"
                          >
                            Aceitar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void directory.handleDeclineRequest(
                                request.id,
                                request.name
                              )
                            }
                            className="rounded-xl border border-slate-800 bg-slate-950 py-2 text-[9px] font-black uppercase text-slate-400"
                          >
                            Recusar
                          </button>
                        </div>
                      </article>
                    ))}
                    {directory.connectionRequests.length === 0 && (
                      <EmptyState
                        title="Sem solicitações"
                        description="Nenhuma solicitação de conexão pendente."
                        icon={Check}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'square' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                  <input
                    value={squareSearch}
                    onChange={event => setSquareSearch(event.target.value)}
                    placeholder="Buscar pessoas e publicações..."
                    className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-3 pl-10 pr-3 text-xs text-white outline-none"
                  />
                </div>
                {squarePosts
                  .filter(
                    post =>
                      !squareSearch.trim() ||
                      `${post.user} ${post.content}`
                        .toLocaleLowerCase('pt-BR')
                        .includes(
                          squareSearch.trim().toLocaleLowerCase('pt-BR')
                        )
                  )
                  .map(post => (
                    <SocialCard
                      key={post.id}
                      post={post}
                      saved={savedPostIds.has(post.id)}
                      liked={socialFeed.likedPostIds.has(post.id)}
                      currentUserId={user.uid}
                      statusLabel={
                        post.publicationType === 'status'
                          ? remainingStatusLabel(post, now)
                          : undefined
                      }
                      onToggleSave={
                        post.publicationType === 'status'
                          ? undefined
                          : () => void toggleSavedPost(post.id)
                      }
                      onToggleLike={() => handleLike(post.id)}
                      onReport={() => void reportPost(post)}
                    />
                  ))}
                {!socialFeed.loading && squarePosts.length === 0 && (
                  <EmptyState
                    title="A Praça está começando"
                    description="Somente conteúdos enviados para a Praça aparecerão aqui."
                    icon={Compass}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {savedOpen && (
        <div className="fixed inset-0 z-[132] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase text-amber-300">
                  Privado
                </span>
                <h3 className="text-base font-black text-white">
                  Publicações salvas
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSavedOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar publicações salvas"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {savedPosts.map(post => (
                <SocialCard
                  key={post.id}
                  post={post}
                  saved
                  liked={socialFeed.likedPostIds.has(post.id)}
                  currentUserId={user.uid}
                  onToggleSave={() => void toggleSavedPost(post.id)}
                  onToggleLike={() => handleLike(post.id)}
                  onReport={() => void reportPost(post)}
                />
              ))}
              {savedPosts.length === 0 && (
                <EmptyState
                  title="Nenhuma publicação salva"
                  description="Use o ícone de marcador ao lado dos três pontos para guardar uma publicação. Status não podem ser salvos."
                  icon={Bookmark}
                />
              )}
            </div>
          </section>
        </div>
      )}

      {marketplaceOpen && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-orange-400">
                  Ofertas
                </span>
                <h3 className="text-base font-black text-white">
                  Lojas para descobrir e consumir
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMarketplaceOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500"
                aria-label="Fechar Ofertas"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  value={storeSearch}
                  onChange={event => setStoreSearch(event.target.value)}
                  placeholder="Buscar lojas, produtos ou categorias..."
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-3 pl-10 pr-3 text-xs text-white outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {stores
                  .filter(
                    store =>
                      !storeSearch.trim() ||
                      `${store.name} ${store.description} ${store.keywords.join(
                        ' '
                      )}`
                        .toLocaleLowerCase('pt-BR')
                        .includes(
                          storeSearch.trim().toLocaleLowerCase('pt-BR')
                        )
                  )
                  .map(store => {
                    const cover = store.offerImages[0] || store.banner;
                    const momentsCount = storeMoments.filter(
                      moment => moment.storeId === store.id
                    ).length;
                    return (
                      <article
                        key={store.id}
                        className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
                      >
                        <div className="relative aspect-[4/3] bg-slate-950">
                          <button
                            type="button"
                            onClick={() => openStore(store)}
                            className="absolute inset-0 block h-full w-full"
                            aria-label={`Entrar na loja ${store.name}`}
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt={store.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <StoreIcon className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-slate-700" />
                            )}
                          </button>
                          <div className="absolute left-3 top-3 flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 shadow-xl backdrop-blur-md">
                            {store.logo ? (
                              <img
                                src={store.logo}
                                alt={`Ícone da loja ${store.name}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <StoreIcon className="h-5 w-5 text-slate-400" />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleFavoriteStore(store.id)}
                            className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border shadow-xl backdrop-blur-md ${
                              favoriteStoreIds.has(store.id)
                                ? 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                                : 'border-white/15 bg-slate-950/85 text-white'
                            }`}
                            aria-label="Favoritar loja"
                          >
                            <Heart
                              className={`h-4 w-4 ${
                                favoriteStoreIds.has(store.id)
                                  ? 'fill-current'
                                  : ''
                              }`}
                            />
                          </button>
                        </div>
                        <div className="p-3">
                          <h4 className="truncate text-[11px] font-black uppercase text-white">
                            {store.name}
                          </h4>
                          <span
                            className={`text-[8px] font-black uppercase ${
                              store.status === 'open'
                                ? 'text-emerald-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {store.status === 'open'
                              ? 'Aberta'
                              : 'Consultar horário'}
                          </span>
                          <p className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
                            {store.description || 'Conheça a vitrine desta loja.'}
                          </p>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-slate-800 p-2">
                          <button
                            type="button"
                            onClick={() => openStore(store)}
                            className="rounded-xl bg-orange-500 py-2 text-[9px] font-black uppercase text-slate-950"
                          >
                            Entrar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMomentStore(store);
                              setMomentContent('');
                              setMomentRating(5);
                              setMomentMediaUrl('');
                            }}
                            className="relative flex h-9 w-11 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-300"
                            aria-label={`Abrir Momentos de ${store.name}`}
                            title="Momentos da loja e dos produtos"
                          >
                            <MessageCircle className="h-4 w-4" />
                            {momentsCount > 0 && (
                              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-violet-400 px-1 text-center text-[7px] font-black text-slate-950">
                                {momentsCount}
                              </span>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {stores.length === 0 && (
                <EmptyState
                  title="O marketplace está sendo formado"
                  description="As lojas aparecerão aqui quando publicarem suas vitrines no Kyrub."
                  icon={ShoppingBag}
                />
              )}
            </div>
          </section>
        </div>
      )}

      {momentStore && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  src={momentStore.logo}
                  name={momentStore.name}
                  className="h-10 w-10 rounded-xl object-cover"
                />
                <div className="min-w-0">
                  <span className="text-[8px] font-black uppercase text-violet-300">
                    Momentos · avaliações da loja e produtos
                  </span>
                  <h3 className="truncate text-base font-black text-white">
                    {momentStore.name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMomentStore(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar Momentos"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-3">
                {storeMoments
                  .filter(moment => moment.storeId === momentStore.id)
                  .sort(
                    (left, right) =>
                      Date.parse(right.createdAtIso) -
                      Date.parse(left.createdAtIso)
                  )
                  .map(moment => (
                    <article
                      key={moment.id}
                      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar
                          src={moment.userAvatar}
                          name={moment.userName}
                          className="h-9 w-9 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-[10px] font-black text-white">
                            {moment.userName}
                          </h4>
                          <span className="text-[9px] text-amber-400">
                            {'★'.repeat(moment.rating)}
                            {'☆'.repeat(5 - moment.rating)}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-slate-300">
                        {moment.content}
                      </p>
                      {moment.mediaUrl && (
                        <img
                          src={moment.mediaUrl}
                          alt="Imagem vinculada ao Momento"
                          className="max-h-48 w-full rounded-xl object-cover"
                        />
                      )}
                    </article>
                  ))}
                {storeMoments.filter(
                  moment => moment.storeId === momentStore.id
                ).length === 0 && (
                  <EmptyState
                    title="Nenhum Momento ainda"
                    description="Compartilhe a primeira avaliação real desta loja ou de um produto."
                    icon={MessageCircle}
                  />
                )}
              </div>

              <form
                onSubmit={publishMoment}
                className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4"
              >
                <div>
                  <h4 className="text-[10px] font-black uppercase text-white">
                    Publicar meu Momento
                  </h4>
                  <p className="mt-1 text-[8px] text-slate-500">
                    Avalie sua experiência com a loja ou com um produto dela.
                  </p>
                </div>
                <textarea
                  value={momentContent}
                  onChange={event =>
                    setMomentContent(event.target.value.slice(0, 1500))
                  }
                  rows={3}
                  required
                  placeholder="Conte como foi sua experiência..."
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs text-white outline-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-black uppercase text-slate-500">
                    Avaliação
                  </span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMomentRating(value)}
                        className={`text-lg ${
                          value <= momentRating
                            ? 'text-amber-400'
                            : 'text-slate-700'
                        }`}
                        aria-label={`${value} estrelas`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                {momentStore.offerImages.length > 0 && (
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500">
                      Imagem da vitrine, opcional
                    </span>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {momentStore.offerImages.slice(0, 8).map(image => (
                        <button
                          key={image}
                          type="button"
                          onClick={() =>
                            setMomentMediaUrl(current =>
                              current === image ? '' : image
                            )
                          }
                          className={`aspect-square overflow-hidden rounded-xl border-2 ${
                            momentMediaUrl === image
                              ? 'border-orange-500'
                              : 'border-transparent'
                          }`}
                        >
                          <img
                            src={image}
                            alt="Imagem da vitrine"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <input
                    type="checkbox"
                    checked={momentShareToSquare}
                    onChange={event =>
                      setMomentShareToSquare(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 accent-orange-500"
                  />
                  <span>
                    <strong className="block text-[9px] font-black uppercase text-slate-200">
                      Compartilhar na Praça
                    </strong>
                    <span className="text-[8px] text-slate-500">
                      Cria também uma publicação pública com esta avaliação.
                    </span>
                  </span>
                </label>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-violet-500 py-3 text-[9px] font-black uppercase text-white"
                >
                  Publicar Momento
                </button>
              </form>
            </div>
          </section>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-[135] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-md space-y-4 rounded-t-3xl border border-slate-800 bg-slate-900 p-5 sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-orange-400">
                  Editar perfil
                </span>
                <h3 className="text-base font-black text-white">
                  Identidade pública
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Avatar
                src={profile.photoUrl}
                name={profile.name}
                className="h-16 w-16 rounded-full border-2 border-orange-500 object-cover"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl bg-orange-500 px-3 py-2 text-[9px] font-black uppercase text-slate-950"
                >
                  Galeria
                </button>
                <button
                  type="button"
                  onClick={restoreGooglePhoto}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[9px] font-black uppercase text-slate-300"
                >
                  Foto Google
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={uploadProfilePhoto}
              />
            </div>
            <label className="block text-[9px] font-black uppercase text-slate-500">
              Nome
              <input
                value={draftName}
                onChange={event => setDraftName(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs normal-case text-white outline-none"
              />
            </label>
            <label className="block text-[9px] font-black uppercase text-slate-500">
              Breve apresentação
              <textarea
                value={draftBio}
                onChange={event =>
                  setDraftBio(event.target.value.slice(0, 280))
                }
                rows={4}
                className="mt-1.5 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs normal-case text-white outline-none"
              />
              <span className="mt-1 block text-right font-mono text-[8px] text-slate-600">
                {draftBio.length}/280
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-950 py-3 text-[9px] font-black uppercase text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveProfile()}
                className="rounded-xl bg-emerald-500 py-3 text-[9px] font-black uppercase text-slate-950"
              >
                Salvar
              </button>
            </div>
          </section>
        </div>
      )}

      {chatTarget && (
        <div className="fixed inset-0 z-[135] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-sm rounded-t-3xl border border-slate-800 bg-slate-900 p-5 sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-orange-400">
                  Conversa
                </span>
                <h3 className="text-base font-black text-white">
                  {chatTarget.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setChatTarget(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-[10px] leading-relaxed text-slate-500">
              A conversa segura continua disponível pelo chat social do Kyrub.
              Esta central mantém o contato selecionado e a gestão da conexão no
              mesmo perfil.
            </p>
          </section>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 z-[150] -translate-x-1/2 rounded-2xl border px-4 py-3 text-[10px] font-bold shadow-2xl ${
            toast.type === 'error'
              ? 'border-red-500/30 bg-red-950 text-red-200'
              : toast.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-950 text-emerald-200'
                : 'border-slate-700 bg-slate-900 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>,
    document.body
  );
}
