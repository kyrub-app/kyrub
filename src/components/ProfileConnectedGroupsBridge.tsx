import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Clock3,
  FolderPlus,
  LoaderCircle,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { Friend, SocialPost } from '../types';
import { usePublicSocialFeed } from '../hooks/usePublicSocialFeed';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { auth, db } from '../utils/firebase';
import { MediaCarousel } from './MediaCarousel';

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_GROUPS = 30;
const MAX_GROUP_MEMBERS = 200;

type ContactGroup = {
  id: string;
  groupId: string;
  ownerId: string;
  name: string;
  memberIds: string[];
};

type ExtendedSocialPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  createdAt?: string;
  mediaUrls?: string[];
  visibility?: 'public' | 'private' | 'connections';
};

const findButtonByText = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    button.textContent?.trim().startsWith(label)
  ) ?? null;

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

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

const contactInitial = (name: string): string =>
  name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';

export function ProfileConnectedGroupsBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [now, setNow] = useState(Date.now());
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [groupsMode, setGroupsMode] = useState(false);
  const [groupButtonHost, setGroupButtonHost] =
    useState<HTMLElement | null>(null);
  const [groupPanelHost, setGroupPanelHost] =
    useState<HTMLElement | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Friend | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState('');
  const [groupError, setGroupError] = useState('');

  const friendsRef = useRef<Friend[]>([]);
  const statusByAuthorRef = useRef(new Map<string, ExtendedSocialPost>());
  const groupsModeRef = useRef(false);
  const decorateRef = useRef<() => void>(() => undefined);

  const socialFeed = usePublicSocialFeed();
  const directory = useSocialDirectoryV2({
    profileName: user?.displayName ?? '',
    profilePhotoUrl: user?.photoURL ?? '',
    profileAddress: '',
    accountTypeLojista: false,
    accountTypeEntregador: false,
    isLoggedIn: Boolean(user),
    triggerToast: () => undefined,
  });

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'users'), snapshot => {
      directory.setDbUsers(
        snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      );
    });
  }, [directory.setDbUsers, user]);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      return;
    }
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
      error => {
        console.warn('Não foi possível carregar os grupos de contatos.', error);
        setGroupError(
          'Os grupos ainda não estão disponíveis. Publique as novas regras do Firestore.'
        );
      }
    );
  }, [user]);

  const latestStatusByAuthor = useMemo(() => {
    const statuses = (socialFeed.posts as ExtendedSocialPost[])
      .filter(post => isActiveStatus(post, now))
      .sort((left, right) => postTimestamp(right) - postTimestamp(left));
    const byAuthor = new Map<string, ExtendedSocialPost>();
    for (const status of statuses) {
      if (status.authorId && !byAuthor.has(status.authorId)) {
        byAuthor.set(status.authorId, status);
      }
    }
    return byAuthor;
  }, [now, socialFeed.posts]);

  useEffect(() => {
    friendsRef.current = directory.friends;
    decorateRef.current();
  }, [directory.friends]);

  useEffect(() => {
    statusByAuthorRef.current = latestStatusByAuthor;
    decorateRef.current();
  }, [latestStatusByAuthor]);

  useEffect(() => {
    groupsModeRef.current = groupsMode;
    decorateRef.current();
  }, [groupsMode]);

  useEffect(() => {
    const buildProfileButton = (
      article: HTMLElement,
      friend: Friend,
      hasStatus: boolean
    ) => {
      let button = article.querySelector<HTMLButtonElement>(
        'button[data-kyrub-connected-profile-trigger]'
      );
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.kyrubConnectedProfileTrigger = 'true';
        article
          .querySelector<HTMLElement>('[data-kyrub-contact-header]')
          ?.appendChild(button);
      }
      button.dataset.contactId = friend.id;
      button.setAttribute('aria-label', `Abrir perfil de ${friend.name}`);
      button.setAttribute('title', `Perfil de ${friend.name}`);
      button.dataset.hasStatus = String(hasStatus);
      const signature = `${friend.avatar}|${friend.name}`;
      if (button.dataset.avatarSignature === signature) return;
      button.dataset.avatarSignature = signature;
      button.replaceChildren();
      if (friend.avatar) {
        const image = document.createElement('img');
        image.src = friend.avatar;
        image.alt = friend.name;
        image.referrerPolicy = 'no-referrer';
        button.appendChild(image);
      } else {
        const fallback = document.createElement('span');
        fallback.textContent = contactInitial(friend.name);
        button.appendChild(fallback);
      }
    };

    const buildStatusCover = (article: HTMLElement, friend: Friend) => {
      const header = article.querySelector<HTMLElement>(
        '[data-kyrub-contact-header]'
      );
      const originalCover = article.querySelector<HTMLElement>(
        '[data-kyrub-contact-cover]'
      );
      if (!header || !originalCover) return;

      const status = statusByAuthorRef.current.get(friend.id);
      let cover = header.querySelector<HTMLElement>(
        '[data-kyrub-connected-status-cover]'
      );
      if (!cover) {
        cover = document.createElement('div');
        cover.dataset.kyrubConnectedStatusCover = 'true';
        header.insertBefore(cover, header.firstChild);
      }

      const mediaUrl = status?.mediaUrls?.[0] ?? '';
      const content = status?.content?.trim() ?? '';
      const signature = status
        ? `${status.id}|${mediaUrl}|${content}`
        : `profile|${friend.avatar}|${friend.name}`;

      if (cover.dataset.statusSignature !== signature) {
        cover.dataset.statusSignature = signature;
        cover.replaceChildren();
        if (mediaUrl || (!status && friend.avatar)) {
          const image = document.createElement('img');
          image.src = mediaUrl || friend.avatar;
          image.alt = status
            ? `Status de ${friend.name}`
            : `Foto de ${friend.name}`;
          image.referrerPolicy = 'no-referrer';
          cover.appendChild(image);
        } else {
          const text = document.createElement('div');
          text.dataset.kyrubConnectedStatusText = 'true';
          const initial = document.createElement('span');
          initial.textContent = status
            ? content || 'Novo Status'
            : contactInitial(friend.name);
          text.appendChild(initial);
          cover.appendChild(text);
        }
      }

      originalCover.style.opacity = '0';
      originalCover.setAttribute('aria-hidden', 'true');

      let badge = header.querySelector<HTMLElement>(
        '[data-kyrub-connected-status-badge]'
      );
      if (status) {
        if (!badge) {
          badge = document.createElement('span');
          badge.dataset.kyrubConnectedStatusBadge = 'true';
          header.appendChild(badge);
        }
        badge.textContent = `Status · ${remainingStatusLabel(status, Date.now())}`;
      } else {
        badge?.remove();
      }

      buildProfileButton(article, friend, Boolean(status));
    };

    const decorateCards = (modal: HTMLElement) => {
      modal
        .querySelectorAll<HTMLElement>('[data-kyrub-contact-card]')
        .forEach(article => {
          const contactId = article.dataset.kyrubContactId;
          const friend = friendsRef.current.find(item => item.id === contactId);
          if (friend) buildStatusCover(article, friend);
        });
    };

    const restoreConnectedPanel = (nav: HTMLElement, panelHost: HTMLElement) => {
      const parent = nav.parentElement;
      if (!parent) return;
      for (const child of Array.from(parent.children)) {
        if (child === nav || child === panelHost) continue;
        (child as HTMLElement).style.removeProperty('display');
      }
      panelHost.style.display = 'none';
    };

    const showGroupsPanel = (nav: HTMLElement, panelHost: HTMLElement) => {
      const parent = nav.parentElement;
      if (!parent) return;
      for (const child of Array.from(parent.children)) {
        if (child === nav || child === panelHost) continue;
        (child as HTMLElement).style.display = 'none';
      }
      panelHost.style.display = 'block';
    };

    const decorateGroupNavigation = (modal: HTMLElement) => {
      const listButton = findButtonByText(modal, 'Minha lista');
      const suggestionsButton = findButtonByText(modal, 'Sugestões');
      const requestsButton = findButtonByText(modal, 'Solicitações');
      const nav = listButton?.parentElement;
      if (!nav || !suggestionsButton || !requestsButton) {
        setGroupButtonHost(current => (current?.isConnected ? null : current));
        setGroupPanelHost(current => (current?.isConnected ? null : current));
        return;
      }

      nav.setAttribute('data-kyrub-connection-subnav', 'true');
      let buttonHost = nav.querySelector<HTMLElement>(
        '[data-kyrub-groups-button-host]'
      );
      if (!buttonHost) {
        buttonHost = document.createElement('span');
        buttonHost.dataset.kyrubGroupsButtonHost = 'true';
        buttonHost.style.display = 'contents';
        nav.insertBefore(buttonHost, suggestionsButton);
      }

      let panelHost = nav.parentElement?.querySelector<HTMLElement>(
        '[data-kyrub-groups-panel-host]'
      );
      if (!panelHost) {
        panelHost = document.createElement('div');
        panelHost.dataset.kyrubGroupsPanelHost = 'true';
        nav.insertAdjacentElement('afterend', panelHost);
      }

      setGroupButtonHost(current =>
        current === buttonHost ? current : buttonHost
      );
      setGroupPanelHost(current =>
        current === panelHost ? current : panelHost
      );

      if (groupsModeRef.current) showGroupsPanel(nav, panelHost);
      else restoreConnectedPanel(nav, panelHost);
    };

    const decorate = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        setGroupButtonHost(null);
        setGroupPanelHost(null);
        return;
      }
      decorateCards(modal);
      decorateGroupNavigation(modal);
    };

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const profileButton = target?.closest<HTMLButtonElement>(
        'button[data-kyrub-connected-profile-trigger]'
      );
      if (profileButton) {
        event.preventDefault();
        event.stopPropagation();
        const friend = friendsRef.current.find(
          item => item.id === profileButton.dataset.contactId
        );
        if (friend) setSelectedProfile(friend);
        return;
      }

      const regularSubtab = target?.closest<HTMLButtonElement>('button');
      if (
        regularSubtab &&
        ['Minha lista', 'Sugestões', 'Solicitações'].some(label =>
          regularSubtab.textContent?.trim().startsWith(label)
        )
      ) {
        setGroupsMode(false);
      }
    };

    decorateRef.current = decorate;
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', onDocumentClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onDocumentClick, true);
      decorateRef.current = () => undefined;
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-contact-cover]')
        .forEach(element => {
          element.style.removeProperty('opacity');
          element.removeAttribute('aria-hidden');
        });
      document
        .querySelectorAll<HTMLElement>(
          '[data-kyrub-connected-status-cover], [data-kyrub-connected-status-badge], [data-kyrub-connected-profile-trigger], [data-kyrub-groups-button-host], [data-kyrub-groups-panel-host]'
        )
        .forEach(element => element.remove());
    };
  }, []);

  const selectedProfilePosts = useMemo(
    () =>
      (socialFeed.posts as ExtendedSocialPost[]).filter(
        post =>
          post.authorId === selectedProfile?.id &&
          post.publicationType !== 'status'
      ),
    [selectedProfile?.id, socialFeed.posts]
  );

  const selectedGroup = groups.find(group => group.id === selectedGroupId);

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    const name = groupNameDraft.trim().slice(0, 60);
    if (!user || !name || groupBusy) return;
    if (groups.length >= MAX_GROUPS) {
      setGroupError(`Você pode criar até ${MAX_GROUPS} grupos.`);
      return;
    }
    setGroupBusy(true);
    setGroupError('');
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
      setSelectedGroupId(reference.id);
    } catch (error) {
      console.warn('Não foi possível criar o grupo.', error);
      setGroupError(
        'Não foi possível criar o grupo. Confirme a publicação das regras do Firestore.'
      );
    } finally {
      setGroupBusy(false);
    }
  };

  const toggleGroupMember = async (group: ContactGroup, friendId: string) => {
    if (!user || groupBusy) return;
    const acceptedIds = new Set(directory.friends.map(friend => friend.id));
    const currentMembers = group.memberIds.filter(memberId =>
      acceptedIds.has(memberId)
    );
    const memberIds = currentMembers.includes(friendId)
      ? currentMembers.filter(memberId => memberId !== friendId)
      : [...currentMembers, friendId].slice(0, MAX_GROUP_MEMBERS);
    setGroupBusy(true);
    setGroupError('');
    try {
      await updateDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`),
        {
          memberIds,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.warn('Não foi possível atualizar os membros do grupo.', error);
      setGroupError('Não foi possível atualizar este grupo agora.');
    } finally {
      setGroupBusy(false);
    }
  };

  const removeGroup = async (group: ContactGroup) => {
    if (!user || groupBusy) return;
    if (deleteConfirmationId !== group.id) {
      setDeleteConfirmationId(group.id);
      window.setTimeout(() => {
        setDeleteConfirmationId(current =>
          current === group.id ? '' : current
        );
      }, 4500);
      return;
    }
    setGroupBusy(true);
    setGroupError('');
    try {
      await deleteDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`)
      );
      setSelectedGroupId(current => (current === group.id ? '' : current));
      setDeleteConfirmationId('');
    } catch (error) {
      console.warn('Não foi possível excluir o grupo.', error);
      setGroupError('Não foi possível excluir este grupo agora.');
    } finally {
      setGroupBusy(false);
    }
  };

  const groupsPanel = (
    <div className="space-y-4 py-1" data-kyrub-contact-groups-panel="true">
      <form
        onSubmit={createGroup}
        className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-300">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-black text-white">Novo grupo</h4>
            <p className="text-xs leading-relaxed text-slate-500">
              Organize somente usuários que já fazem parte da sua lista.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <input
            value={groupNameDraft}
            onChange={event => setGroupNameDraft(event.target.value.slice(0, 60))}
            placeholder="Ex.: Família, Trabalho, Clientes"
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-violet-500/50"
          />
          <button
            type="submit"
            disabled={!groupNameDraft.trim() || groupBusy}
            className="rounded-xl bg-violet-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            Criar
          </button>
        </div>
      </form>

      {groupError && (
        <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {groupError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {groups.map(group => {
          const visibleMembers = group.memberIds.filter(memberId =>
            directory.friends.some(friend => friend.id === memberId)
          );
          const selected = selectedGroupId === group.id;
          return (
            <article
              key={group.id}
              className={`overflow-hidden rounded-3xl border bg-slate-900 ${
                selected
                  ? 'border-violet-500/50'
                  : 'border-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedGroupId(selected ? '' : group.id)}
                className="block w-full p-4 text-left"
              >
                <UsersRound className="h-6 w-6 text-violet-300" />
                <h4 className="mt-3 truncate text-sm font-black text-white">
                  {group.name}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  {visibleMembers.length}{' '}
                  {visibleMembers.length === 1 ? 'contato' : 'contatos'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => void removeGroup(group)}
                className={`flex w-full items-center justify-center gap-2 border-t border-slate-800 px-3 py-2.5 text-xs font-black ${
                  deleteConfirmationId === group.id
                    ? 'bg-red-500/15 text-red-200'
                    : 'text-red-300'
                }`}
              >
                <Trash2 className="h-4 w-4" />
                {deleteConfirmationId === group.id
                  ? 'Confirmar exclusão'
                  : 'Excluir'}
              </button>
            </article>
          );
        })}
      </div>

      {groups.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-10 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-slate-700" />
          <h4 className="mt-3 text-sm font-black text-white">
            Nenhum grupo criado
          </h4>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Crie um grupo para reunir pessoas por família, trabalho, clientes ou qualquer outra organização pessoal.
          </p>
        </div>
      )}

      {selectedGroup && (
        <section className="rounded-3xl border border-violet-500/25 bg-violet-500/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs font-black uppercase text-violet-300">
                Membros do grupo
              </span>
              <h4 className="text-base font-black text-white">
                {selectedGroup.name}
              </h4>
            </div>
            {groupBusy && (
              <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" />
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {directory.friends.map(friend => {
              const selected = selectedGroup.memberIds.includes(friend.id);
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => void toggleGroupMember(selectedGroup, friend.id)}
                  disabled={groupBusy}
                  className={`flex min-w-0 items-center gap-2 rounded-2xl border p-2.5 text-left ${
                    selected
                      ? 'border-violet-500/45 bg-violet-500/10'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  {friend.avatar ? (
                    <img
                      src={friend.avatar}
                      alt={friend.name}
                      className="h-9 w-9 shrink-0 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-black text-slate-300">
                      {contactInitial(friend.name)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">
                    {friend.name}
                  </span>
                  {selected && <Check className="h-4 w-4 text-violet-300" />}
                </button>
              );
            })}
          </div>
          {directory.friends.length === 0 && (
            <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-center text-xs text-slate-500">
              Adicione contatos à sua lista antes de montar um grupo.
            </p>
          )}
        </section>
      )}
    </div>
  );

  return (
    <>
      <style>{`
        [data-kyrub-connection-subnav="true"] {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
        [data-kyrub-contact-header="true"] {
          overflow: hidden !important;
        }
        [data-kyrub-connected-status-cover="true"] {
          position: absolute;
          inset: 0 0 auto;
          width: 100%;
          aspect-ratio: 4 / 3;
          overflow: hidden;
          background: linear-gradient(145deg, rgb(15 23 42), rgb(2 6 23));
        }
        [data-kyrub-connected-status-cover="true"] > img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        [data-kyrub-connected-status-text="true"] {
          display: flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          padding: 44px 16px 24px;
          background:
            radial-gradient(circle at 20% 15%, rgba(249,115,22,.3), transparent 34%),
            linear-gradient(145deg, rgb(30 41 59), rgb(2 6 23));
          color: white;
          text-align: center;
          font-size: .875rem;
          line-height: 1.25rem;
          font-weight: 800;
        }
        [data-kyrub-connected-profile-trigger="true"] {
          position: absolute;
          z-index: 4;
          top: 10px;
          left: 10px;
          display: flex;
          width: 48px;
          height: 48px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border: 3px solid rgb(2 6 23);
          border-radius: 999px;
          background: rgb(30 41 59);
          color: white;
          box-shadow: 0 10px 24px rgba(2,6,23,.5);
        }
        [data-kyrub-connected-profile-trigger="true"][data-has-status="true"] {
          outline: 2px solid rgb(249 115 22);
          outline-offset: 1px;
        }
        [data-kyrub-connected-profile-trigger="true"] img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        [data-kyrub-connected-profile-trigger="true"] span {
          font-size: 1rem;
          font-weight: 900;
        }
        [data-kyrub-connected-status-badge="true"] {
          position: absolute;
          z-index: 4;
          right: 10px;
          bottom: 8px;
          border: 1px solid rgba(255,255,255,.15);
          border-radius: 999px;
          background: rgba(2,6,23,.82);
          padding: 5px 8px;
          color: rgb(253 186 116);
          font-size: .6875rem;
          font-weight: 900;
          backdrop-filter: blur(10px);
        }
      `}</style>

      {groupButtonHost &&
        createPortal(
          <button
            type="button"
            onClick={() => setGroupsMode(true)}
            className={`rounded-2xl border p-3 text-center ${
              groupsMode
                ? 'border-violet-500/40 bg-violet-500/10'
                : 'border-slate-800 bg-slate-900'
            }`}
            data-kyrub-groups-subtab="true"
          >
            <strong className="block text-sm text-white">
              {groups.length}
            </strong>
            <span className="mt-1 block text-xs font-black uppercase text-slate-500">
              Grupos
            </span>
          </button>,
          groupButtonHost
        )}

      {groupPanelHost && groupsMode &&
        createPortal(groupsPanel, groupPanelHost)}

      {selectedProfile &&
        createPortal(
          <div className="fixed inset-0 z-[190] flex justify-center bg-slate-950/95 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md sm:p-6">
            <section className="flex max-h-[calc(100dvh-24px)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl sm:max-h-[calc(100dvh-48px)]">
              <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-orange-400">
                    Perfil conectado
                  </span>
                  <h3 className="text-lg font-black text-white">
                    Publicações do usuário
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProfile(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-400"
                  aria-label="Fechar perfil conectado"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-4">
                <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4">
                  <div className="flex items-center gap-4">
                    {selectedProfile.avatar ? (
                      <img
                        src={selectedProfile.avatar}
                        alt={selectedProfile.name}
                        className="h-20 w-20 shrink-0 rounded-full border-2 border-orange-500 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-orange-500 bg-slate-800 text-2xl font-black text-white">
                        {contactInitial(selectedProfile.name)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h4 className="truncate text-xl font-black text-white">
                        {selectedProfile.name}
                      </h4>
                      <p className="mt-1 text-sm font-bold text-orange-300">
                        {selectedProfile.role}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">
                        {selectedProfile.bio ||
                          'Este usuário ainda não adicionou uma apresentação pública.'}
                      </p>
                    </div>
                  </div>
                </section>

                <div className="mt-5 flex items-center gap-2">
                  <UserRound className="h-5 w-5 text-orange-400" />
                  <h4 className="text-base font-black text-white">
                    Publicações {selectedProfilePosts.length}
                  </h4>
                </div>

                <div className="mt-3 space-y-4">
                  {selectedProfilePosts.map(post => (
                    <article
                      key={post.id}
                      className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black text-white">
                          {post.user}
                        </span>
                        <span className="text-xs text-slate-500">
                          {post.time}
                        </span>
                      </div>
                      {post.content && (
                        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                          {post.content}
                        </p>
                      )}
                      {post.mediaUrls && post.mediaUrls.length > 0 && (
                        <div className="mt-3">
                          <MediaCarousel mediaUrls={post.mediaUrls} />
                        </div>
                      )}
                    </article>
                  ))}
                  {!socialFeed.loading && selectedProfilePosts.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-10 text-center">
                      <UserRound className="mx-auto h-8 w-8 text-slate-700" />
                      <h4 className="mt-3 text-sm font-black text-white">
                        Nenhuma publicação disponível
                      </h4>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        Este contato ainda não publicou conteúdo visível para você.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
