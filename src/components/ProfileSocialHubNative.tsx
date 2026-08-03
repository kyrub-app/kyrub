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
  AtSign,
  Bookmark,
  Camera,
  Check,
  Clock3,
  Compass,
  EllipsisVertical,
  Flag,
  FolderPlus,
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
  Trash2,
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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { Friend, SocialPost } from '../types';
import { usePublicSocialFeed } from '../hooks/usePublicSocialFeed';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { buildPublicStorefrontPath } from '../utils/appRoutes';
import { auth, db, storage } from '../utils/firebase';
import { MediaCarousel } from './MediaCarousel';
import { ChatModal } from './modals/ChatModal';

type ProfileTab = 'publications' | 'marked' | 'connected' | 'square';
type ConnectionSection = 'connected' | 'favorites' | 'groups';
type NewConnectionsTab = 'requests' | 'suggestions';
type ToastType = 'success' | 'error' | 'info' | 'warning';

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
};

type ContactGroup = {
  id: string;
  groupId: string;
  ownerId: string;
  name: string;
  memberIds: string[];
};

type MarketplaceStore = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_STATUSES = 9;
const MAX_GROUPS = 30;
const MAX_GROUP_MEMBERS = 200;
const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;
const getGooglePhotoKey = (uid: string) => `kyrub_google_profile_photo_${uid}`;

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

const remainingStatusLabel = (
  post: ExtendedSocialPost,
  now: number
): string => {
  const remaining = Math.max(
    0,
    STATUS_TTL_MS - (now - postTimestamp(post))
  );
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
  return `${hours} h`;
};

const groupFromDocument = (
  id: string,
  data: Record<string, unknown>
): ContactGroup | null => {
  const ownerId = readString(data.ownerId);
  const name = readString(data.name);
  if (!ownerId || !name) return null;
  return {
    id,
    groupId: readString(data.groupId) || id,
    ownerId,
    name,
    memberIds: readStringList(data.memberIds),
  };
};

const storeFromDocument = (
  id: string,
  data: Record<string, unknown>
): MarketplaceStore | null => {
  if (data.publicationStatus !== 'published') return null;
  const name = readString(data.name);
  if (!name) return null;
  return {
    id: readString(data.id) || id,
    name,
    slug: readString(data.slug),
    description: readString(data.description),
    logo: readString(data.logo),
    banner: readString(data.banner),
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
      className={`${className} flex items-center justify-center bg-slate-900 text-lg font-black text-slate-500`}
      role="img"
      aria-label={`Foto de ${name || 'usuário'} não informada`}
    >
      {(name || '?').trim().charAt(0).toLocaleUpperCase('pt-BR')}
    </span>
  );
}

