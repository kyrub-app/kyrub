import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  FolderPlus,
  LoaderCircle,
  MessageCircle,
  MoreVertical,
  Plus,
  Star,
  UserMinus,
  UsersRound,
  X,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../utils/firebase';

const MAX_GROUPS = 30;
const MAX_GROUP_MEMBERS = 200;

type ContactGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

type ContactReference = {
  id: string;
  name: string;
};

const CHAT_ICON = `
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path>
  </svg>
`;

const MENU_ICON = `
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="1"></circle>
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="12" cy="19" r="1"></circle>
  </svg>
`;

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

const groupFromDocument = (
  id: string,
  data: Record<string, unknown>
): ContactGroup | null => {
  const name = readString(data.name);
  if (!name) return null;
  return {
    id,
    name,
    memberIds: readStringList(data.memberIds),
  };
};

const readContactFromCard = (
  article: HTMLElement
): ContactReference | null => {
  const id = article.dataset.kyrubContactId?.trim() ?? '';
  const name = article.querySelector('h4')?.textContent?.trim() ?? '';
  return id && name ? { id, name } : null;
};

const favoriteIsActive = (button: HTMLButtonElement | null): boolean =>
  Boolean(
    button &&
      (button.className.includes('text-amber-400') ||
        button.querySelector('.fill-current'))
  );

export function ProfileConnectedCardOrganizationBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [favoritesMode, setFavoritesMode] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [favoritesButtonHost, setFavoritesButtonHost] =
    useState<HTMLElement | null>(null);
  const [favoritesEmptyHost, setFavoritesEmptyHost] =
    useState<HTMLElement | null>(null);
  const [menuContact, setMenuContact] =
    useState<ContactReference | null>(null);
  const [groupContact, setGroupContact] =
    useState<ContactReference | null>(null);
  const [removeContact, setRemoveContact] =
    useState<ContactReference | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const favoritesModeRef = useRef(false);
  const decorateRef = useRef<() => void>(() => undefined);
  const originalChatButtonsRef = useRef(
    new Map<string, HTMLButtonElement>()
  );
  const originalRemoveButtonsRef = useRef(
    new Map<string, HTMLButtonElement>()
  );

  useEffect(() => onAuthStateChanged(auth, setUser), []);

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
        setErrorMessage('');
      },
      error => {
        console.warn('Não foi possível carregar os grupos dos contatos.', error);
        setErrorMessage('Não foi possível carregar os grupos agora.');
      }
    );
  }, [user]);

  useEffect(() => {
    favoritesModeRef.current = favoritesMode;
    const modal = document.getElementById('profile-social-hub-modal');
    if (modal) {
      modal.dataset.kyrubFavoritesMode = String(favoritesMode);
    }
    decorateRef.current();
  }, [favoritesMode]);

  useEffect(() => {
    const decorateNavigation = (modal: HTMLElement) => {
      const listButton = findButtonByText(modal, 'Minha lista');
      const suggestionsButton = findButtonByText(modal, 'Sugestões');
      const requestsButton = findButtonByText(modal, 'Solicitações');
      const nav = listButton?.parentElement;
      if (!nav || !listButton || !suggestionsButton || !requestsButton) {
        setFavoritesButtonHost(current =>
          current?.isConnected ? null : current
        );
        return;
      }

      nav.dataset.kyrubConnectionOrganizationSubnav = 'true';

      let host = nav.querySelector<HTMLElement>(
        '[data-kyrub-favorites-button-host]'
      );
      if (!host) {
        host = document.createElement('span');
        host.dataset.kyrubFavoritesButtonHost = 'true';
        host.style.display = 'contents';
      }
      if (host.previousElementSibling !== listButton) {
        listButton.insertAdjacentElement('afterend', host);
      }
      setFavoritesButtonHost(current => (current === host ? current : host));

      const groupsHost = nav.querySelector<HTMLElement>(
        '[data-kyrub-groups-button-host]'
      );
      if (groupsHost && groupsHost.nextElementSibling !== requestsButton) {
        nav.insertBefore(groupsHost, requestsButton);
      }
    };

    const decorateCards = (modal: HTMLElement) => {
      const articles = Array.from(
        modal.querySelectorAll<HTMLElement>('[data-kyrub-contact-card]')
      );
      let favoriteCount = 0;

      for (const article of articles) {
        const contact = readContactFromCard(article);
        if (!contact) continue;

        const header = article.querySelector<HTMLElement>(
          '[data-kyrub-contact-header]'
        );
        const info = article.querySelector<HTMLElement>(
          '[data-kyrub-contact-info]'
        );
        const favoriteButton = article.querySelector<HTMLButtonElement>(
          '[data-kyrub-contact-favorite]'
        );
        const originalChatButton = article.querySelector<HTMLButtonElement>(
          '[data-kyrub-contact-chat]'
        );
        const originalRemoveButton = article.querySelector<HTMLButtonElement>(
          '[data-kyrub-contact-remove]'
        );

        const favorited = favoriteIsActive(favoriteButton);
        article.dataset.kyrubContactFavoriteState = String(favorited);
        if (favorited) favoriteCount += 1;

        if (originalChatButton) {
          originalChatButtonsRef.current.set(contact.id, originalChatButton);
        }
        if (originalRemoveButton) {
          originalRemoveButtonsRef.current.set(contact.id, originalRemoveButton);
        }

        if (info) {
          info.dataset.kyrubContactInfoCompact = 'true';
          let chatProxy = info.querySelector<HTMLButtonElement>(
            '[data-kyrub-contact-chat-proxy]'
          );
          if (!chatProxy) {
            chatProxy = document.createElement('button');
            chatProxy.type = 'button';
            chatProxy.dataset.kyrubContactChatProxy = 'true';
            chatProxy.innerHTML = CHAT_ICON;
            info.appendChild(chatProxy);
          }
          chatProxy.dataset.contactId = contact.id;
          chatProxy.setAttribute('aria-label', `Conversar com ${contact.name}`);
          chatProxy.setAttribute('title', `Chat com ${contact.name}`);
        }

        if (header) {
          let menuButton = header.querySelector<HTMLButtonElement>(
            '[data-kyrub-contact-menu-trigger]'
          );
          if (!menuButton) {
            menuButton = document.createElement('button');
            menuButton.type = 'button';
            menuButton.dataset.kyrubContactMenuTrigger = 'true';
            menuButton.innerHTML = MENU_ICON;
            header.appendChild(menuButton);
          }
          menuButton.dataset.contactId = contact.id;
          menuButton.dataset.contactName = contact.name;
          menuButton.setAttribute(
            'aria-label',
            `Mais opções para ${contact.name}`
          );
          menuButton.setAttribute('title', 'Mais opções');
        }
      }

      setFavoritesCount(current =>
        current === favoriteCount ? current : favoriteCount
      );

      const grid = modal.querySelector<HTMLElement>(
        '[data-kyrub-connected-grid]'
      );
      if (grid) {
        let emptyHost = grid.parentElement?.querySelector<HTMLElement>(
          '[data-kyrub-favorites-empty-host]'
        );
        if (!emptyHost) {
          emptyHost = document.createElement('div');
          emptyHost.dataset.kyrubFavoritesEmptyHost = 'true';
          grid.insertAdjacentElement('afterend', emptyHost);
        }
        setFavoritesEmptyHost(current =>
          current === emptyHost ? current : emptyHost
        );
      }
    };

    const decorate = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        setFavoritesButtonHost(null);
        setFavoritesEmptyHost(null);
        return;
      }
      modal.dataset.kyrubFavoritesMode = String(favoritesModeRef.current);
      decorateNavigation(modal);
      decorateCards(modal);
    };

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;

      const chatProxy = target.closest<HTMLButtonElement>(
        '[data-kyrub-contact-chat-proxy]'
      );
      if (chatProxy) {
        event.preventDefault();
        event.stopPropagation();
        originalChatButtonsRef.current
          .get(chatProxy.dataset.contactId ?? '')
          ?.click();
        return;
      }

      const menuButton = target.closest<HTMLButtonElement>(
        '[data-kyrub-contact-menu-trigger]'
      );
      if (menuButton) {
        event.preventDefault();
        event.stopPropagation();
        setMenuContact({
          id: menuButton.dataset.contactId ?? '',
          name: menuButton.dataset.contactName ?? 'Contato',
        });
        return;
      }

      const favoriteButton = target.closest<HTMLButtonElement>(
        '[data-kyrub-contact-favorite]'
      );
      if (favoriteButton) {
        window.setTimeout(() => decorateRef.current(), 0);
        window.setTimeout(() => decorateRef.current(), 180);
        return;
      }

      const regularSubtab = target.closest<HTMLButtonElement>('button');
      if (
        regularSubtab &&
        !regularSubtab.hasAttribute('data-kyrub-favorites-subtab') &&
        ['Minha lista', 'Sugestões', 'Grupos', 'Solicitações'].some(label =>
          regularSubtab.textContent?.trim().startsWith(label)
        )
      ) {
        setFavoritesMode(false);
      }
    };

    decorateRef.current = decorate;
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    document.addEventListener('click', onDocumentClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onDocumentClick, true);
      decorateRef.current = () => undefined;
      originalChatButtonsRef.current.clear();
      originalRemoveButtonsRef.current.clear();
      const modal = document.getElementById('profile-social-hub-modal');
      if (modal) delete modal.dataset.kyrubFavoritesMode;
      document
        .querySelectorAll<HTMLElement>(
          '[data-kyrub-contact-chat-proxy], [data-kyrub-contact-menu-trigger], [data-kyrub-favorites-button-host], [data-kyrub-favorites-empty-host]'
        )
        .forEach(element => element.remove());
    };
  }, []);

  const openFavorites = () => {
    const modal = document.getElementById('profile-social-hub-modal');
    const listButton = modal ? findButtonByText(modal, 'Minha lista') : null;
    listButton?.click();
    window.setTimeout(() => setFavoritesMode(true), 0);
  };

  const toggleGroupMembership = async (
    group: ContactGroup,
    contact: ContactReference
  ) => {
    if (!user || busy) return;
    const memberIds = group.memberIds.includes(contact.id)
      ? group.memberIds.filter(memberId => memberId !== contact.id)
      : [...group.memberIds, contact.id].slice(0, MAX_GROUP_MEMBERS);

    setBusy(true);
    setErrorMessage('');
    try {
      await updateDoc(
        doc(db, `users/${user.uid}/contact_groups/${group.id}`),
        {
          memberIds,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.warn('Não foi possível atualizar o grupo.', error);
      setErrorMessage('Não foi possível atualizar este grupo agora.');
    } finally {
      setBusy(false);
    }
  };

  const createGroupForContact = async (event: FormEvent) => {
    event.preventDefault();
    const name = groupNameDraft.trim().slice(0, 60);
    if (!user || !groupContact || !name || busy) return;
    if (groups.length >= MAX_GROUPS) {
      setErrorMessage(`Você pode criar até ${MAX_GROUPS} grupos.`);
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      const reference = doc(
        collection(db, `users/${user.uid}/contact_groups`)
      );
      await setDoc(reference, {
        groupId: reference.id,
        ownerId: user.uid,
        name,
        memberIds: [groupContact.id],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setGroupNameDraft('');
    } catch (error) {
      console.warn('Não foi possível criar o grupo.', error);
      setErrorMessage('Não foi possível criar o grupo agora.');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoveConnection = async () => {
    if (!user || !removeContact || busy) return;
    const removeButton = originalRemoveButtonsRef.current.get(removeContact.id);
    if (!removeButton?.isConnected) {
      setErrorMessage('O contato não está mais disponível nesta tela.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      await Promise.all(
        groups
          .filter(group => group.memberIds.includes(removeContact.id))
          .map(group =>
            updateDoc(
              doc(db, `users/${user.uid}/contact_groups/${group.id}`),
              {
                memberIds: group.memberIds.filter(
                  memberId => memberId !== removeContact.id
                ),
                updatedAt: serverTimestamp(),
              }
            )
          )
      );
      removeButton.click();
      setRemoveContact(null);
      setMenuContact(null);
    } catch (error) {
      console.warn('Não foi possível remover a conexão.', error);
      setErrorMessage('Não foi possível remover esta conexão agora.');
    } finally {
      setBusy(false);
    }
  };

  const groupMembershipCount = menuContact
    ? groups.filter(group => group.memberIds.includes(menuContact.id)).length
    : 0;

  return (
    <>
      <style>{`
        [data-kyrub-connection-organization-subnav="true"] {
          display: flex !important;
          grid-template-columns: none !important;
          gap: 8px !important;
          overflow-x: auto !important;
          padding-bottom: 4px !important;
          scrollbar-width: none;
        }
        [data-kyrub-connection-organization-subnav="true"]::-webkit-scrollbar {
          display: none;
        }
        [data-kyrub-connection-organization-subnav="true"] button {
          min-width: 118px !important;
          flex: 0 0 auto !important;
        }
        [data-kyrub-favorites-mode="true"]
          [data-kyrub-contact-card="true"][data-kyrub-contact-favorite-state="false"] {
          display: none !important;
        }
        [data-kyrub-contact-card="true"] {
          min-height: 0 !important;
        }
        [data-kyrub-contact-actions="true"] {
          display: none !important;
        }
        [data-kyrub-contact-info-compact="true"] {
          position: relative !important;
          min-height: 76px !important;
          padding-right: 58px !important;
        }
        [data-kyrub-contact-chat-proxy="true"] {
          position: absolute;
          right: 10px;
          bottom: 10px;
          display: flex;
          width: 40px;
          height: 40px;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          background: rgb(249 115 22);
          color: rgb(2 6 23);
          box-shadow: 0 8px 20px rgba(249,115,22,.18);
        }
        [data-kyrub-contact-favorite="true"] {
          right: 52px !important;
        }
        [data-kyrub-contact-menu-trigger="true"] {
          position: absolute;
          z-index: 5;
          top: 8px;
          right: 8px;
          display: flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 999px;
          background: rgba(2,6,23,.82);
          color: rgb(148 163 184);
          backdrop-filter: blur(10px);
        }
      `}</style>

      {favoritesButtonHost &&
        createPortal(
          <button
            type="button"
            onClick={openFavorites}
            className={`rounded-2xl border p-3 text-center ${
              favoritesMode
                ? 'border-amber-500/45 bg-amber-500/10'
                : 'border-slate-800 bg-slate-900'
            }`}
            data-kyrub-favorites-subtab="true"
          >
            <strong className="block text-sm text-white">
              {favoritesCount}
            </strong>
            <span className="mt-1 block text-xs font-black uppercase text-slate-500">
              Favoritos
            </span>
          </button>,
          favoritesButtonHost
        )}

      {favoritesEmptyHost && favoritesMode && favoritesCount === 0 &&
        createPortal(
          <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-10 text-center">
            <Star className="mx-auto h-8 w-8 text-slate-700" />
            <h4 className="mt-3 text-sm font-black text-white">
              Nenhum contato favorito
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Use a estrela no card para reunir aqui os contatos mais importantes.
            </p>
          </div>,
          favoritesEmptyHost
        )}

      {menuContact &&
        createPortal(
          <div
            className="fixed inset-0 z-[206] flex justify-center bg-slate-950/80 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm"
            onClick={() => setMenuContact(null)}
          >
            <section
              className="mt-12 w-full max-w-sm overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl"
              onClick={event => event.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-xs font-black uppercase text-orange-400">
                    Contato conectado
                  </span>
                  <h3 className="truncate text-lg font-black text-white">
                    {menuContact.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuContact(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-slate-400"
                  aria-label="Fechar opções do contato"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="space-y-2 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setGroupContact(menuContact);
                    setMenuContact(null);
                    setErrorMessage('');
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 text-left text-sm font-black text-violet-200"
                >
                  <FolderPlus className="h-5 w-5" />
                  <span className="min-w-0 flex-1">
                    {groupMembershipCount > 0
                      ? 'Gerenciar grupos'
                      : 'Adicionar a grupo'}
                  </span>
                  {groupMembershipCount > 0 && (
                    <span className="rounded-full bg-violet-400 px-2 py-0.5 text-xs text-slate-950">
                      {groupMembershipCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveContact(menuContact);
                    setMenuContact(null);
                    setErrorMessage('');
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-left text-sm font-black text-red-200"
                >
                  <UserMinus className="h-5 w-5" />
                  Remover conexão
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}

      {groupContact &&
        createPortal(
          <div className="fixed inset-0 z-[208] flex justify-center bg-slate-950/95 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md">
            <section className="flex max-h-[calc(100dvh-24px)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl">
              <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                  <span className="text-xs font-black uppercase text-violet-300">
                    Organizar contato
                  </span>
                  <h3 className="truncate text-lg font-black text-white">
                    {groupContact.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGroupContact(null);
                    setGroupNameDraft('');
                    setErrorMessage('');
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-slate-400"
                  aria-label="Fechar grupos do contato"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {errorMessage && (
                  <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {errorMessage}
                  </p>
                )}

                <div className="space-y-2">
                  {groups.map(group => {
                    const selected = group.memberIds.includes(groupContact.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void toggleGroupMembership(group, groupContact)
                        }
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
                          selected
                            ? 'border-violet-500/45 bg-violet-500/10'
                            : 'border-slate-800 bg-slate-900'
                        }`}
                      >
                        <UsersRound className="h-5 w-5 shrink-0 text-violet-300" />
                        <span className="min-w-0 flex-1 truncate text-sm font-black text-white">
                          {group.name}
                        </span>
                        {selected && <Check className="h-5 w-5 text-violet-300" />}
                      </button>
                    );
                  })}
                </div>

                {groups.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 px-5 py-8 text-center">
                    <UsersRound className="mx-auto h-8 w-8 text-slate-700" />
                    <h4 className="mt-3 text-sm font-black text-white">
                      Nenhum grupo criado
                    </h4>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Crie o primeiro grupo abaixo e este contato já será incluído.
                    </p>
                  </div>
                )}

                <form
                  onSubmit={createGroupForContact}
                  className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-300">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-white">
                        Criar novo grupo
                      </h4>
                      <p className="text-xs text-slate-500">
                        O contato será adicionado automaticamente.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={groupNameDraft}
                      onChange={event =>
                        setGroupNameDraft(event.target.value.slice(0, 60))
                      }
                      placeholder="Nome do grupo"
                      className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-violet-500/50"
                    />
                    <button
                      type="submit"
                      disabled={!groupNameDraft.trim() || busy}
                      className="rounded-xl bg-violet-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                    >
                      Criar
                    </button>
                  </div>
                </form>
              </div>

              {busy && (
                <div className="flex items-center justify-center gap-2 border-t border-slate-800 px-4 py-3 text-sm font-bold text-violet-200">
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  Atualizando grupos...
                </div>
              )}
            </section>
          </div>,
          document.body
        )}

      {removeContact &&
        createPortal(
          <div className="fixed inset-0 z-[210] flex justify-center bg-slate-950/95 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-md">
            <section className="mt-12 w-full max-w-sm rounded-3xl border border-red-500/25 bg-slate-950 p-5 shadow-2xl">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
                <UserMinus className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-black text-white">
                Remover {removeContact.name}?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                A conexão será encerrada e o contato também será retirado dos seus grupos. O histórico do chat não será apagado automaticamente.
              </p>
              {errorMessage && (
                <p className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMessage}
                </p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRemoveContact(null);
                    setErrorMessage('');
                  }}
                  className="rounded-xl border border-slate-800 bg-slate-900 py-3 text-sm font-black text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmRemoveConnection()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-red-500 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  {busy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserMinus className="h-4 w-4" />
                  )}
                  Remover
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
