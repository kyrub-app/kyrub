import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
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
  updateDoc,
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

type CardTarget = {
  card: HTMLElement;
  menuButton: HTMLButtonElement;
  chatButton: HTMLButtonElement | null;
  name: string;
  friendId: string;
  avatar: string;
  bio: string;
  role: string;
  status: StatusPost | null;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

const normalize = (value: string | null | undefined): string =>
  (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

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

const findButtonByText = (
  root: ParentNode,
  text: string
): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    normalize(button.textContent).includes(normalize(text))
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

const modalIconButton =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-400';

export function ProfileConnectedCardsPolishBridge() {
  const socialFeed = usePublicSocialFeed();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [menuTarget, setMenuTarget] = useState<CardTarget | null>(null);
  const [groupTarget, setGroupTarget] = useState<CardTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CardTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<CardTarget | null>(null);
  const [profileTarget, setProfileTarget] = useState<CardTarget | null>(null);
  const [statusTarget, setStatusTarget] = useState<CardTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const latestStatusByAuthor = useMemo(() => {
    const byId = new Map<string, StatusPost>();
    const byName = new Map<string, StatusPost>();
    const statuses = (socialFeed.posts as StatusPost[])
      .filter(isActiveStatus)
      .sort((left, right) => postTimestamp(right) - postTimestamp(left));

    for (const status of statuses) {
      if (status.authorId && !byId.has(status.authorId)) {
        byId.set(status.authorId, status);
      }
      const name = normalize(status.user);
      if (name && !byName.has(name)) byName.set(name, status);
    }

    return { byId, byName };
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

  const resolveTarget = (card: HTMLElement): CardTarget | null => {
    const menuButton = card.querySelector<HTMLButtonElement>(
      'button[data-profile-connected-menu="true"]'
    );
    if (!menuButton) return null;

    const name = menuButton.dataset.profileConnectedName ?? '';
    const profile = users.find(user => normalize(user.name) === normalize(name));
    const friendId = profile?.id ?? '';
    const status =
      (friendId ? latestStatusByAuthor.byId.get(friendId) : undefined) ??
      latestStatusByAuthor.byName.get(normalize(name)) ??
      null;

    return {
      card,
      menuButton,
      chatButton: findButtonByText(card, 'Chat'),
      name,
      friendId,
      avatar:
        profile?.avatar ||
        card.querySelector<HTMLImageElement>('img')?.src ||
        '',
      bio: profile?.bio ?? '',
      role: profile?.role ?? '',
      status,
    };
  };

  useEffect(() => {
    const synchronize = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) return;

      modal.querySelectorAll<HTMLElement>('span').forEach(label => {
        if (label.textContent?.trim() === 'Frequentes') {
          label.textContent = 'Favoritos';
        }
      });

      const buttons = modal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remover "], button[data-profile-connected-menu="true"]'
      );

      buttons.forEach(button => {
        const card = button.closest<HTMLElement>('article');
        if (!card) return;

        const name =
          button.dataset.profileConnectedName ||
          button.getAttribute('aria-label')?.replace(/^Remover\s+/, '').trim() ||
          '';
        const profile = users.find(user => normalize(user.name) === normalize(name));
        const friendId = profile?.id ?? '';
        const status =
          (friendId ? latestStatusByAuthor.byId.get(friendId) : undefined) ??
          latestStatusByAuthor.byName.get(normalize(name)) ??
          null;
        const content = card.children.item(1) as HTMLElement | null;
        const media = card.firstElementChild as HTMLElement | null;
        const footer = card.lastElementChild as HTMLElement | null;
        const heading = content?.querySelector<HTMLElement>('h4');

        card.dataset.profileConnectedCard = 'true';
        button.dataset.profileConnectedMenu = 'true';
        button.dataset.profileConnectedName = name;
        button.setAttribute('aria-label', `Mais ações para ${name}`);
        media?.setAttribute('data-profile-connected-media', 'true');
        footer?.setAttribute('data-profile-connected-footer', 'true');

        if (content) {
          content.dataset.profileConnectedContent = 'true';
          content.dataset.profileGroupLabel = groupLabelForFriend(
            groups,
            friendId
          );
        }

        if (heading) {
          heading.dataset.profileConnectedHeading = 'true';
        }

        const nativeStatus = media
          ? [...media.querySelectorAll<HTMLElement>('span')].find(item =>
              item.textContent?.trim().startsWith('Status ·')
            )
          : undefined;
        if (nativeStatus && status) {
          nativeStatus.dataset.profileConnectedStatus = 'true';
        }
      });
    };

    synchronize();
    const timer = window.setInterval(synchronize, 250);
    return () => window.clearInterval(timer);
  }, [groups, latestStatusByAuthor, users]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const element = event.target as Element | null;
      const menuButton = element?.closest<HTMLButtonElement>(
        'button[data-profile-connected-menu="true"]'
      );

      if (menuButton) {
        if (menuButton.dataset.profileConnectedBypass === 'true') return;
        const card = menuButton.closest<HTMLElement>(
          'article[data-profile-connected-card="true"]'
        );
        if (!card) return;
        const target = resolveTarget(card);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setMenuTarget(target);
        return;
      }

      const card = element?.closest<HTMLElement>(
        'article[data-profile-connected-card="true"]'
      );
      if (!card) return;

      if (
        element?.closest(
          'button[aria-label="Favoritar contato"], button[aria-label="Remover dos favoritos"]'
        ) ||
        element?.closest('[data-profile-connected-footer="true"]')
      ) {
        return;
      }

      const target = resolveTarget(card);
      if (!target) return;

      if (element?.closest('[data-profile-connected-heading="true"]')) {
        event.preventDefault();
        setProfileTarget(target);
        return;
      }

      if (element?.closest('[data-profile-connected-media="true"]')) {
        event.preventDefault();
        if (target.status) setStatusTarget(target);
        else setProfileTarget(target);
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [latestStatusByAuthor, users]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const removeConnection = () => {
    if (!removeTarget) return;
    const button = removeTarget.menuButton;
    button.dataset.profileConnectedBypass = 'true';
    setRemoveTarget(null);
    window.setTimeout(() => {
      button.click();
      delete button.dataset.profileConnectedBypass;
    }, 0);
  };

  const toggleGroup = async (group: ContactGroup) => {
    const user = auth.currentUser;
    const friendId = groupTarget?.friendId;
    if (!user || !friendId) return;

    const memberIds = group.memberIds.includes(friendId)
      ? group.memberIds.filter(id => id !== friendId)
      : [...group.memberIds, friendId].slice(0, 200);

    setBusy(true);
    try {
      await updateDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`),
        { memberIds, updatedAt: serverTimestamp() }
      );
    } catch {
      showNotice('Não foi possível atualizar o grupo.');
    } finally {
      setBusy(false);
    }
  };

  const reportStatus = async () => {
    const user = auth.currentUser;
    const status = reportTarget?.status;
    if (!user || !status?.id || !status.authorId) return;

    setBusy(true);
    try {
      const reportId = `${status.id.replaceAll('/', '_')}__${user.uid}`.slice(
        0,
        1000
      );
      await setDoc(doc(db, 'social_post_reports', reportId), {
        reportId,
        postId: status.id,
        reporterId: user.uid,
        authorId: status.authorId,
        reason: 'contact_card_status_report',
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setReportTarget(null);
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
          min-height: 310px !important;
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
          overflow: hidden !important;
          cursor: pointer;
        }

        #profile-social-hub-modal [data-profile-connected-media="true"]::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background: linear-gradient(to bottom, rgba(2,6,23,.88) 0%, rgba(2,6,23,.2) 34%, rgba(2,6,23,.16) 55%, rgba(2,6,23,.74) 78%, rgba(2,6,23,.98) 100%);
        }

        #profile-social-hub-modal [data-profile-connected-media="true"] > img,
        #profile-social-hub-modal [data-profile-connected-media="true"] > span[role="img"] {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }

        #profile-social-hub-modal [data-profile-connected-media="true"] > button {
          z-index: 8 !important;
        }

        #profile-social-hub-modal [data-profile-connected-status="true"] {
          top: 62px !important;
          bottom: auto !important;
          left: 14px !important;
          z-index: 7 !important;
        }

        #profile-social-hub-modal [data-profile-connected-content="true"] {
          position: absolute !important;
          inset: 14px 56px auto 14px !important;
          z-index: 7 !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          pointer-events: none;
        }

        #profile-social-hub-modal [data-profile-connected-heading="true"] {
          display: -webkit-box !important;
          width: 100%;
          max-height: 2.3em;
          margin: 0 !important;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          white-space: normal !important;
          text-align: left;
          text-overflow: ellipsis;
          font-size: .83rem;
          line-height: 1.12;
          color: #fff;
          cursor: pointer;
          pointer-events: auto;
          text-shadow: 0 2px 8px rgba(2,6,23,.98);
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
          color: #cbd5e1;
          text-shadow: 0 2px 8px rgba(2,6,23,.98);
        }

        #profile-social-hub-modal [data-profile-connected-content="true"][data-profile-group-label=""]::after {
          display: none;
        }

        #profile-social-hub-modal [data-profile-connected-footer="true"] {
          position: absolute !important;
          right: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
          z-index: 9 !important;
          margin: 0 !important;
          background: rgba(2,6,23,.86) !important;
          backdrop-filter: blur(8px);
        }

        #profile-social-hub-modal button[data-profile-connected-menu="true"] svg {
          display: none !important;
        }

        #profile-social-hub-modal button[data-profile-connected-menu="true"]::before {
          content: '⋮';
          font-size: 1.35rem;
          line-height: 1;
          color: #94a3b8;
        }
      `}</style>

      {menuTarget &&
        createPortal(
          <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
            <section className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-950 p-4 sm:rounded-3xl">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[9px] font-black uppercase text-sky-300">
                    Conectado
                  </span>
                  <h3 className="truncate text-base font-black text-white">
                    {menuTarget.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuTarget(null)}
                  className={modalIconButton}
                  aria-label="Fechar ações do contato"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  disabled={!menuTarget.friendId || groups.length === 0}
                  onClick={() => {
                    setGroupTarget(menuTarget);
                    setMenuTarget(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left text-slate-200 disabled:opacity-45"
                >
                  <FolderPlus className="h-5 w-5 text-violet-300" />
                  <span>
                    <strong className="block text-[10px] font-black uppercase">
                      Adicionar a grupos
                    </strong>
                    <span className="text-[8px] text-slate-500">
                      Organize este contato nos seus grupos privados.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRemoveTarget(menuTarget);
                    setMenuTarget(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-left text-red-200"
                >
                  <UserMinus className="h-5 w-5" />
                  <span>
                    <strong className="block text-[10px] font-black uppercase">
                      Remover conexão
                    </strong>
                    <span className="text-[8px] text-red-200/60">
                      Retira o contato da sua lista de conectados.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!menuTarget.status}
                  onClick={() => {
                    setReportTarget(menuTarget);
                    setMenuTarget(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-left text-red-200 disabled:opacity-45"
                >
                  <Flag className="h-5 w-5" />
                  <span>
                    <strong className="block text-[10px] font-black uppercase">
                      Denunciar
                    </strong>
                    <span className="text-[8px] text-red-200/60">
                      {menuTarget.status
                        ? 'Envia o Status ativo deste contato para análise.'
                        : 'Disponível quando houver um Status ativo.'}
                    </span>
                  </span>
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {groupTarget &&
        createPortal(
          <div className="fixed inset-0 z-[191] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
            <section className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-950 p-4 sm:rounded-3xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-[9px] font-black uppercase text-violet-300">
                    Grupos
                  </span>
                  <h3 className="text-base font-black text-white">
                    {groupTarget.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setGroupTarget(null)}
                  className={modalIconButton}
                  aria-label="Fechar grupos"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {groups.map(group => {
                  const selected = group.memberIds.includes(
                    groupTarget.friendId
                  );
                  return (
                    <button
                      key={group.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleGroup(group)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${
                        selected
                          ? 'border-violet-500/40 bg-violet-500/10 text-violet-100'
                          : 'border-slate-800 bg-slate-900 text-slate-300'
                      }`}
                    >
                      <FolderPlus className="h-5 w-5" />
                      <span className="min-w-0 flex-1 truncate text-[10px] font-black">
                        {group.name}
                      </span>
                      {selected && <Check className="h-5 w-5" />}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>,
          document.body
        )}

      {profileTarget &&
        createPortal(
          <div className="fixed inset-0 z-[191] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
            <section className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
              <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
                {profileTarget.avatar ? (
                  <img
                    src={profileTarget.avatar}
                    alt={profileTarget.name}
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
                  onClick={() => setProfileTarget(null)}
                  className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/85 text-white"
                  aria-label="Fechar perfil do contato"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                <h3 className="text-lg font-black text-white">
                  {profileTarget.name}
                </h3>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  {profileTarget.bio ||
                    profileTarget.role ||
                    'Este contato ainda não adicionou uma apresentação.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    profileTarget.chatButton?.click();
                    setProfileTarget(null);
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

      {statusTarget?.status &&
        createPortal(
          <div className="fixed inset-0 z-[192] flex items-center justify-center bg-slate-950/98 p-4 backdrop-blur-md">
            <section className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-teal-500/25 bg-slate-950">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/85 text-white"
                aria-label="Fechar Status"
              >
                <X className="h-4 w-4" />
              </button>

              {statusTarget.status.mediaUrls?.[0] ? (
                <img
                  src={statusTarget.status.mediaUrls[0]}
                  alt={`Status de ${statusTarget.name}`}
                  className="max-h-[66dvh] w-full object-contain"
                />
              ) : (
                <div className="flex min-h-72 items-center justify-center bg-slate-900">
                  <Clock3 className="h-16 w-16 text-teal-300" />
                </div>
              )}

              <div className="border-t border-slate-800 p-4">
                <h3 className="text-sm font-black text-white">
                  {statusTarget.name}
                </h3>
                {statusTarget.status.content && (
                  <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-slate-300">
                    {statusTarget.status.content}
                  </p>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}

      {removeTarget &&
        createPortal(
          <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
            <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
              <UserMinus className="h-6 w-6 text-red-300" />
              <h3 className="mt-4 text-base font-black text-white">
                Remover esta conexão?
              </h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {removeTarget.name} deixará de aparecer entre seus conectados.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRemoveTarget(null)}
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

      {reportTarget &&
        createPortal(
          <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
            <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
              <Flag className="h-6 w-6 text-red-300" />
              <h3 className="mt-4 text-base font-black text-white">
                Denunciar este Status?
              </h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                O conteúdo ativo de {reportTarget.name} será enviado para análise.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReportTarget(null)}
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
