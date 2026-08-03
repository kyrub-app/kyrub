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
import {
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { Friend, SocialPost } from '../types';
import { usePublicSocialFeed } from '../hooks/usePublicSocialFeed';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { auth, db } from '../utils/firebase';

type StatusPost = SocialPost & {
  authorId?: string;
  publicationType?: 'feed' | 'status';
  createdAt?: string;
  mediaUrls?: string[];
};

type ConnectedCardTarget = {
  key: string;
  card: HTMLElement;
  headingTarget: HTMLElement;
  imageTarget: HTMLElement;
  menuTarget: HTMLElement;
  nativeName: HTMLElement;
  nativeStatus: HTMLElement | null;
  nativeRemoveButton: HTMLButtonElement;
  nativeFavoriteButton: HTMLButtonElement | null;
  chatButton: HTMLButtonElement | null;
  friend: Friend;
  status: StatusPost | null;
  statusLabel: string;
};

type SelectedContact = {
  target: ConnectedCardTarget;
};

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

const sameTargets = (
  current: ConnectedCardTarget[],
  next: ConnectedCardTarget[]
): boolean =>
  current.length === next.length &&
  current.every((item, index) => {
    const candidate = next[index];
    return (
      item.card === candidate?.card &&
      item.friend.id === candidate?.friend.id &&
      item.status?.id === candidate?.status?.id &&
      item.statusLabel === candidate?.statusLabel
    );
  });

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

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const findButtonByText = (
  root: ParentNode,
  text: string
): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    normalizeText(button.textContent).toLocaleLowerCase('pt-BR').includes(
      text.toLocaleLowerCase('pt-BR')
    )
  ) ?? null;

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
  const directory = useSocialDirectoryV2({
    profileName: auth.currentUser?.displayName ?? '',
    profilePhotoUrl: auth.currentUser?.photoURL ?? '',
    profileAddress: '',
    accountTypeLojista: false,
    accountTypeEntregador: false,
    isLoggedIn: Boolean(auth.currentUser),
    triggerToast: () => undefined,
  });
  const socialFeed = usePublicSocialFeed();
  const [targets, setTargets] = useState<ConnectedCardTarget[]>([]);
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

      const usedFriendIds = new Set<string>();
      const nextTargets: ConnectedCardTarget[] = [];
      const removeButtons = profileModal.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remover "]'
      );

      removeButtons.forEach(nativeRemoveButton => {
        const card = nativeRemoveButton.closest<HTMLElement>('article');
        if (!card) return;

        const requestedName = normalizeText(
          nativeRemoveButton.getAttribute('aria-label')?.replace(
            /^Remover\s+/,
            ''
          )
        );
        const friend = directory.friends.find(
          item =>
            !usedFriendIds.has(item.id) &&
            normalizeText(item.name) === requestedName
        );
        if (!friend) return;
        usedFriendIds.add(friend.id);

        const nativeName = card.querySelector<HTMLElement>('h4');
        const media = card.querySelector<HTMLImageElement>('img');
        const imageContainer = media?.parentElement as HTMLElement | null;
        const content = nativeName?.parentElement as HTMLElement | null;
        const nativeStatus = [...card.querySelectorAll<HTMLElement>('span')]
          .find(item =>
            normalizeText(item.textContent).startsWith('Status ·')
          ) ?? null;
        const footer = nativeRemoveButton.parentElement;

        if (
          !nativeName ||
          !imageContainer ||
          !content ||
          !footer
        ) {
          return;
        }

        let headingTarget = content.querySelector<HTMLElement>(
          '[data-profile-connected-heading-slot="true"]'
        );
        if (!headingTarget) {
          headingTarget = document.createElement('div');
          headingTarget.dataset.profileConnectedHeadingSlot = 'true';
          nativeName.insertAdjacentElement('beforebegin', headingTarget);
        }

        let imageTarget = imageContainer.querySelector<HTMLElement>(
          '[data-profile-connected-image-slot="true"]'
        );
        if (!imageTarget) {
          imageTarget = document.createElement('div');
          imageTarget.dataset.profileConnectedImageSlot = 'true';
          imageContainer.insertAdjacentElement('afterbegin', imageTarget);
        }

        let menuTarget = footer.querySelector<HTMLElement>(
          '[data-profile-connected-menu-slot="true"]'
        );
        if (!menuTarget) {
          menuTarget = document.createElement('div');
          menuTarget.dataset.profileConnectedMenuSlot = 'true';
          nativeRemoveButton.insertAdjacentElement('beforebegin', menuTarget);
        }

        nativeName.style.display = 'none';
        if (nativeStatus) nativeStatus.style.display = 'none';
        nativeRemoveButton.style.display = 'none';

        const nativeFavoriteButton = card.querySelector<HTMLButtonElement>(
          'button[aria-label="Favoritar contato"], button[aria-label="Remover dos favoritos"]'
        );
        if (nativeFavoriteButton) {
          nativeFavoriteButton.style.zIndex = '4';
        }

        const chatButton = findButtonByText(card, 'Chat');
        const status = statusByAuthor.get(friend.id) ?? null;

        nextTargets.push({
          key: friend.id,
          card,
          headingTarget,
          imageTarget,
          menuTarget,
          nativeName,
          nativeStatus,
          nativeRemoveButton,
          nativeFavoriteButton,
          chatButton,
          friend,
          status,
          statusLabel: nativeStatus
            ? normalizeText(nativeStatus.textContent)
            : '',
        });
      });

      setTargets(current =>
        sameTargets(current, nextTargets) ? current : nextTargets
      );
    };

    synchronize();
    const timer = window.setInterval(synchronize, 250);

    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll<HTMLElement>(
          '[data-profile-connected-heading-slot="true"], [data-profile-connected-image-slot="true"], [data-profile-connected-menu-slot="true"]'
        )
        .forEach(target => target.remove());
      document
        .querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Remover "]'
        )
        .forEach(button => {
          button.style.display = '';
        });
    };
  }, [directory.friends, statusByAuthor]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  };

  const openGroups = (target: ConnectedCardTarget) => {
    const profileModal = document.getElementById(
      'profile-social-hub-modal'
    );
    const groupsButton = profileModal
      ? findButtonByText(profileModal, 'Grupos')
      : null;

    setMenuContact(null);
    if (!groupsButton) {
      showNotice('Não foi possível abrir os grupos agora.');
      return;
    }

    groupsButton.click();
    showNotice(
      `Selecione os grupos para organizar ${target.friend.name}.`
    );
  };

  const removeConnection = async () => {
    const selected = removeContact;
    if (!selected) return;

    setBusy(true);
    try {
      await Promise.resolve(
        directory.handleToggleFriend(selected.target.friend.id)
      );
      setRemoveContact(null);
      showNotice('Conexão removida.');
    } catch {
      showNotice('Não foi possível remover a conexão.');
    } finally {
      setBusy(false);
    }
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
      {targets.map(target => {
        const selected = { target } satisfies SelectedContact;
        return (
          <div key={target.key}>
            {createPortal(
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setProfileContact(selected)}
                  className="min-w-0 flex-1 truncate text-left text-xs font-black text-white hover:text-sky-300"
                  aria-label={`Abrir perfil de ${target.friend.name}`}
                >
                  {target.friend.name}
                </button>
                {target.status && (
                  <button
                    type="button"
                    onClick={() => setStatusContact(selected)}
                    className="shrink-0 rounded-full border border-teal-400/30 bg-slate-950/85 px-2 py-1 text-[8px] font-black uppercase text-teal-300"
                    aria-label={`Ver Status de ${target.friend.name}`}
                  >
                    {target.statusLabel || 'Status'}
                  </button>
                )}
              </div>,
              target.headingTarget
            )}

            {createPortal(
              <button
                type="button"
                onClick={() =>
                  target.status
                    ? setStatusContact(selected)
                    : setProfileContact(selected)
                }
                className="absolute inset-0 z-[2] rounded-t-3xl"
                aria-label={
                  target.status
                    ? `Ver Status de ${target.friend.name}`
                    : `Abrir perfil de ${target.friend.name}`
                }
              />,
              target.imageTarget
            )}

            {createPortal(
              <button
                type="button"
                onClick={() => setMenuContact(selected)}
                className="flex h-10 w-[42px] items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                aria-label={`Mais ações para ${target.friend.name}`}
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>,
              target.menuTarget
            )}
          </div>
        );
      })}

      {menuContact && (
        <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-slate-950 p-4 sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[9px] font-black uppercase text-sky-300">
                  Conectado
                </span>
                <h3 className="truncate text-base font-black text-white">
                  {menuContact.target.friend.name}
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
                onClick={() => openGroups(menuContact.target)}
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
        </div>
      )}

      {profileContact && (
        <div className="fixed inset-0 z-[191] flex items-end justify-center bg-slate-950/95 backdrop-blur-md sm:items-center sm:p-4">
          <section className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-800 bg-slate-950 sm:rounded-3xl">
            <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
              {profileContact.target.friend.avatar ? (
                <img
                  src={profileContact.target.friend.avatar}
                  alt={profileContact.target.friend.name}
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
                {profileContact.target.friend.name}
              </h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                {profileContact.target.friend.bio ||
                  profileContact.target.friend.role ||
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
        </div>
      )}

      {statusContact && statusContact.target.status && (
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
                alt={`Status de ${statusContact.target.friend.name}`}
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
                  {statusContact.target.friend.name}
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
        </div>
      )}

      {removeContact && (
        <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
          <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
            <UserMinus className="h-6 w-6 text-red-300" />
            <h3 className="mt-4 text-base font-black text-white">
              Remover esta conexão?
            </h3>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {removeContact.target.friend.name} deixará de aparecer entre seus conectados.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoveContact(null)}
                className="h-11 rounded-xl border border-slate-800 bg-slate-900 text-[9px] font-black uppercase text-slate-400"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeConnection()}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500 text-[9px] font-black uppercase text-white disabled:opacity-50"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Remover
              </button>
            </div>
          </section>
        </div>
      )}

      {reportContact && (
        <div className="fixed inset-0 z-[193] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-md">
          <section className="w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5">
            <Flag className="h-6 w-6 text-red-300" />
            <h3 className="mt-4 text-base font-black text-white">
              Denunciar este Status?
            </h3>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              O conteúdo ativo de {reportContact.target.friend.name} será enviado para análise.
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
        </div>
      )}

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-[200] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-[10px] font-bold text-white shadow-2xl">
          {notice}
        </div>
      )}
    </>
  );
}
