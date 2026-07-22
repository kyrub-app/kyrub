import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { onSnapshot, doc } from 'firebase/firestore';
import { StoreConfigModal as LegacyStoreConfigModal } from './LegacyStoreConfigModal';
import type { MarketplaceListingDocument } from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceStoreListingDocumentPath } from '../../utils/marketplacePaths';
import {
  buildConfiguredStore,
  hasPendingUserStoreSync,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
  setStoreMarketplacePublication,
} from '../../utils/storePersistence';

type StoreConfigModalProps = React.ComponentProps<
  typeof LegacyStoreConfigModal
>;

type ToastState = {
  message: string;
  type: 'success' | 'warning' | 'error';
} | null;

type SaveStoreResult = {
  localSaved: boolean;
  cloudSynced: boolean;
};

export const StoreConfigModal: React.FC<StoreConfigModalProps> = props => {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [canonicalPublished, setCanonicalPublished] = useState(false);
  const [fallbackPublished, setFallbackPublished] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [pendingSync, setPendingSync] = useState(false);

  const isPublished = canonicalPublished || fallbackPublished;

  const notify = (
    message: string,
    type: NonNullable<ToastState>['type']
  ): void => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => {
    if (!props.isOpen) {
      setActionsHost(null);
      return;
    }

    let originalSaveButton: HTMLButtonElement | null = null;
    let host: HTMLDivElement | null = null;
    let cancelled = false;

    const mountActions = (): void => {
      if (cancelled) return;

      originalSaveButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button')
      ).find(button =>
        button.textContent?.trim().toLowerCase().startsWith('salvar')
      ) ?? null;

      const footer = originalSaveButton?.parentElement;
      if (!originalSaveButton || !footer) {
        window.setTimeout(mountActions, 50);
        return;
      }

      originalSaveButton.style.display = 'none';
      host = document.createElement('div');
      host.id = 'kyrub-store-save-publish-actions';
      host.className = 'flex items-center gap-3';
      footer.appendChild(host);
      setActionsHost(host);
    };

    window.setTimeout(mountActions, 0);

    return () => {
      cancelled = true;
      if (originalSaveButton) {
        originalSaveButton.style.display = '';
      }
      host?.remove();
      setActionsHost(null);
    };
  }, [props.isOpen]);

  useEffect(() => {
    if (!props.isOpen) return;
    const user = auth.currentUser;
    if (!user) return;

    const cachedStore = loadCachedUserStore(
      localStorage,
      user.uid,
      user.email ?? ''
    );
    setPendingSync(hasPendingUserStoreSync(localStorage, user.uid));

    if (!cachedStore) return;

    // Run after the legacy parent initializes its controlled fields.
    window.setTimeout(() => {
      props.setConfigStoreName(cachedStore.name);
      props.setConfigStoreBio(cachedStore.description);
      props.setConfigStoreAddress(cachedStore.address ?? '');
      props.setConfigStoreContact(cachedStore.contact ?? '');
      props.setConfigStoreKeywords((cachedStore.keywords ?? []).join(', '));
    }, 0);
  }, [props.isOpen]);

  useEffect(() => {
    if (!props.isOpen) return;
    const user = auth.currentUser;
    if (!user) return;

    const unsubscribeCanonical = onSnapshot(
      doc(db, getMarketplaceStoreListingDocumentPath(user.uid)),
      snapshot => {
        const listing = snapshot.data() as MarketplaceListingDocument | undefined;
        setCanonicalPublished(
          listing?.listingType === 'store' &&
          listing.publicationStatus === 'published'
        );
      },
      () => setCanonicalPublished(false)
    );

    const unsubscribeFallback = onSnapshot(
      doc(db, 'tenants', user.uid),
      snapshot => {
        setFallbackPublished(
          snapshot.data()?.publicationStatus === 'published'
        );
      },
      () => setFallbackPublished(false)
    );

    return () => {
      unsubscribeCanonical();
      unsubscribeFallback();
    };
  }, [props.isOpen]);

  const configuredStore = useMemo(() => {
    const user = auth.currentUser;
    if (!user) return null;

    return buildConfiguredStore(
      loadCachedUserStore(localStorage, user.uid, user.email ?? ''),
      user,
      {
        name: props.configStoreName,
        description: props.configStoreBio,
        address: props.configStoreAddress,
        contact: props.configStoreContact,
        keywords: props.configStoreKeywords.split(','),
      }
    );
  }, [
    props.configStoreName,
    props.configStoreBio,
    props.configStoreAddress,
    props.configStoreContact,
    props.configStoreKeywords,
  ]);

  const saveStore = async (): Promise<SaveStoreResult> => {
    const user = auth.currentUser;
    if (!user || !configuredStore) {
      notify('Faça login novamente para salvar sua loja.', 'error');
      return { localSaved: false, cloudSynced: false };
    }

    saveCachedUserStore(
      localStorage,
      user.uid,
      configuredStore,
      true
    );
    setPendingSync(true);

    // The local cache is authoritative for the current session even when
    // the private Firestore document cannot be synchronized yet.
    window.dispatchEvent(
      new CustomEvent('kyrub-user-store-saved', {
        detail: { store: configuredStore },
      })
    );

    try {
      await persistPrivateUserStore(user, configuredStore);
      saveCachedUserStore(
        localStorage,
        user.uid,
        configuredStore,
        false
      );
      setPendingSync(false);
      return { localSaved: true, cloudSynced: true };
    } catch (error) {
      console.warn('Store kept locally while cloud sync is pending.', error);
      return { localSaved: true, cloudSynced: false };
    }
  };

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    const result = await saveStore();

    if (result.localSaved) {
      notify(
        result.cloudSynced
          ? 'Perfil da loja salvo com sucesso!'
          : 'Loja salva neste dispositivo. A sincronização com a nuvem ficou pendente.',
        result.cloudSynced ? 'success' : 'warning'
      );
    }

    setIsSaving(false);
    props.onClose();
  };

  const handlePublication = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user || !configuredStore) {
      notify('Faça login novamente para publicar sua loja.', 'error');
      return;
    }

    const targetPublished = !isPublished;

    if (targetPublished && !configuredStore.name) {
      notify('Informe o nome da loja antes de publicar.', 'error');
      return;
    }

    setIsPublishing(true);
    const saveResult = await saveStore();

    if (!saveResult.localSaved) {
      setIsPublishing(false);
      return;
    }

    try {
      // Marketplace publication is independent from the private-store sync.
      // A pending private sync must never block a public publish/pause action.
      await setStoreMarketplacePublication(
        user,
        configuredStore,
        targetPublished
      );

      // The compatibility marketplace write is guaranteed on a successful
      // return from setStoreMarketplacePublication, so update it immediately.
      setFallbackPublished(targetPublished);

      notify(
        targetPublished
          ? saveResult.cloudSynced
            ? 'Loja publicada no marketplace!'
            : 'Loja publicada. A sincronização privada continua pendente.'
          : saveResult.cloudSynced
            ? 'Loja ocultada do marketplace.'
            : 'Loja ocultada. A sincronização privada continua pendente.',
        saveResult.cloudSynced ? 'success' : 'warning'
      );
    } catch (error) {
      console.error('Store publication failed.', error);
      notify('Não foi possível alterar a publicação da loja.', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <>
      <LegacyStoreConfigModal {...props} />

      {actionsHost &&
        createPortal(
          <>
            {pendingSync && (
              <span className="hidden sm:inline text-[9px] font-mono uppercase text-amber-400">
                Sincronização pendente
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isPublishing}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
            >
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => void handlePublication()}
              disabled={isSaving || isPublishing}
              className={`font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isPublished
                  ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30'
                  : 'bg-teal-500 hover:bg-teal-600 text-slate-950'
              }`}
            >
              {isPublishing
                ? 'Processando...'
                : isPublished
                  ? 'Ocultar'
                  : 'Publicar'}
            </button>
          </>,
          actionsHost
        )}

      {toast &&
        createPortal(
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] bg-slate-900 border border-slate-700 text-white px-5 py-3.5 rounded-2xl shadow-2xl max-w-sm text-center">
            <span
              className={`text-[11px] font-bold font-mono uppercase tracking-wide ${
                toast.type === 'success'
                  ? 'text-emerald-300'
                  : toast.type === 'warning'
                    ? 'text-amber-300'
                    : 'text-red-300'
              }`}
            >
              {toast.message}
            </span>
          </div>,
          document.body
        )}
    </>
  );
};