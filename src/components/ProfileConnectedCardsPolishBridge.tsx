import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Clock3,
  EllipsisVertical,
  Flag,
  FolderPlus,
  LoaderCircle,
  MessageCircle,
  UserMinus,
  UserRound,
  X,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { SocialPost } from '../types';
import { usePublicSocialFeed } from '../hooks/usePublicSocialFeed';
import { auth, db } from '../utils/firebase';

type StatusPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  createdAt?: string;
  mediaUrls?: string[];
};

type DirectoryUser = {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  role: string;
};

type ContactGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

type ConnectedCardTarget = {
  key: string;
  card: HTMLElement;
  name: string;
  friendId: string;
  avatar: string;
  bio: string;
  role: string;
  groupLabel: string;
  status: StatusPost | null;
  statusLabel: string;
  menuButton: HTMLButtonElement;
  chatButton: HTMLButtonElement | null;
};

type SelectedContact = {
  target: ConnectedCardTarget;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const postTimestamp = (post: StatusPost): number => {
  const parsed = Date.parse(post.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const isActiveStatus = (post: StatusPost): boolean => {
  const timestamp = postTimestamp(post);
  return (
    post.publicationType === 'status' &&
    timestamp > 0 &&
    Date.now() - timestamp < STATUS_TTL_MS
  );
};

const remainingStatusLabel = (post: StatusPost): string => {
  const remaining = Math.max(
    0,
    STATUS_TTL_MS - (Date.now() - postTimestamp(post))
  );
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
  return `Status · ${hours} h`;
};

const findButtonByText = (
  root: ParentNode,
  text: string
): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    normalizeText(button.textContent).toLocaleLowerCase('pt-BR').includes(
      text.toLocaleLowerCase('pt-BR')
    )
  ) ?? null;

const groupLabelForFriend = (
  groups: ContactGroup[],
  friendId: string
): string => {
  if (!friendId) return '';
  const names = groups
    .filter(group => group.memberIds.includes(friendId))
    .map(group => group.name)
    .filter(Boolean);

  if (names.length === 0) return '';
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
};

const sameTargets = (
  current: ConnectedCardTarget[],
  next: ConnectedCardTarget[]
): boolean =>
  current.length === next.length &&
  current.every((item, index) => {
    const candidate = next[index];
    return (
      item.card === candidate?.card &&
      item.friendId === candidate?.friendId &&
      item.groupLabel === candidate?.groupLabel &&
      item.status?.id === candidate?.status?.id &&
      item.statusLabel === candidate?.statusLabel
    );
  });

const iconButtonClass =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400';

function ActionButton({
  icon: Icon,
  label,
  description,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left disabled:opacity-45 ${
        danger
          ? 'border-red-500/20 bg-red-500/10 text-red-200'
          : 'border-slate-800 bg-slate-900 text-slate-200'
      }`}
    >
      <span className={iconButtonClass}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-[10px] font-black uppercase">
          {label}
        </strong>
        <span className="mt-0.5 block text-[8px] leading-relaxed text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

export function ProfileConnectedCardsPolishBridge() {
  const socialFeed = usePublicSocialFeed();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [targets, setTargets] = useState<ConnectedCardTarget[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [menuContact, setMenuContact] =
    useState<SelectedContact | null>(null);
  const [profileContact, setProfileContact] =
    useState<SelectedContact | null>(null);
  const [statusContact, setStatusContact] =
    useState<SelectedContact | null>(null);
  const [removeContact, setRemoveContact] =
    useState<SelectedContact | null>(null);
  const [reportContact, setReportContact] =
    useState<SelectedContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const statusByAuthor = useMemo(() => {
    const map = new Map<string, StatusPost>();
    const statuses = (socialFeed.posts as StatusPost[])
      .filter(isActiveStatus)
      .sort((left, right) => postTimestamp(right) - postTimestamp(left));

    for (const status of statuses) {
      if (status.authorId && !map.has(status.authorId)) {
        map.set(status.authorId, status);
      }
    }

    return map;
  }, [socialFeed.posts]);

  useEffect(() => {
    let stopUsers: (() => void) | null = null;
    let stopGroups: (() => void) | null = null;

    const stopAuth = onAuthStateChanged(auth, user => {
      stopUsers?.();
      stopGroups?.();
      stopUsers = null;
      stopGroups = null;

      if (!user) {
        setUsers([]);
        setGroups([]);
        return;
      }

      stopUsers = onSnapshot(
        collection(db, 'users'),
        snapshot => {
          setUsers(
            snapshot.docs.map(item => {
              const data = item.data() as Record<string, unknown>;
              return {
                id: item.id,
                name:
                  readString(data.name) ||
                  readString(data.displayName) ||
                  readString(data.email).split('@')[0] ||
                  'Usuário Kyrub',
                avatar:
                  readString(data.photoUrl) ||
                  readString(data.avatar) ||
                  readString(data.photoURL),
                bio: readString(data.bio),
                role: readString(data.role),
              };
            })
          );
        },
        () => setUsers([])
      );

      stopGroups = onSnapshot(
        collection(db, `users/${user.uid}/contact_groups`),
        snapshot => {
          setGroups(
            snapshot.docs
              .map(item => {
                const data = item.data() as Record<string, unknown>;
                return {
                  id: item.id,
                  name: readString(data.name),
                  memberIds: readStringList(data.memberIds),
                };
              })
              .filter(group => group.name)
          );
        },
        () => setGroups([])
      );
    });

    return () => {
      stopUsers?.();
      stopGroups?.();
      stopAuth();
    };
  }, []);

  useEffect(() => {
    let frame = 0;

    const synchronize = () => {
      const profileModal = document.getElementById(
        'profile-social-hub-modal'
      );

      if (!profileModal) {
        setTargets(current => (current.length ? [] : current));
        return;
      }

      profileModal
        .querySelectorAll<HTMLElement>('span')
        .forEach(label => {
          if (normalizeText(label.textContent) === 'Frequentes') {
            label.textContent = 'Favoritos';
          }
        });

      const usedUserIds = new Set<string>();
      const nextTargets: ConnectedCardTarget[] = [];
      const menuButtons = profileModal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remover "]'
      );

      menuButtons.forEach(menuButton => {
        const card = menuButton.closest<HTMLElement>('article');
        if (!card) return;

        const requestedName = normalizeText(
          menuButton.getAttribute('aria-label')?.replace(/^Remover\s+/, '')
        );
        const profile = users.find(
          item =>
            !usedUserIds.has(item.id) &&
            normalizeText(item.name) === requestedName
        );
        if (profile) usedUserIds.add(profile.id);

        const media = card.firstElementChild as HTMLElement | null;
        const content = card.children.item(1) as HTMLElement | null;
        const footer = menuButton.parentElement;
        const name = content?.querySelector<HTMLElement>('h4');
        const nativeStatus = media
          ? [...media.querySelectorAll<HTMLElement>('span')].find(item =>
              normalizeText(item.textContent).startsWith('Status ·')
            ) ?? null
          : null;

        if (!media || !content || !footer || !name) return;

        const friendId = profile?.id ?? '';
        const status = friendId ? statusByAuthor.get(friendId) ?? null : null;
        const statusLabel = status
          ? normalizeText(nativeStatus?.textContent) || remainingStatusLabel(status)
          : '';
        const groupLabel = groupLabelForFriend(groups, friendId);
        const image = media.querySelector<HTMLImageElement>('img');
        const chatButton = findButtonByText(card, 'Chat');

        card.dataset.profileConnectedCard = 'true';
        card.dataset.profileConnectedFriendId = friendId;
        media.dataset.profileConnectedMedia = 'true';
        content.dataset.profileConnectedContent = 'true';
        content.dataset.profileGroupLabel = groupLabel;
        footer.dataset.profileConnectedFooter = 'true';
        menuButton.dataset.profileConnectedMenuButton = 'true';
        name.dataset.profileStatusLabel = statusLabel;

        name.setAttribute('role', 'button');
        name.setAttribute('tabindex', '0');
        name.setAttribute('aria-label', `Abrir perfil de ${requestedName}`);
        media.setAttribute('role', 'button');
        media.setAttribute('tabindex', '0');
        media.setAttribute(
          'aria-label',
          status
            ? `Ver Status de ${requestedName}`
            : `Abrir perfil de ${requestedName}`
        );

        if (nativeStatus) {
          nativeStatus.dataset.profileConnectedNativeStatus = 'true';
        }

        nextTargets.push({
          key: friendId || `${requestedName}-${nextTargets.length}`,
          card,
          name: requestedName,
          friendId,
          avatar: profile?.avatar || image?.src || '',
          bio: profile?.bio || '',
          role: profile?.role || '',
          groupLabel,
          status,
          statusLabel,
          menuButton,
          chatButton,
        });
      });

      groups.forEach(group => {
        const heading = [...profileModal.querySelectorAll<HTMLElement>('h4')]
          .find(item => normalizeText(item.textContent) === group.name);
        const section = heading?.closest<HTMLElement>('section');
        if (!heading || !section) return;

        const header = heading.parentElement?.parentElement as HTMLElement | null;
        const memberGrid = [...section.children].find(child =>
          child instanceof HTMLElement &&
          child.className.includes('grid') &&
          child.querySelector('button')
        ) as HTMLElement | undefined;
        if (!header || !memberGrid) return;

        let toggleButton = section.querySelector<HTMLButtonElement>(
          `[data-profile-group-toggle="${group.id}"]`
        );
        if (!toggleButton) {
          toggleButton = document.createElement('button');
          toggleButton.type = 'button';
          toggleButton.dataset.profileGroupToggle = group.id;
          toggleButton.className =
            'flex h-10 w-full items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-[9px] font-black uppercase text-violet-200';
          header.insertAdjacentElement('afterend', toggleButton);
        }

        const expanded = expandedGroupIds.has(group.id);
        const availableCount = users.filter(
          item => !group.memberIds.includes(item.id)
        ).length;
        toggleButton.textContent = expanded
          ? 'Concluir inclusão'
          : `Adicionar pessoas${availableCount > 0 ? ` (${availableCount})` : ''}`;
        toggleButton.disabled = !expanded && availableCount === 0;
        toggleButton.style.opacity =
          !expanded && availableCount === 0 ? '0.45' : '1';

        const usedIds = new Set<string>();
        memberGrid
          .querySelectorAll<HTMLButtonElement>('button')
          .forEach(friendButton => {
            const friendName = normalizeText(
              [...friendButton.querySelectorAll<HTMLElement>('span')]
                .map(item => normalizeText(item.textContent))
                .find(Boolean)
            );
            const profile = users.find(
              item =>
                !usedIds.has(item.id) &&
                normalizeText(item.name) === friendName
            );
            if (!profile) return;
            usedIds.add(profile.id);

            const isMember = group.memberIds.includes(profile.id);
            friendButton.style.display = isMember || expanded ? '' : 'none';
          });
      });

      setTargets(current =>
        sameTargets(current, nextTargets) ? current : nextTargets
      );
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(synchronize);
    };

    synchronize();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [expandedGroupIds, groups, statusByAuthor, users]);

  useEffect(() => {
    const targetForElement = (
      element: Element | null
    ): ConnectedCardTarget | undefined => {
      const card = element?.closest<HTMLElement>(
        'article[data-profile-connected-card="true"]'
      );
      if (!card) return undefined;
      return targets.find(target => target.card === card);
    };

    const handleClick = (event: MouseEvent) => {
      const element = event.target as Element | null;
      const groupToggle = element?.closest<HTMLButtonElement>(
        'button[data-profile-group-toggle]'
      );
      if (groupToggle?.dataset.profileGroupToggle) {
        const groupId = groupToggle.dataset.profileGroupToggle;
        event.preventDefault();
        setExpandedGroupIds(current => {
          const next = new Set(current);
          if (next.has(groupId)) next.delete(groupId);
          else next.add(groupId);
          return next;
        });
        return;
      }

      const menuButton = element?.closest<HTMLButtonElement>(
        'button[data-profile-connected-menu-button="true"]'
      );
      if (menuButton) {
        if (menuButton.dataset.profileConnectedBypass === 'true') return;
        const target = targetForElement(menuButton);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setMenuContact({ target });
        return;
      }

      const target = targetForElement(element);
      if (!target) return;

      if (
        element?.closest(
          'button[aria-label="Favoritar contato"], button[aria-label="Remover dos favoritos"]'
        ) ||
        element?.closest('[data-profile-connected-footer="true"]')
      ) {
        return;
      }

      if (element?.closest('[data-profile-connected-content="true"] h4')) {
        event.preventDefault();
        setProfileContact({ target });
        return;
      }

      if (element?.closest('[data-profile-connected-media="true"]')) {
        event.preventDefault();
        if (target.status) setStatusContact({ target });
        else setProfileContact({ target });
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const element = event.target as Element | null;
      const target = targetForElement(element);
      if (!target) return;

      if (element?.matches('[data-profile-connected-content="true"] h4')) {
        event.preventDefault();
        setProfileContact({ target });
      } else if (element?.matches('[data-profile-connected-media="true"]')) {
        event.preventDefault();
        if (target.status) setStatusContact({ target });
        else setProfileContact({ target });
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [targets]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const openGroups = (selected: SelectedContact) => {
    const profileModal = document.getElementById(
      'profile-social-hub-modal'
    );
    const groupsButton = profileModal
      ? findButtonByText(profileModal, 'Grupos')
      : null;

    setMenuContact(null);
    setExpandedGroupIds(new Set(groups.map(group => group.id)));

    if (!groupsButton) {
      showNotice('Não foi possível abrir os grupos agora.');
      return;
    }

    groupsButton.click();
    showNotice(`Escolha os grupos para ${selected.target.name}.`);
  };

  const removeConnection = () => {
    const selected = removeContact;
    if (!selected) return;

    const button = selected.target.menuButton;
    button.dataset.profileConnectedBypass = 'true';
    setRemoveContact(null);
    window.setTimeout(() => {
      button.click();
      delete button.dataset.profileConnectedBypass;
    }, 0);
  };

  const reportStatus = async () => {
    const selected = reportContact;
    const user = auth.currentUser;
    const status = selected?.target.status;

    if (!selected || !user || !status?.id || !status.authorId) {
      showNotice(
        'Este contato não possui um Status ativo para denunciar.'
      );
      setReportContact(null);
      return;
    }

    setBusy(true);
    try {
      const reportId = `${status.id.replaceAll('/', '_')}__${user.uid}`
        .slice(0, 1000);
      await setDoc(doc(db, 'social_post_reports', reportId), {
        reportId,
        postId: status.id,
        reporterId: user.uid,
        authorId: status.authorId,
        reason: 'contact_card_status_report',
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setReportContact(null);
      showNotice('Denúncia enviada para análise.');
    } catch {
      showNotice('Não foi possível enviar a denúncia.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{`
        #profile-social-hub-modal article[data-profile-connected-card="true"] {
          position: relative !important;
          display: flex !important;
          min-height: 300px !important;
          flex-direction: column !important;
          isolation: isolate;
          overflow: hidden !important;
          background: #020617 !important;
        }

        #profile-social-hub-modal [data-profile-connected-media="true"] {
          position: absolute !important;
          inset: 0 !important;
          z-index: 0 !important;
          height: 100% !important;
          cursor: pointer;
          overflow: hidden;
        }

        #profile-social-hub-modal [data-profile-connected-media="true"]::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background: linear-gradient(to bottom, rgba(2,6,23,.84) 0%, rgba(2,6,23,.2) 32%, rgba(2,6,23,.16) 54%, rgba(2,6,23,.72) 77%, rgba(2,6,23,.98) 100%);
        }

        #profile-social-hub-modal [data-profile-connected-media="true"] > img,
        #profile-social-hub-modal [data-profile-connected-media="true"] > span[role="img"] {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }

        #profile-social-hub-modal [data-profile-connected-native-status="true"] {
          display: none !important;
        }

        #profile-social-hub-modal [data-profile-connected-media="true"] > button {
          z-index: 7 !important;
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] {
          position: absolute !important;
          inset: 14px 56px auto 14px !important;
          z-index: 6 !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          pointer-events: none;
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] h4 {
          display: -webkit-box !important;
          width: 100%;
          max-height: 2.2em;
          margin: 0 !important;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          white-space: normal !important;
          text-align: left;
          text-overflow: ellipsis;
          font-size: .82rem;
          line-height: 1.08;
          color: #fff;
          cursor: pointer;
          pointer-events: auto;
          text-shadow: 0 2px 8px rgba(2,6,23,.98);
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] h4::after {
          content: attr(data-profile-status-label);
          display: block;
          width: max-content;
          max-width: 100%;
          margin-top: 6px;
          border: 1px solid rgba(45,212,191,.3);
          border-radius: 999px;
          padding: 3px 7px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: .5rem;
          font-weight: 900;
          line-height: 1;
          text-transform: uppercase;
          color: #5eead4;
          background: rgba(2,6,23,.78);
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] h4[data-profile-status-label=""]::after {
          display: none;
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] p {
          display: none !important;
        }

        #profile-social-hub-modal [data-profile-connected-content="true"]::after {
          content: attr(data-profile-group-label);
          display: block;
          max-width: 100%;
          margin-top: 5px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          font-size: .58rem;
          font-weight: 700;
          line-height: 1.1;
          color: #cbd5e1;
          text-shadow: 0 2px 8px rgba(2,6,23,.98);
        }

        #profile-social-hub-modal [data-profile-connected-content="true"][data-profile-group-label=""]::after {
          display: none;
        }

        #profile-social-hub-modal [data-profile-connected-footer="true"] {
          position: relative !important;
          z-index: 8 !important;
          margin-top: auto !important;
          background: rgba(2,6,23,.84) !important;
          backdrop-filter: blur(8px);
        }

        #profile-social-hub-modal button[data-profile-connected-menu-button="true"] svg {
          display: none !important;
        }

        #profile-social-hub-modal button[data-profile-connected-menu-button="true"]::before {
          content: '⋮';
          font-size: 1.35rem;
          line-height: 1;
          color: #94a3b8;
        }
      `}</style>

      {menuContact &&
        createPortal(
          <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
            <section className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-950 p-4 sm:rounded-3xl">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[9px] font-black uppercase text-sky-300">
                    Conectado
                  </span>
                  <h3 className="truncate text-base font-black text-white">
                    {menuContact.target.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuContact(null)}
                  className={iconButtonClass}
                  aria-label="Fechar ações do contato"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <ActionButton
                  icon={FolderPlus}
                  label="Adicionar a grupos"
                  description="Abra seus grupos e escolha onde organizar este contato."
                  onClick={() => openGroups(menuContact)}
                />
                <ActionButton
                  icon={UserMinus}
                  label="Remover conexão"
                  description="Retira o contato da sua lista de conectados."
                  danger
                  onClick={() => {
                    setRemoveContact(menuContact);
                    setMenuContact(null);
                  }}
                />
                <ActionButton
                  icon={Flag}
                  label="Denunciar"
                  description={
                    menuContact.target.status
                      ? 'Envia o Status ativo deste contato para análise.'
                      : 'Disponível quando houver um Status ativo no cartão.'
                  }
                  danger
                  disabled={!menuContact.target.status}
                  onClick={() => {
                    setReportContact(menuContact);
                    setMenuContact(null);
                  }}
                />
              </div>
            </section>
          </div>,
          document.body
        )}

      {profileContact &&
        createPortal(
          <div className="fixed inset-0 z-[191] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
            <section className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
              <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
                {profileContact.target.avatar ? (
                  <img
                    src={profileContact.target.avatar}
                    alt={profileContact.target.name}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <UserRound className="h-16 w-16 text-slate-700" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setProfileContact(null)}
                  className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/85 text-white"
                  aria-label="Fechar perfil do contato"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                <h3 className="text-lg font-black text-white">
                  {profileContact.target.name}
                </h3>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  {profileContact.target.bio ||
                    profileContact.target.role ||
                    'Este contato ainda não adicionou uma apresentação.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    profileContact.target.chatButton?.click();
                    setProfileContact(null);
                  }}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[10px] font-black uppercase text-slate-950"
                >
                  <MessageCircle className="h-4 w-4" />
                  Abrir chat
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {statusContact?.target.status &&
        createPortal(
          <div className="fixed inset-0 z-[192] flex items-center justify-center bg-slate-950/98 p-4 backdrop-blur-md">
            <section className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-teal-500/25 bg-slate-950">
              <button
                type="button"
                onClick={() => setStatusContact(null)}
                className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/85 text-white"
                aria-label="Fechar Status"
              >
                <X className="h-4 w-4" />
              </button>

              {statusContact.target.status.mediaUrls?.[0] ? (
                <img
                  src={statusContact.target.status.mediaUrls[0]}
                  alt={`Status de ${statusContact.target.name}`}
                  className="max-h-[66dvh] w-full object-contain"
                />
              ) : (
                <div className="flex min-h-72 items-center justify-center bg-slate-900">
                  <Clock3 className="h-16 w-16 text-teal-300" />
                </div>
              )}

              <div className="border-t border-slate-800 p-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileContact(statusContact);
                      setStatusContact(null);
                    }}
                    className="truncate text-left text-sm font-black text-white"
                  >
                    {statusContact.target.name}
                  </button>
                  <span className="shrink-0 rounded-full border border-teal-500/25 bg-teal-500/10 px-2 py-1 text-[8px] font-black uppercase text-teal-300">
                    {statusContact.target.statusLabel || 'Status ativo'}
                  </span>
                </div>
                {statusContact.target.status.content && (
                  <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-slate-300">
                    {statusContact.target.status.content}
                  </p>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}

      {removeContact &&
        createPortal(
          <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
            <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
              <UserMinus className="h-6 w-6 text-red-300" />
              <h3 className="mt-4 text-base font-black text-white">
                Remover esta conexão?
              </h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {removeContact.target.name} deixará de aparecer entre seus conectados.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRemoveContact(null)}
                  className="h-11 rounded-xl border border-slate-800 bg-slate-900 text-[9px] font-black uppercase text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={removeConnection}
                  className="h-11 rounded-xl bg-red-500 text-[9px] font-black uppercase text-white"
                >
                  Remover
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {reportContact &&
        createPortal(
          <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
            <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
              <Flag className="h-6 w-6 text-red-300" />
              <h3 className="mt-4 text-base font-black text-white">
                Denunciar este Status?
              </h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                O conteúdo ativo de {reportContact.target.name} será enviado para análise.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReportContact(null)}
                  className="h-11 rounded-xl border border-slate-800 bg-slate-900 text-[9px] font-black uppercase text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reportStatus()}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500 text-[9px] font-black uppercase text-white disabled:opacity-50"
                >
                  {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  Denunciar
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {notice &&
        createPortal(
          <div className="fixed bottom-5 left-1/2 z-[200] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-[10px] font-bold text-white shadow-2xl">
            {notice}
          </div>,
          document.body
        )}
    </>
  );
}
