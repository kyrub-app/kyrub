import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  FileBadge,
  Fingerprint,
  MessageCircle,
  Pencil,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import type { SocialPost, Store } from '../types';
import { identityVerificationEnabled } from '../utils/featureFlags';
import { auth, db } from '../utils/firebase';
import { IDENTITY_VERIFICATION_OPEN_EVENT } from '../utils/identityVerification';
import { MomentsModal } from './modals/MomentsModal';

type StoreMoment = {
  id: string;
  storeId: string;
  user: string;
  avatar: string;
  content: string;
  rating: number;
  mediaUrl?: string;
  createdAt: string;
  publishedToFeed: boolean;
};

type ReviewPortal = {
  key: string;
  target: HTMLElement;
  store: Store;
};

type VerificationShortcut = {
  id: 'profile' | 'documents' | 'biometrics' | 'facial';
  label: string;
  verificationLabel?: 'Documentos' | 'Segurança' | 'Validação';
  icon: ComponentType<{ className?: string }>;
};

const MOMENTS_STORAGE_KEY = 'kyrub_momentos';
const LEGACY_POSTS_KEY = 'kyrub_posts';
const getUserPostsKey = (uid: string) => `kyrub_posts_${uid}`;

const verificationShortcuts: VerificationShortcut[] = [
  { id: 'profile', label: 'Perfil', icon: Pencil },
  {
    id: 'documents',
    label: 'Documentos',
    verificationLabel: 'Documentos',
    icon: FileBadge,
  },
  {
    id: 'biometrics',
    label: 'Biometria',
    verificationLabel: 'Segurança',
    icon: Fingerprint,
  },
  {
    id: 'facial',
    label: 'Validação facial',
    verificationLabel: 'Validação',
    icon: Camera,
  },
];

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

const readStoredMoments = (): StoreMoment[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOMENTS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as StoreMoment[]) : [];
  } catch {
    return [];
  }
};

const readStoredPosts = (rawValue: string | null): SocialPost[] => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as SocialPost[]) : [];
  } catch {
    return [];
  }
};

const storeFromDocument = (
  id: string,
  data: Record<string, unknown>
): Store | null => {
  if (data.publicationStatus !== 'published') return null;
  const name = readString(data.name);
  if (!name) return null;

  const status =
    data.status === 'open' ||
    data.status === 'delayed' ||
    data.status === 'closed'
      ? data.status
      : 'closed';

  return {
    id: readString(data.id) || id,
    name,
    slug: readString(data.slug),
    description: readString(data.description),
    logo: readString(data.logo),
    banner: readString(data.banner),
    primaryColor: readString(data.primaryColor),
    plan: data.plan === 'business' ? 'business' : 'free',
    ownerEmail: '',
    address: readString(data.address),
    contact: '',
    keywords: readStringList(data.keywords),
    offerImages: readStringList(data.offerImages),
    status,
  };
};

const sameReviewPortals = (
  current: ReviewPortal[],
  next: ReviewPortal[]
): boolean =>
  current.length === next.length &&
  current.every(
    (item, index) =>
      item.target === next[index]?.target &&
      item.store.id === next[index]?.store.id
  );