function EmptyState({
  title,
  description,
  icon: Icon = Users,
}: {
  title: string;
  description: string;
  icon?: typeof Users;
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
  currentUserId,
  saved,
  liked,
  now,
  onToggleSave,
  onToggleLike,
  onReport,
}: {
  post: ExtendedSocialPost;
  currentUserId: string;
  saved: boolean;
  liked: boolean;
  now: number;
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
        {isStatus && (
          <span className="flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[8px] font-black uppercase text-teal-300">
            <Clock3 className="h-3 w-3" />
            {remainingStatusLabel(post, now)}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {!isStatus && onToggleSave && (
            <button
              type="button"
              onClick={onToggleSave}
              className={`flex h-9 w-9 items-center justify-center rounded-full ${
                saved
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-amber-300'
              }`}
              aria-label={saved ? 'Remover dos salvos' : 'Salvar publicação'}
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

function ContactCard({
  friend,
  latestStatus,
  onFavorite,
  onChat,
  onRemove,
}: {
  friend: Friend;
  latestStatus?: ExtendedSocialPost;
  onFavorite: () => void;
  onChat: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
      <div className="relative">
        <Avatar
          src={latestStatus?.mediaUrls?.[0] || friend.avatar}
          name={friend.name}
          className="aspect-[4/3] w-full object-cover"
        />
        {latestStatus && (
          <span className="absolute bottom-2 left-2 rounded-full border border-teal-400/30 bg-slate-950/85 px-2 py-1 text-[8px] font-black uppercase text-teal-300 backdrop-blur">
            Status · {remainingStatusLabel(latestStatus, Date.now())}
          </span>
        )}
        <button
          type="button"
          onClick={onFavorite}
          className={`absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/80 backdrop-blur ${
            friend.favorited ? 'text-amber-300' : 'text-slate-400'
          }`}
          aria-label={
            friend.favorited ? 'Remover dos favoritos' : 'Favoritar contato'
          }
        >
          <Star className={`h-4 w-4 ${friend.favorited ? 'fill-current' : ''}`} />
        </button>
      </div>
      <div className="min-h-[72px] p-3">
        <h4 className="truncate text-xs font-black text-white">{friend.name}</h4>
        <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-slate-500">
          {latestStatus?.content || friend.bio || friend.role}
        </p>
      </div>
      <div className="mt-auto grid grid-cols-[1fr_42px] gap-2 border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={onChat}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-orange-500 px-2 text-[9px] font-black uppercase text-slate-950"
        >
          <MessageCircle className="h-4 w-4" />
          Chat
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 w-[42px] items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300"
          aria-label={`Remover ${friend.name}`}
        >
          <UserMinus className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

export function ProfileSocialHubNative() {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  const [newConnectionsOpen, setNewConnectionsOpen] = useState(false);
  const [newConnectionsTab, setNewConnectionsTab] =
    useState<NewConnectionsTab>('requests');
  const [activeTab, setActiveTab] = useState<ProfileTab>('publications');
  const [connectionSection, setConnectionSection] =
    useState<ConnectionSection>('connected');
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<ProfileState>({
    name: '',
    email: '',
    photoUrl: '',
    bio: '',
  });
  const [draftName, setDraftName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [postMediaUrls, setPostMediaUrls] = useState<string[]>([]);
  const [publishToStatus, setPublishToStatus] = useState(false);
  const [shareToSquare, setShareToSquare] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [selectedTaggedUserIds, setSelectedTaggedUserIds] = useState<string[]>(
    []
  );
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [stores, setStores] = useState<MarketplaceStore[]>([]);
  const [squareSearch, setSquareSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);
  const [chatTarget, setChatTarget] = useState<Friend | null>(null);
  const [chatMessageText, setChatMessageText] = useState('');
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
    return onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      if (!nextUser) {
        setOpen(false);
        return;
      }
      const storedGooglePhoto = localStorage.getItem(
        getGooglePhotoKey(nextUser.uid)
      );
      if (!storedGooglePhoto && nextUser.photoURL) {
        localStorage.setItem(getGooglePhotoKey(nextUser.uid), nextUser.photoURL);
      }
    });
  }, []);

  useEffect(() => {
    const handleProfileTrigger = (event: Event) => {
      const target = event.target as Element | null;
      const trigger = target?.closest('#header-user-profile-trigger');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(true);
    };

    document.addEventListener('click', handleProfileTrigger, true);
    return () => {
      document.removeEventListener('click', handleProfileTrigger, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setNewConnectionsOpen(false);
      return;
    }
    setDraftName(profile.name);
    setDraftBio(profile.bio);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (savedOpen) setSavedOpen(false);
      else if (offersOpen) setOffersOpen(false);
      else if (editOpen) setEditOpen(false);
      else if (newConnectionsOpen) setNewConnectionsOpen(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    editOpen,
    newConnectionsOpen,
    offersOpen,
    open,
    profile.bio,
    profile.name,
    savedOpen,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
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
      },
      () => setSavedPostIds(new Set())
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      collection(db, `users/${user.uid}/contact_groups`),
      snapshot => {
        setGroups(
          snapshot.docs
            .flatMap(item => {
              const group = groupFromDocument(
                item.id,
                item.data() as Record<string, unknown>
              );
              return group ? [group] : [];
            })
            .sort((left, right) =>
              left.name.localeCompare(right.name, 'pt-BR')
            )
        );
      },
      () => setGroups([])
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      collection(db, 'tenants'),
      snapshot => {
        setStores(
          snapshot.docs.flatMap(item => {
            const store = storeFromDocument(
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

  const markedPosts = useMemo(
    () =>
      allPosts.filter(
        post =>
          Boolean(user?.uid) &&
          post.taggedUserIds?.includes(user?.uid ?? '') &&
          (post.publicationType !== 'status' || isActiveStatus(post, now))
      ),
    [allPosts, now, user?.uid]
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

  const selectedTaggedFriends = useMemo(
    () =>
      directory.friends.filter(friend =>
        selectedTaggedUserIds.includes(friend.id)
      ),
    [directory.friends, selectedTaggedUserIds]
  );

  const connectedStatusByAuthor = useMemo(() => {
    const map = new Map<string, ExtendedSocialPost>();
    for (const status of activeStatuses) {
      if (status.authorId && !map.has(status.authorId)) {
        map.set(status.authorId, status);
      }
    }
    return map;
  }, [activeStatuses]);

  const persistLocalPosts = (posts: ExtendedSocialPost[]) => {
    if (!user) return;
    const key = getUserPostsKey(user.uid);
    const current = readStoredPosts(
      localStorage.getItem(key) ?? localStorage.getItem(LEGACY_POSTS_KEY)
    );
    const next = [
      ...posts,
      ...current.filter(
        item => !posts.some(newPost => newPost.id === item.id)
      ),
    ];
    localStorage.setItem(key, JSON.stringify(next));
    localStorage.setItem(LEGACY_POSTS_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('kyrub-social-posts-updated', {
        detail: { uid: user.uid, posts: next, source: 'local' },
      })
    );
  };

  const publish = () => {
    if (!user) return;
    if (!newPostText.trim() && postMediaUrls.length === 0) {
      triggerToast(
        'Escreva algo ou adicione uma imagem antes de publicar.',
        'info'
      );
      return;
    }
    if (publishToStatus && ownStatuses.length >= MAX_ACTIVE_STATUSES) {
      triggerToast(
        'Você já possui 9 status ativos. Aguarde um deles completar 24 horas.',
        'warning'
      );
      return;
    }

    const createdAt = new Date().toISOString();
    const identity = {
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
      taggedUsers: selectedTaggedFriends.map(friend => friend.name),
      taggedUserIds: selectedTaggedFriends.map(friend => friend.id),
    };

    const posts: ExtendedSocialPost[] = [
      {
        id: `feed-${Date.now()}`,
        ...identity,
        publicationType: 'feed',
        visibility: shareToSquare ? 'public' : 'private',
      },
    ];

    if (publishToStatus) {
      posts.push({
        id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...identity,
        publicationType: 'status',
        visibility: shareToSquare ? 'public' : 'connections',
      });
    }

    persistLocalPosts(posts);
    setNewPostText('');
    setPostMediaUrls([]);
    setSelectedTaggedUserIds([]);
    setTagPickerOpen(false);
    setPublishToStatus(false);
    setShareToSquare(false);
    triggerToast(
      publishToStatus
        ? 'Publicação criada e copiada para o Status por 24 horas.'
        : shareToSquare
          ? 'Publicação criada e enviada para a Praça.'
          : 'Publicação criada.',
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

  const toggleTaggedUser = (friendId: string) => {
    setSelectedTaggedUserIds(current =>
      current.includes(friendId)
        ? current.filter(id => id !== friendId)
        : [...current, friendId].slice(0, 30)
    );
  };

  const toggleSavedPost = async (postId: string) => {
    if (!user) return;

    const favoriteId =
      `social_${postId.replaceAll('/', '_')}`.slice(0, 500);

    const reference = doc(
      db,
      `users/${user.uid}/favorites/${favoriteId}`
    );

    const saving = !savedPostIds.has(postId);

    try {
      if (saving) {
        await setDoc(reference, {
          kind: 'social_post',
          postId,
          createdAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(reference);
      }

      window.dispatchEvent(
        new CustomEvent('kyrub-social-post-save-changed', {
          detail: {
            postId,
            saved: saving,
          },
        })
      );
    } catch {
      triggerToast(
        'Não foi possível atualizar os itens salvos.',
        'error'
      );
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
      triggerToast('Denúncia enviada para análise.', 'success');
    } catch {
      triggerToast('Não foi possível enviar a denúncia.', 'error');
    }
  };

  const handleLike = (postId: string) => {
    void socialFeed.toggleLike(postId).catch(() => {
      triggerToast('Não foi possível atualizar a curtida.', 'error');
    });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
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
    } catch {
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
    } catch {
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

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const name = groupNameDraft.trim().slice(0, 60);
    if (!name) return;
    if (groups.length >= MAX_GROUPS) {
      triggerToast('O limite é de 30 grupos por usuário.', 'warning');
      return;
    }
    setGroupBusy(true);
    try {
      const reference = doc(
        collection(db, `users/${user.uid}/contact_groups`)
      );
      await setDoc(reference, {
        groupId: reference.id,
        ownerId: user.uid,
        name,
        memberIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setGroupNameDraft('');
      triggerToast('Grupo criado.', 'success');
    } catch {
      triggerToast('Não foi possível criar o grupo.', 'error');
    } finally {
      setGroupBusy(false);
    }
  };

  const toggleGroupMember = async (
    group: ContactGroup,
    friendId: string
  ) => {
    if (!user) return;
    const memberIds = group.memberIds.includes(friendId)
      ? group.memberIds.filter(id => id !== friendId)
      : [...group.memberIds, friendId].slice(0, MAX_GROUP_MEMBERS);
    try {
      await updateDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`),
        {
          memberIds,
          updatedAt: serverTimestamp(),
        }
      );
    } catch {
      triggerToast('Não foi possível atualizar o grupo.', 'error');
    }
  };

  const deleteGroup = async (group: ContactGroup) => {
    if (!user) return;
    try {
      await deleteDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`)
      );
      triggerToast('Grupo removido.', 'info');
    } catch {
      triggerToast('Não foi possível remover o grupo.', 'error');
    }
  };

  const openStore = (store: MarketplaceStore) => {
    const path = buildPublicStorefrontPath(store.slug);
    if (!path) {
      triggerToast('Esta loja ainda não possui uma vitrine pública válida.', 'info');
      return;
    }
    window.location.assign(path);
  };

  if (!open || !user) return null;

  const tabs: Array<{ id: ProfileTab; label: string; count?: number }> = [
    { id: 'publications', label: 'Publicações', count: ownFeedPosts.length },
    { id: 'marked', label: 'Marcados', count: markedPosts.length },
    { id: 'connected', label: 'Conectados', count: directory.friends.length },
    { id: 'square', label: 'Praça' },
  ];

  const suggestionCount = directory.getSuggestions().length;
  const requestCount = directory.connectionRequests.length;
  const newConnectionsCount = suggestionCount + requestCount;

  const connectionTabs: Array<{
    id: ConnectionSection;
    label: string;
    count: number;
  }> = [
    {
      id: 'connected',
      label: 'Geral',
      count: directory.friends.length,
    },
    {
      id: 'favorites',
      label: 'Frequentes',
      count: directory.friends.filter(friend => friend.favorited).length,
    },
    {
      id: 'groups',
      label: 'Grupos',
      count: groups.length,
    },
  ];

  const openNewConnections = () => {
    setNewConnectionsTab(requestCount > 0 ? 'requests' : 'suggestions');
    setNewConnectionsOpen(true);
  };

  const renderPostList = (posts: ExtendedSocialPost[], empty: {
    title: string;
    description: string;
    icon?: typeof Users;
  }) => (
    <>
      {posts.map(post => (
        <SocialCard
          key={post.id}
          post={post}
          currentUserId={user.uid}
          saved={savedPostIds.has(post.id)}
          liked={socialFeed.likedPostIds.has(post.id)}
          now={now}
          onToggleSave={
            post.publicationType === 'status'
              ? undefined
              : () => void toggleSavedPost(post.id)
          }
          onToggleLike={() => handleLike(post.id)}
          onReport={() => void reportPost(post)}
        />
      ))}
      {posts.length === 0 && (
        <EmptyState
          title={empty.title}
          description={empty.description}
          icon={empty.icon}
        />
      )}
    </>
  );

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/92 backdrop-blur-md sm:items-center sm:p-4"
        id="profile-social-hub-modal"
      >
        <section className="flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl sm:h-auto sm:max-h-[96dvh] sm:rounded-3xl">
          <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3 sm:px-5">
            <div>
              <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-orange-400">
                Meu perfil
              </span>
              <h2 className="text-base font-black text-white">
                Painel pessoal
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500"
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
                    className="h-28 w-[90px] rounded-[22px] border-2 border-orange-500 object-cover sm:h-32 sm:w-[104px]"
                  />
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-950 bg-orange-500 text-slate-950"
                    aria-label="Editar perfil"
                  >
                    <Pencil className="h-4 w-4" />
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
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSavedOpen(true)}
                        className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300"
                        aria-label="Abrir publicações salvas"
                        title="Salvos"
                      >
                        <Bookmark className="h-5 w-5" />
                        {savedPosts.length > 0 && (
                          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-400 px-1 text-center text-[8px] font-black text-slate-950">
                            {savedPosts.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOffersOpen(true)}
                        className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/35 bg-orange-500/10 text-orange-300"
                        aria-label="Abrir Ofertas"
                        title="Ofertas"
                      >
                        <ShoppingBag className="h-5 w-5" />
                        {stores.length > 0 && (
                          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-500 px-1 text-center text-[8px] font-black text-slate-950">
                            {stores.length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-3 text-[10px] leading-relaxed text-slate-400">
                    {profile.bio ||
                      'Adicione uma breve apresentação para contar aos conectados quem você é.'}
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      ['Publicações', ownFeedPosts.length],
                      ['Status', ownStatuses.length],
                      ['Conectados', directory.friends.length],
                    ].map(([label, count]) => (
                      <div
                        key={String(label)}
                        className="rounded-2xl border border-slate-800 bg-slate-900/75 p-2 text-center"
                      >
                        <strong className="block text-sm text-white">
                          {count}
                        </strong>
                        <span className="text-[7px] font-black uppercase text-slate-500">
                          {label}
                        </span>
                      </div>
                    ))}
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

            <main className="space-y-4 p-4 sm:p-5">
              {activeTab === 'publications' && (
                <>
                  <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
                    <textarea
                      value={newPostText}
                      onChange={event =>
                        setNewPostText(event.target.value.slice(0, 3000))
                      }
                      rows={3}
                      placeholder="O que você quer publicar na sua linha do tempo?"
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
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index
                                  )
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
                              Somente pessoas da sua lista.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTagPickerOpen(false)}
                            className="text-slate-500"
                            aria-label="Fechar seleção"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="max-h-44 space-y-2 overflow-y-auto">
                          {directory.friends.map(friend => {
                            const selected = selectedTaggedUserIds.includes(
                              friend.id
                            );
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
                                {selected && (
                                  <Check className="h-4 w-4 text-teal-300" />
                                )}
                              </button>
                            );
                          })}
                          {directory.friends.length === 0 && (
                            <p className="py-4 text-center text-[9px] text-slate-600">
                              Você ainda não possui conectados para marcar.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3">
                        <input
                          type="checkbox"
                          checked={publishToStatus}
                          onChange={event =>
                            setPublishToStatus(event.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 accent-teal-500"
                        />
                        <span>
                          <strong className="block text-[9px] font-black uppercase text-teal-200">
                            Publicar no Status
                          </strong>
                          <span className="mt-0.5 block text-[8px] leading-relaxed text-slate-500">
                            Esta publicação também ficará visível nos seus
                            Status por 24 horas.
                          </span>
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3">
                        <input
                          type="checkbox"
                          checked={shareToSquare}
                          onChange={event =>
                            setShareToSquare(event.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 accent-orange-500"
                        />
                        <span>
                          <strong className="block text-[9px] font-black uppercase text-orange-200">
                            Enviar para a Praça
                          </strong>
                          <span className="mt-0.5 block text-[8px] leading-relaxed text-slate-500">
                            Compartilha a publicação no feed geral do Kyrub.
                          </span>
                        </span>
                      </label>
                    </div>

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
                          onClick={() =>
                            setTagPickerOpen(current => !current)
                          }
                          className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[9px] font-black uppercase ${
                            selectedTaggedUserIds.length > 0
                              ? 'border-teal-500/35 bg-teal-500/10 text-teal-300'
                              : 'border-slate-800 bg-slate-950 text-slate-400'
                          }`}
                        >
                          <UserPlus className="h-4 w-4" />
                          Marcar {selectedTaggedUserIds.length || ''}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={publish}
                        className="flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 text-[9px] font-black uppercase text-slate-950"
                      >
                        <Send className="h-4 w-4" />
                        Publicar
                      </button>
                    </div>
                  </section>

                  {ownStatuses.length > 0 && (
                    <section className="space-y-3 rounded-3xl border border-teal-500/20 bg-teal-500/5 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-[10px] font-black uppercase text-teal-200">
                            Seus Status ativos
                          </h3>
                          <p className="text-[8px] text-slate-500">
                            Até 9 publicações temporárias por 24 horas.
                          </p>
                        </div>
                        <span className="rounded-full bg-teal-500/15 px-2 py-1 text-[9px] font-black text-teal-300">
                          {ownStatuses.length}/9
                        </span>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {ownStatuses.map(status => (
                          <article
                            key={status.id}
                            className="w-44 shrink-0 overflow-hidden rounded-2xl border border-teal-500/20 bg-slate-950"
                          >
                            {status.mediaUrls?.[0] ? (
                              <img
                                src={status.mediaUrls[0]}
                                alt="Status"
                                className="aspect-[4/3] w-full object-cover"
                              />
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center p-3 text-center text-[10px] text-slate-300">
                                {status.content || 'Status'}
                              </div>
                            )}
                            <div className="flex items-center justify-between px-3 py-2 text-[8px] text-teal-300">
                              <span>Status</span>
                              <span>{remainingStatusLabel(status, now)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {renderPostList(ownFeedPosts, {
                    title: 'Nenhuma publicação',
                    description:
                      'Suas publicações permanentes aparecerão aqui.',
                  })}
                </>
              )}

              {activeTab === 'marked' && (
                <>
                  <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3">
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase text-teal-300">
                      <AtSign className="h-4 w-4" />
                      Marcaram você
                    </div>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                      Publicações e Status em que pessoas conectadas incluíram
                      seu perfil.
                    </p>
                  </div>
                  {renderPostList(markedPosts, {
                    title: 'Nenhuma marcação',
                    description:
                      'Quando alguém conectado marcar você, o conteúdo aparecerá aqui.',
                    icon: AtSign,
                  })}
                </>
              )}

              {activeTab === 'connected' && (
                <div className="space-y-4">
                  <nav
                    className="grid grid-cols-4 gap-2"
                    aria-label="Seções de conectados"
                  >
                    {connectionTabs.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setConnectionSection(item.id)}
                        className={`min-w-0 rounded-2xl border p-3 text-center ${
                          connectionSection === item.id
                            ? 'border-teal-500/40 bg-teal-500/10'
                            : 'border-slate-800 bg-slate-900'
                        }`}
                      >
                        <strong className="block text-sm text-white">
                          {item.count}
                        </strong>
                        <span className="mt-1 block truncate text-[8px] font-black uppercase text-slate-500">
                          {item.label}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={openNewConnections}
                      className="relative min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-center"
                      aria-label="Abrir novas conexões"
                    >
                      <strong className="block text-sm text-white">
                        {newConnectionsCount}
                      </strong>
                      <span className="mt-1 block truncate text-[8px] font-black uppercase text-slate-500">
                        Novos
                      </span>
                      {requestCount > 0 && (
                        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-orange-500 px-1 text-center text-[8px] font-black text-slate-950">
                          {requestCount}
                        </span>
                      )}
                    </button>
                  </nav>

                  {connectionSection === 'connected' && (
                    <div className="grid grid-cols-2 gap-3">
                      {directory.friends.map(friend => (
                        <ContactCard
                          key={friend.id}
                          friend={friend}
                          latestStatus={connectedStatusByAuthor.get(friend.id)}
                          onFavorite={() =>
                            directory.handleToggleFavoriteFriend(friend.id)
                          }
                          onChat={() => {
                            setChatMessageText('');
                            setChatTarget(friend);
                          }}
                          onRemove={() =>
                            void directory.handleToggleFriend(friend.id)
                          }
                        />
                      ))}
                      {directory.friends.length === 0 && (
                        <div className="col-span-2">
                          <EmptyState
                            title="Nenhuma conexão"
                            description="Aceite solicitações ou encontre pessoas nas sugestões."
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {connectionSection === 'favorites' && (
                    <div className="grid grid-cols-2 gap-3">
                      {directory.friends
                        .filter(friend => friend.favorited)
                        .map(friend => (
                          <ContactCard
                            key={friend.id}
                            friend={friend}
                            latestStatus={connectedStatusByAuthor.get(friend.id)}
                            onFavorite={() =>
                              directory.handleToggleFavoriteFriend(friend.id)
                            }
                            onChat={() => {
                              setChatMessageText('');
                              setChatTarget(friend);
                            }}
                            onRemove={() =>
                              void directory.handleToggleFriend(friend.id)
                            }
                          />
                        ))}
                      {directory.friends.filter(friend => friend.favorited)
                        .length === 0 && (
                        <div className="col-span-2">
                          <EmptyState
                            title="Nenhum favorito"
                            description="Use a estrela nos contatos para criar sua lista de favoritos."
                            icon={Star}
                          />
                        </div>
                      )}
                    </div>
                  )}


                  {connectionSection === 'groups' && (
                    <div className="space-y-4">
                      <form
                        onSubmit={createGroup}
                        className="flex gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3"
                      >
                        <input
                          value={groupNameDraft}
                          onChange={event =>
                            setGroupNameDraft(event.target.value.slice(0, 60))
                          }
                          placeholder="Nome do novo grupo"
                          className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs text-white outline-none"
                        />
                        <button
                          type="submit"
                          disabled={groupBusy || !groupNameDraft.trim()}
                          className="flex h-10 items-center gap-2 rounded-xl bg-violet-500 px-3 text-[9px] font-black uppercase text-white disabled:opacity-50"
                        >
                          {groupBusy ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <FolderPlus className="h-4 w-4" />
                          )}
                          Criar
                        </button>
                      </form>

                      {groups.map(group => (
                        <section
                          key={group.id}
                          className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-xs font-black text-white">
                                {group.name}
                              </h4>
                              <p className="text-[8px] text-slate-500">
                                {group.memberIds.length} de {MAX_GROUP_MEMBERS}{' '}
                                pessoas
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void deleteGroup(group)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300"
                              aria-label={`Excluir grupo ${group.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {directory.friends.map(friend => {
                              const selected = group.memberIds.includes(
                                friend.id
                              );
                              return (
                                <button
                                  key={friend.id}
                                  type="button"
                                  onClick={() =>
                                    void toggleGroupMember(group, friend.id)
                                  }
                                  className={`flex items-center gap-3 rounded-xl border p-2.5 text-left ${
                                    selected
                                      ? 'border-violet-500/40 bg-violet-500/10'
                                      : 'border-slate-800 bg-slate-950'
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
                                  {selected && (
                                    <Check className="h-4 w-4 text-violet-300" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}

                      {groups.length === 0 && (
                        <EmptyState
                          title="Nenhum grupo"
                          description="Crie grupos para organizar seus contatos sem alterar as conexões."
                          icon={FolderPlus}
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
                  {renderPostList(
                    squarePosts.filter(
                      post =>
                        !squareSearch.trim() ||
                        `${post.user} ${post.content}`
                          .toLocaleLowerCase('pt-BR')
                          .includes(
                            squareSearch
                              .trim()
                              .toLocaleLowerCase('pt-BR')
                          )
                    ),
                    {
                      title: 'A Praça está começando',
                      description:
                        'Somente conteúdos enviados para a Praça aparecerão aqui.',
                      icon: Compass,
                    }
                  )}
                </div>
              )}
            </main>
          </div>
        </section>
      </div>


      {newConnectionsOpen && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-900 px-4 py-3">
              <div>
                <span className="text-[9px] font-black uppercase tracking-wider text-teal-300">
                  Conectados
                </span>
                <h3 className="text-base font-black text-white">
                  Novos contatos
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNewConnectionsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar novos contatos"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <nav
              className="grid grid-cols-2 gap-2 border-b border-slate-900 p-3"
              aria-label="Tipos de novos contatos"
            >
              <button
                type="button"
                onClick={() => setNewConnectionsTab('requests')}
                className={`relative rounded-2xl border px-3 py-3 text-[9px] font-black uppercase ${
                  newConnectionsTab === 'requests'
                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                    : 'border-slate-800 bg-slate-900 text-slate-500'
                }`}
              >
                Solicitações {requestCount}
                {requestCount > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setNewConnectionsTab('suggestions')}
                className={`rounded-2xl border px-3 py-3 text-[9px] font-black uppercase ${
                  newConnectionsTab === 'suggestions'
                    ? 'border-teal-500/40 bg-teal-500/10 text-teal-200'
                    : 'border-slate-800 bg-slate-900 text-slate-500'
                }`}
              >
                Sugestões {suggestionCount}
              </button>
            </nav>

            <div className="flex-1 overflow-y-auto p-4">
              {newConnectionsTab === 'requests' && (
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
                          className="h-11 w-11 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
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

              {newConnectionsTab === 'suggestions' && (
                <div className="grid grid-cols-2 gap-3">
                  {directory.getSuggestions().map(friend => (
                    <article
                      key={friend.id}
                      className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
                    >
                      <Avatar
                        src={friend.avatar}
                        name={friend.name}
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <div className="min-h-[72px] p-3">
                        <h4 className="truncate text-xs font-black text-white">
                          {friend.name}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-[9px] text-slate-500">
                          {friend.bio || friend.role}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void directory.handleToggleFriend(friend.id)
                        }
                        className="m-2 mt-auto flex h-10 items-center justify-center gap-2 rounded-xl bg-teal-500 px-2 text-[9px] font-black uppercase text-slate-950"
                      >
                        <UserPlus className="h-4 w-4" />
                        {friend.connectionStatus === 'pending_sent'
                          ? 'Cancelar'
                          : 'Conectar'}
                      </button>
                    </article>
                  ))}
                  {directory.getSuggestions().length === 0 && (
                    <div className="col-span-2">
                      <EmptyState
                        title="Sem sugestões"
                        description="Novos perfis públicos aparecerão aqui."
                        icon={UserPlus}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-[132] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <form
            onSubmit={saveProfile}
            className="w-full max-w-md space-y-4 rounded-t-3xl border border-slate-800 bg-slate-950 p-4 sm:rounded-3xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-orange-400">
                  Meu perfil
                </span>
                <h3 className="text-base font-black text-white">
                  Editar perfil
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-slate-500"
                aria-label="Fechar edição"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-4">
              <Avatar
                src={profile.photoUrl}
                name={profile.name}
                className="h-28 w-[90px] rounded-[22px] border border-slate-800 object-cover"
              />
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                  className="flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-[9px] font-black uppercase text-slate-950"
                >
                  {photoBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  Galeria
                </button>
                <button
                  type="button"
                  onClick={() => void restoreGooglePhoto()}
                  className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[9px] font-black uppercase text-slate-300"
                >
                  Foto do Google
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={uploadProfilePhoto}
                />
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase text-slate-500">
                Nome
              </span>
              <input
                value={draftName}
                onChange={event => setDraftName(event.target.value.slice(0, 80))}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-white outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[9px] font-black uppercase text-slate-500">
                Bio
              </span>
              <textarea
                value={draftBio}
                onChange={event => setDraftBio(event.target.value.slice(0, 280))}
                rows={4}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-white outline-none"
              />
              <span className="mt-1 block text-right text-[8px] text-slate-600">
                {draftBio.length}/280
              </span>
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-orange-500 py-3 text-[10px] font-black uppercase text-slate-950"
            >
              Salvar perfil
            </button>
          </form>
        </div>
      )}

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
              {renderPostList(savedPosts, {
                title: 'Nenhuma publicação salva',
                description:
                  'Use o marcador nas publicações para guardá-las aqui.',
                icon: Bookmark,
              })}
            </div>
          </section>
        </div>
      )}

      {offersOpen && (
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
                onClick={() => setOffersOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-500"
                aria-label="Fechar Ofertas"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  value={storeSearch}
                  onChange={event => setStoreSearch(event.target.value)}
                  placeholder="Buscar lojas..."
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-3 pl-10 pr-3 text-xs text-white outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {stores
                  .filter(
                    store =>
                      !storeSearch.trim() ||
                      `${store.name} ${store.description}`
                        .toLocaleLowerCase('pt-BR')
                        .includes(
                          storeSearch.trim().toLocaleLowerCase('pt-BR')
                        )
                  )
                  .map(store => (
                    <article
                      key={store.id}
                      className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"
                    >
                      <div className="relative aspect-[4/3] bg-slate-950">
                        {store.banner ? (
                          <img
                            src={store.banner}
                            alt={store.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <StoreIcon className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-slate-700" />
                        )}
                        <div className="absolute left-3 top-3 flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90">
                          {store.logo ? (
                            <img
                              src={store.logo}
                              alt={store.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <StoreIcon className="h-5 w-5 text-slate-400" />
                          )}
                        </div>
                      </div>
                      <div className="p-3">
                        <h4 className="truncate text-[11px] font-black uppercase text-white">
                          {store.name}
                        </h4>
                        <p className="mt-2 line-clamp-2 text-[9px] text-slate-500">
                          {store.description || 'Conheça esta vitrine.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openStore(store)}
                        className="m-2 mt-0 w-[calc(100%-1rem)] rounded-xl bg-orange-500 py-2 text-[9px] font-black uppercase text-slate-950"
                      >
                        Entrar
                      </button>
                    </article>
                  ))}
              </div>
              {stores.length === 0 && (
                <EmptyState
                  title="O marketplace está sendo formado"
                  description="As lojas aparecerão aqui quando publicarem suas vitrines."
                  icon={ShoppingBag}
                />
              )}
            </div>
          </section>
        </div>
      )}

      <ChatModal
        isOpen={Boolean(chatTarget)}
        onClose={() => setChatTarget(null)}
        selectedChatUser={chatTarget}
        setSelectedChatUser={setChatTarget}
        chatMessageText={chatMessageText}
        setChatMessageText={setChatMessageText}
      />

      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 z-[180] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border px-4 py-3 text-[10px] font-bold shadow-2xl ${
            toast.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-950 text-emerald-100'
              : toast.type === 'error'
                ? 'border-red-500/30 bg-red-950 text-red-100'
                : toast.type === 'warning'
                  ? 'border-amber-500/30 bg-amber-950 text-amber-100'
                  : 'border-slate-700 bg-slate-900 text-slate-200'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>,
    document.body
  );
}
