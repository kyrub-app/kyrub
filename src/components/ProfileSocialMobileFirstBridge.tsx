import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import type { Friend } from '../types';
import { useSocialDirectoryV2 } from '../hooks/useSocialDirectoryV2';
import { auth, db } from '../utils/firebase';
import { ChatModal } from './modals/ChatModal';

const findButtonByText = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    button.textContent?.trim().startsWith(label)
  ) ?? null;

const normalizeName = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

export function ProfileSocialMobileFirstBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [savedHost, setSavedHost] = useState<HTMLElement | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [selectedChatUser, setSelectedChatUser] = useState<Friend | null>(null);
  const [chatMessageText, setChatMessageText] = useState('');

  const originalEditButtonRef = useRef<HTMLButtonElement | null>(null);
  const originalSavedButtonRef = useRef<HTMLButtonElement | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  const rebindRef = useRef<() => void>(() => undefined);
  const boundEditButtonsRef = useRef(
    new Map<HTMLButtonElement, EventListener>()
  );
  const boundChatButtonsRef = useRef(
    new Map<HTMLButtonElement, EventListener>()
  );

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
    if (!user) return;
    return onSnapshot(collection(db, 'users'), snapshot => {
      directory.setDbUsers(
        snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      );
    });
  }, [directory.setDbUsers, user]);

  useEffect(() => {
    friendsRef.current = directory.friends;
    rebindRef.current();
  }, [directory.friends]);

  useEffect(() => {
    const decorateProfileHeader = (modal: HTMLElement) => {
      const editTrigger = modal.querySelector<HTMLButtonElement>(
        'button[aria-label="Alterar foto do perfil"], button[data-kyrub-profile-edit-trigger]'
      );
      const originalEditButton = findButtonByText(modal, 'Editar perfil');
      const originalSavedButton = findButtonByText(modal, 'Salvos');
      const offersButton = modal.querySelector<HTMLButtonElement>(
        'button[aria-label="Abrir Ofertas"]'
      );

      originalEditButtonRef.current = originalEditButton;
      originalSavedButtonRef.current = originalSavedButton;

      if (editTrigger) {
        editTrigger.setAttribute('data-kyrub-profile-edit-trigger', 'true');
        editTrigger.setAttribute('aria-label', 'Editar perfil');
        editTrigger.setAttribute('title', 'Editar perfil');

        const mainPhoto = editTrigger.parentElement?.querySelector<HTMLElement>(
          'img, [role="img"]'
        );
        mainPhoto?.setAttribute('data-kyrub-profile-portrait-4x5', 'true');

        if (!boundEditButtonsRef.current.has(editTrigger)) {
          const handler: EventListener = event => {
            event.preventDefault();
            event.stopPropagation();
            if ('stopImmediatePropagation' in event) {
              event.stopImmediatePropagation();
            }
            originalEditButtonRef.current?.click();
          };
          editTrigger.addEventListener('click', handler, true);
          boundEditButtonsRef.current.set(editTrigger, handler);
        }
      }

      const galleryButton = findButtonByText(modal, 'Galeria');
      const editPreview = galleryButton?.parentElement?.parentElement?.querySelector<HTMLElement>(
        'img, [role="img"]'
      );
      editPreview?.setAttribute('data-kyrub-profile-portrait-4x5', 'true');

      if (originalEditButton) originalEditButton.style.display = 'none';
      if (originalSavedButton) {
        originalSavedButton.style.display = 'none';
        const parsedCount = Number(
          originalSavedButton.textContent?.match(/\d+/)?.[0] ?? '0'
        );
        setSavedCount(current =>
          current === parsedCount ? current : parsedCount
        );
      }

      const originalActions = originalSavedButton?.parentElement;
      if (originalActions && originalActions.contains(originalEditButton)) {
        originalActions.setAttribute(
          'data-kyrub-original-profile-actions',
          'true'
        );
      }

      if (offersButton?.parentElement) {
        offersButton.parentElement.setAttribute(
          'data-kyrub-profile-header-row',
          'true'
        );
        let host = offersButton.parentElement.querySelector<HTMLElement>(
          '[data-kyrub-saved-action-host]'
        );
        if (!host) {
          host = document.createElement('span');
          host.setAttribute('data-kyrub-saved-action-host', 'true');
          host.style.display = 'contents';
          offersButton.parentElement.insertBefore(host, offersButton);
        }
        setSavedHost(current => (current === host ? current : host));
      }
    };

    const decorateConnectedCards = (modal: HTMLElement) => {
      const favoriteButtons = Array.from(
        modal.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Favoritar contato"]'
        )
      );
      if (favoriteButtons.length === 0) return;

      const articles = favoriteButtons
        .map(button => button.closest<HTMLElement>('article'))
        .filter((article): article is HTMLElement => Boolean(article));
      const grid = articles[0]?.parentElement;
      grid?.setAttribute('data-kyrub-connected-grid', 'true');

      articles.forEach((article, index) => {
        article.setAttribute('data-kyrub-contact-card', 'true');
        const header = article.firstElementChild as HTMLElement | null;
        const actions = article.children[1] as HTMLElement | undefined;
        const favoriteButton = favoriteButtons[index];
        const avatar = header?.querySelector<HTMLElement>('img, [role="img"]');
        const info = header?.children[1] as HTMLElement | undefined;
        const chatButton = actions?.children[0] as HTMLButtonElement | undefined;
        const removeButton = actions?.children[1] as HTMLButtonElement | undefined;
        const renderedName = article.querySelector('h4')?.textContent ?? '';
        const normalizedRenderedName = normalizeName(renderedName);
        const friend =
          friendsRef.current.find(
            item => normalizeName(item.name) === normalizedRenderedName
          ) ?? friendsRef.current[index];

        if (friend) article.dataset.kyrubContactId = friend.id;
        header?.setAttribute('data-kyrub-contact-header', 'true');
        avatar?.setAttribute('data-kyrub-contact-cover', 'true');
        info?.setAttribute('data-kyrub-contact-info', 'true');
        favoriteButton?.setAttribute('data-kyrub-contact-favorite', 'true');
        actions?.setAttribute('data-kyrub-contact-actions', 'true');
        chatButton?.setAttribute('data-kyrub-contact-chat', 'true');
        removeButton?.setAttribute('data-kyrub-contact-remove', 'true');
        removeButton?.setAttribute('aria-label', `Remover ${renderedName}`);

        if (chatButton && !boundChatButtonsRef.current.has(chatButton)) {
          const handler: EventListener = event => {
            event.preventDefault();
            event.stopPropagation();
            if ('stopImmediatePropagation' in event) {
              event.stopImmediatePropagation();
            }
            const contactId = article.dataset.kyrubContactId;
            const selected = friendsRef.current.find(
              item => item.id === contactId
            );
            if (selected) {
              setChatMessageText('');
              setSelectedChatUser(selected);
            }
          };
          chatButton.addEventListener('click', handler, true);
          boundChatButtonsRef.current.set(chatButton, handler);
        }
      });
    };

    const bind = () => {
      const modal = document.getElementById('profile-social-hub-modal');
      if (!modal) {
        setSavedHost(current => (current ? null : current));
        return;
      }
      decorateProfileHeader(modal);
      decorateConnectedCards(modal);
    };

    rebindRef.current = bind;
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      rebindRef.current = () => undefined;
      for (const [button, handler] of boundEditButtonsRef.current) {
        button.removeEventListener('click', handler, true);
      }
      for (const [button, handler] of boundChatButtonsRef.current) {
        button.removeEventListener('click', handler, true);
      }
      boundEditButtonsRef.current.clear();
      boundChatButtonsRef.current.clear();
    };
  }, []);

  return (
    <>
      <style>{`
        [data-kyrub-profile-portrait-4x5="true"] {
          width: 88px !important;
          height: 110px !important;
          min-width: 88px !important;
          border-radius: 18px !important;
          object-fit: cover !important;
        }
        @media (min-width: 640px) {
          [data-kyrub-profile-portrait-4x5="true"] {
            width: 104px !important;
            height: 130px !important;
            min-width: 104px !important;
          }
        }
        [data-kyrub-profile-edit-trigger="true"] {
          right: 6px !important;
          bottom: 6px !important;
          width: 34px !important;
          height: 34px !important;
        }
        [data-kyrub-profile-edit-trigger="true"] > svg {
          display: none !important;
        }
        [data-kyrub-profile-edit-trigger="true"]::before {
          content: "✎";
          font-size: 18px;
          font-weight: 900;
          line-height: 1;
        }
        [data-kyrub-original-profile-actions="true"] {
          display: none !important;
        }
        [data-kyrub-profile-header-row="true"] {
          justify-content: flex-start !important;
        }
        [data-kyrub-profile-header-row="true"] > div:first-child {
          flex: 1 1 auto !important;
        }
        [data-kyrub-connected-grid="true"] {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 12px !important;
        }
        [data-kyrub-contact-card="true"] {
          display: flex !important;
          min-width: 0 !important;
          min-height: 242px !important;
          flex-direction: column !important;
          overflow: hidden !important;
          padding: 0 !important;
          border-radius: 24px !important;
        }
        [data-kyrub-contact-header="true"] {
          position: relative !important;
          display: block !important;
        }
        [data-kyrub-contact-cover="true"] {
          width: 100% !important;
          height: auto !important;
          aspect-ratio: 4 / 3 !important;
          border-width: 0 !important;
          border-radius: 0 !important;
          object-fit: cover !important;
        }
        [data-kyrub-contact-info="true"] {
          min-height: 62px !important;
          padding: 12px !important;
        }
        [data-kyrub-contact-favorite="true"] {
          position: absolute !important;
          top: 8px !important;
          right: 8px !important;
          display: flex !important;
          width: 36px !important;
          height: 36px !important;
          align-items: center !important;
          justify-content: center !important;
          border: 1px solid rgba(255,255,255,.14) !important;
          border-radius: 999px !important;
          background: rgba(2,6,23,.82) !important;
          backdrop-filter: blur(10px) !important;
        }
        [data-kyrub-contact-actions="true"] {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 42px !important;
          gap: 8px !important;
          margin-top: auto !important;
          padding: 8px !important;
          border-top: 1px solid rgb(30 41 59) !important;
        }
        [data-kyrub-contact-chat="true"] {
          min-width: 0 !important;
          height: 40px !important;
          padding: 0 8px !important;
        }
        [data-kyrub-contact-remove="true"] {
          display: flex !important;
          width: 42px !important;
          height: 40px !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 !important;
          font-size: 0 !important;
        }
        [data-kyrub-contact-remove="true"] svg {
          width: 16px !important;
          height: 16px !important;
        }
      `}</style>

      {savedHost &&
        createPortal(
          <button
            type="button"
            onClick={() => originalSavedButtonRef.current?.click()}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300"
            aria-label="Abrir publicações salvas"
            title="Salvos"
          >
            <Bookmark className="h-5 w-5" />
            {savedCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-400 px-1 text-center text-[8px] font-black text-slate-950">
                {savedCount}
              </span>
            )}
          </button>,
          savedHost
        )}

      <ChatModal
        isOpen={Boolean(selectedChatUser)}
        onClose={() => setSelectedChatUser(null)}
        selectedChatUser={selectedChatUser}
        setSelectedChatUser={setSelectedChatUser}
        chatMessageText={chatMessageText}
        setChatMessageText={setChatMessageText}
      />
    </>
  );
}