const persistLocalPost = (user: User, post: SocialPost) => {
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

const findVerificationModal = (): HTMLElement | null => {
  const heading = [...document.querySelectorAll<HTMLElement>('h2')].find(
    item => item.textContent?.trim() === 'Verificação e segurança'
  );
  return heading?.closest('section') ?? null;
};

const activateVerificationTab = (
  label: 'Documentos' | 'Segurança' | 'Validação',
  attempt = 0
) => {
  const modal = findVerificationModal();
  const targetButton = modal
    ? [...modal.querySelectorAll<HTMLButtonElement>('button')].find(
        button => button.textContent?.trim() === label
      )
    : undefined;

  if (targetButton) {
    targetButton.click();
    return;
  }

  if (attempt < 20) {
    window.setTimeout(() => activateVerificationTab(label, attempt + 1), 50);
  }
};

export function ProfileRecoveredActionsBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profileName, setProfileName] = useState(
    auth.currentUser?.displayName ?? ''
  );
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(
    auth.currentUser?.photoURL ?? ''
  );
  const [stores, setStores] = useState<Store[]>([]);
  const [moments, setMoments] = useState<StoreMoment[]>(readStoredMoments);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [reviewPortals, setReviewPortals] = useState<ReviewPortal[]>([]);
  const [editTabsTarget, setEditTabsTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let unsubscribeStores = () => undefined;
    let unsubscribeProfile = () => undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, nextUser => {
      unsubscribeStores();
      unsubscribeProfile();
      unsubscribeStores = () => undefined;
      unsubscribeProfile = () => undefined;
      setUser(nextUser);
      setStores([]);

      if (!nextUser) {
        setProfileName('');
        setProfilePhotoUrl('');
        setSelectedStore(null);
        return;
      }

      setProfileName(nextUser.displayName ?? '');
      setProfilePhotoUrl(nextUser.photoURL ?? '');

      unsubscribeProfile = onSnapshot(
        doc(db, 'users', nextUser.uid),
        snapshot => {
          const data = snapshot.data() as Record<string, unknown> | undefined;
          setProfileName(
            readString(data?.name) ||
              nextUser.displayName ||
              nextUser.email?.split('@')[0] ||
              'Usuário Kyrub'
          );
          setProfilePhotoUrl(
            readString(data?.photoUrl) || nextUser.photoURL || ''
          );
        },
        () => undefined
      );

      unsubscribeStores = onSnapshot(
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
    });

    return () => {
      unsubscribeAuth();
      unsubscribeStores();
      unsubscribeProfile();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(MOMENTS_STORAGE_KEY, JSON.stringify(moments));
  }, [moments]);

  const storesByName = useMemo(() => {
    const next = new Map<string, Store>();
    for (const store of stores) next.set(normalizeName(store.name), store);
    return next;
  }, [stores]);

  useEffect(() => {
    const synchronizeTargets = () => {
      const offersHeading = [...document.querySelectorAll<HTMLElement>('h3')]
        .find(
          item =>
            item.textContent?.trim() === 'Lojas para descobrir e consumir'
        );
      const offersSection = offersHeading?.closest('section');
      const nextReviewPortals: ReviewPortal[] = [];

      if (offersSection) {
        offersSection.querySelectorAll<HTMLElement>('article').forEach(card => {
          const heading = card.querySelector<HTMLElement>('h4');
          const enterButton = [...card.querySelectorAll<HTMLButtonElement>('button')]
            .find(button => button.textContent?.trim() === 'Entrar');
          const store = storesByName.get(normalizeName(heading?.textContent ?? ''));
          if (!heading || !enterButton || !store) return;

          card.style.position = 'relative';
          card.dataset.profileOfferReviewCard = 'true';
          enterButton.style.width = 'calc(100% - 4rem)';
          enterButton.dataset.profileOfferEnter = 'true';

          let target = card.querySelector<HTMLElement>(
            '[data-profile-offer-review-slot="true"]'
          );
          if (!target) {
            target = document.createElement('div');
            target.dataset.profileOfferReviewSlot = 'true';
            target.className = 'absolute bottom-2 right-2 z-10';
            card.appendChild(target);
          }

          nextReviewPortals.push({
            key: `${store.id}:${normalizeName(store.name)}`,
            target,
            store,
          });
        });
      }

      setReviewPortals(current =>
        sameReviewPortals(current, nextReviewPortals)
          ? current
          : nextReviewPortals
      );

      const editCloseButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Fechar edição"]'
      );
      const editForm = editCloseButton?.closest('form');
      let nextEditTarget: HTMLElement | null = null;

      if (editForm) {
        nextEditTarget = editForm.querySelector<HTMLElement>(
          '[data-profile-edit-security-tabs="true"]'
        );
        if (!nextEditTarget) {
          nextEditTarget = document.createElement('div');
          nextEditTarget.dataset.profileEditSecurityTabs = 'true';
          editForm.firstElementChild?.insertAdjacentElement(
            'afterend',
            nextEditTarget
          );
        }
      }

      setEditTabsTarget(current =>
        current === nextEditTarget ? current : nextEditTarget
      );
    };

    synchronizeTargets();
    const timer = window.setInterval(synchronizeTargets, 300);

    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-offer-review-slot="true"], [data-profile-edit-security-tabs="true"]'
        )
        .forEach(target => target.remove());
      document
        .querySelectorAll<HTMLElement>('[data-profile-offer-review-card="true"]')
        .forEach(card => {
          card.style.position = '';
          delete card.dataset.profileOfferReviewCard;
        });
      document
        .querySelectorAll<HTMLButtonElement>('[data-profile-offer-enter="true"]')
        .forEach(button => {
          button.style.width = '';
          delete button.dataset.profileOfferEnter;
        });
    };
  }, [storesByName]);

  const openVerification = (
    label: 'Documentos' | 'Segurança' | 'Validação'
  ) => {
    const closeEditButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar edição"]'
    );
    closeEditButton?.click();
    window.dispatchEvent(new CustomEvent(IDENTITY_VERIFICATION_OPEN_EVENT));
    activateVerificationTab(label);
  };

  const publishMoment = (data: {
    content: string;
    rating: number;
    mediaUrl: string;
    publishedToPraca: boolean;
  }) => {
    if (!user || !selectedStore) return;

    const id = `m-new-${Date.now()}`;
    const newMoment: StoreMoment = {
      id,
      storeId: selectedStore.id,
      user:
        profileName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'Usuário Kyrub',
      avatar: profilePhotoUrl || user.photoURL || '',
      content: data.content,
      rating: data.rating,
      mediaUrl: data.mediaUrl || undefined,
      createdAt: new Date().toLocaleString('pt-BR'),
      publishedToFeed: data.publishedToPraca,
    };

    setMoments(current => [newMoment, ...current]);

    if (data.publishedToPraca) {
      persistLocalPost(user, {
        id: `post-moment-${id}`,
        authorId: user.uid,
        user: newMoment.user,
        avatar: newMoment.avatar,
        time: 'Agora mesmo',
        createdAt: new Date().toISOString(),
        content: `Avaliou a loja ${selectedStore.name} com ${'★'.repeat(
          data.rating
        )}: “${data.content}”`,
        likes: 0,
        mediaUrls: data.mediaUrl ? [data.mediaUrl] : undefined,
        publicationType: 'feed',
        visibility: 'public',
      });
    }

    setSelectedStore(null);
  };

  return (
    <>
      <style>{`#moments-modal { z-index: 170 !important; }`}</style>

      {reviewPortals.map(item =>
        createPortal(
          <button
            type="button"
            onClick={() => setSelectedStore(item.store)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-slate-950 text-amber-300 shadow-lg transition-colors hover:bg-amber-500/10"
            aria-label={`Abrir avaliações da loja ${item.store.name}`}
            title={`Avaliações de ${item.store.name}`}
          >
            <MessageCircle className="h-4 w-4" />
          </button>,
          item.target,
          item.key
        )
      )}

      {editTabsTarget &&
        identityVerificationEnabled &&
        createPortal(
          <nav
            className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70 p-1"
            aria-label="Seções de edição e segurança"
          >
            <div className="grid min-w-[380px] grid-cols-4 gap-1">
              {verificationShortcuts.map(shortcut => {
                const Icon = shortcut.icon;
                const active = shortcut.id === 'profile';
                return (
                  <button
                    key={shortcut.id}
                    type="button"
                    onClick={() =>
                      shortcut.verificationLabel
                        ? openVerification(shortcut.verificationLabel)
                        : undefined
                    }
                    className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[8px] font-black uppercase ${
                      active
                        ? 'bg-orange-500 text-slate-950'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{shortcut.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>,
          editTabsTarget
        )}

      <MomentsModal
        isOpen={Boolean(selectedStore)}
        selectedStoreForMoments={selectedStore}
        onClose={() => setSelectedStore(null)}
        momentos={moments}
        onPublishMoment={publishMoment}
      />
    </>
  );
}
