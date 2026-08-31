import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { StoreConfigModal as LegacyStoreConfigModal } from './LegacyStoreConfigModal';
import { GoogleDriveImagePickerButton } from '../GoogleDriveImagePickerButton';
import { GooglePhotosImagePickerButton } from '../GooglePhotosImagePickerButton';
import { StoreIntegrationsPanel } from '../store/StoreIntegrationsPanel';
import { StoreLocationEditor } from '../store/StoreLocationEditor';
import { StoreOpeningHoursEditor } from '../store/StoreOpeningHoursEditor';
import type { MarketplaceListingDocument, Store } from '../../types';
import { auth, db } from '../../utils/firebase';
import { getMarketplaceStoreListingDocumentPath } from '../../utils/marketplacePaths';
import {
  parseStoreLocationDraft,
  type StoreLocationDraft,
} from '../../utils/storeLocation';
import {
  createEmptyStoreOperationalSettings,
  loadCachedStoreOperationalSettings,
  persistStoreOperationalSettings,
  saveCachedStoreOperationalSettings,
  subscribeToStoreOperationalSettings,
  validateStoreOpeningHours,
  type StoreOperationalSettings,
} from '../../utils/storeOperationalSettings';
import {
  buildConfiguredStore,
  hasPendingUserStoreSync,
  loadCachedUserStore,
  persistPrivateUserStore,
  saveCachedUserStore,
  setStoreMarketplacePublication,
} from '../../utils/storePersistence';
import {
  recordStoreSettingsSaveAttempt,
  recordStoreSettingsSaveConfirmed,
} from '../../observability/kyrubActivityOutcomes';

type StoreConfigModalProps = React.ComponentProps<typeof LegacyStoreConfigModal>;

type ToastState = {
  message: string;
  type: 'success' | 'warning' | 'error';
} | null;

type SaveStoreResult = {
  localSaved: boolean;
  cloudSynced: boolean;
  marketplaceSynced: boolean;
  store?: Store;
};

const emptyLocationDraft = (): StoreLocationDraft => ({
  latitude: '',
  longitude: '',
  geofenceRadiusMeters: '',
});

export const StoreConfigModal: React.FC<StoreConfigModalProps> = props => {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [canonicalPublished, setCanonicalPublished] = useState(false);
  const [fallbackPublished, setFallbackPublished] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [configStoreLogo, setConfigStoreLogo] = useState('');
  const [configStoreBanner, setConfigStoreBanner] = useState('');
  const [locationDraft, setLocationDraft] = useState<StoreLocationDraft>(emptyLocationDraft);
  const [operationalSettings, setOperationalSettings] =
    useState<StoreOperationalSettings>(createEmptyStoreOperationalSettings);

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
      if (originalSaveButton) originalSaveButton.style.display = '';
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
    setConfigStoreLogo(cachedStore?.logo ?? '');
    setConfigStoreBanner(cachedStore?.banner ?? '');
    setLocationDraft({
      latitude: typeof cachedStore?.lat === 'number' ? String(cachedStore.lat) : '',
      longitude: typeof cachedStore?.lng === 'number' ? String(cachedStore.lng) : '',
      geofenceRadiusMeters:
        typeof cachedStore?.geofenceRadiusMeters === 'number'
          ? String(cachedStore.geofenceRadiusMeters)
          : '',
    });
    setOperationalSettings(
      loadCachedStoreOperationalSettings(localStorage, user.uid)
    );

    if (!cachedStore) return;
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

    return subscribeToStoreOperationalSettings(
      user,
      settings => {
        setOperationalSettings(settings);
        saveCachedStoreOperationalSettings(localStorage, user.uid, settings);
      },
      error => {
        console.warn('Store operational settings are unavailable.', error);
      }
    );
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
        setFallbackPublished(snapshot.data()?.publicationStatus === 'published');
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

    const store = buildConfiguredStore(
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

    return {
      ...store,
      logo: configStoreLogo.trim(),
      banner: configStoreBanner.trim(),
    };
  }, [
    props.configStoreName,
    props.configStoreBio,
    props.configStoreAddress,
    props.configStoreContact,
    props.configStoreKeywords,
    configStoreLogo,
    configStoreBanner,
  ]);

  const resolveConfiguredStore = (): Store | null => {
    if (!configuredStore) return null;
    const location = parseStoreLocationDraft(locationDraft);
    return { ...configuredStore, ...location };
  };

  const resolvePublishedState = async (uid: string): Promise<boolean> => {
    if (isPublished) return true;

    const [canonicalResult, fallbackResult] = await Promise.allSettled([
      getDoc(doc(db, getMarketplaceStoreListingDocumentPath(uid))),
      getDoc(doc(db, 'tenants', uid)),
    ]);

    const canonicalIsPublished =
      canonicalResult.status === 'fulfilled' &&
      (canonicalResult.value.data() as MarketplaceListingDocument | undefined)
        ?.publicationStatus === 'published';
    const fallbackIsPublished =
      fallbackResult.status === 'fulfilled' &&
      fallbackResult.value.data()?.publicationStatus === 'published';

    return canonicalIsPublished || fallbackIsPublished;
  };

  const saveStore = async (
    refreshPublishedMarketplace: boolean
  ): Promise<SaveStoreResult> => {
    const user = auth.currentUser;
    if (!user || !configuredStore) {
      notify('Faça login novamente para salvar sua loja.', 'error');
      return { localSaved: false, cloudSynced: false, marketplaceSynced: false };
    }

    let storeToSave: Store;
    try {
      validateStoreOpeningHours(operationalSettings.openingHours);
      storeToSave = resolveConfiguredStore()!;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Revise a localização e o horário de funcionamento.',
        'error'
      );
      return { localSaved: false, cloudSynced: false, marketplaceSynced: false };
    }

    saveCachedUserStore(localStorage, user.uid, storeToSave, true);
    saveCachedStoreOperationalSettings(localStorage, user.uid, operationalSettings);
    setPendingSync(true);

    window.dispatchEvent(
      new CustomEvent('kyrub-user-store-saved', {
        detail: { store: storeToSave },
      })
    );

    let privateProfileSynced = false;
    let operationalSettingsSynced = false;

    try {
      await persistPrivateUserStore(user, storeToSave);
      saveCachedUserStore(localStorage, user.uid, storeToSave, false);
      privateProfileSynced = true;
    } catch (error) {
      console.warn('Store kept locally while cloud sync is pending.', error);
    }

    try {
      await persistStoreOperationalSettings(user, operationalSettings);
      operationalSettingsSynced = true;
    } catch (error) {
      console.warn('Store hours and integrations sync is pending.', error);
    }

    const cloudSynced = privateProfileSynced && operationalSettingsSynced;
    setPendingSync(!cloudSynced);

    let marketplaceSynced = true;
    if (refreshPublishedMarketplace && await resolvePublishedState(user.uid)) {
      try {
        await setStoreMarketplacePublication(user, storeToSave, true);
        setCanonicalPublished(true);
        setFallbackPublished(true);
      } catch (error) {
        marketplaceSynced = false;
        console.warn('Published store profile refresh is pending.', error);
      }
    }

    return {
      localSaved: true,
      cloudSynced,
      marketplaceSynced,
      store: storeToSave,
    };
  };

  const handleSave = async (): Promise<void> => {
    recordStoreSettingsSaveAttempt();
    setIsSaving(true);
    const result = await saveStore(true);

    if (result.cloudSynced) recordStoreSettingsSaveConfirmed();

    if (result.localSaved) {
      notify(
        !result.marketplaceSynced
          ? 'Configurações salvas. A atualização da vitrine pública ficou pendente.'
          : result.cloudSynced
            ? 'Perfil, localização, horários e integrações atualizados com sucesso!'
            : 'Configurações salvas neste dispositivo. A sincronização ficou pendente.',
        result.marketplaceSynced && result.cloudSynced ? 'success' : 'warning'
      );
    }

    setIsSaving(false);
    if (result.localSaved) props.onClose();
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
    const saveResult = await saveStore(false);

    if (!saveResult.localSaved || !saveResult.store) {
      setIsPublishing(false);
      return;
    }

    try {
      await setStoreMarketplacePublication(
        user,
        saveResult.store,
        targetPublished
      );

      setCanonicalPublished(targetPublished);
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

  const profileMediaControls = (
    <section
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/55 p-4"
      id="store-drive-media-controls"
    >
      <div>
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
          <ImageIcon className="h-4 w-4 text-teal-400" />
          Imagens públicas da loja
        </span>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Escolha no Google Fotos ou no Drive. Fotos da galeria são copiadas para seu Drive e compartilhadas como somente leitura; o Firestore guarda apenas a referência.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <span className="text-[9px] font-black uppercase text-slate-400">Logo</span>
          <div className="flex h-24 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            {configStoreLogo ? (
              <img src={configStoreLogo} alt="Prévia do logo da loja" className="h-full w-full object-contain" referrerPolicy="no-referrer" />
            ) : (
              <ImageIcon className="h-7 w-7 text-slate-700" />
            )}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <GooglePhotosImagePickerButton label="Logo no Google Fotos" onSelect={selection => setConfigStoreLogo(selection.url)} />
            <GoogleDriveImagePickerButton label="Escolher logo no Drive" onSelect={selection => setConfigStoreLogo(selection.url)} />
            {configStoreLogo && (
              <button type="button" onClick={() => setConfigStoreLogo('')} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-300">
                <Trash2 className="h-3.5 w-3.5" />
                Remover
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
          <span className="text-[9px] font-black uppercase text-slate-400">Banner</span>
          <div className="flex h-24 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            {configStoreBanner ? (
              <img src={configStoreBanner} alt="Prévia do banner da loja" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <ImageIcon className="h-7 w-7 text-slate-700" />
            )}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <GooglePhotosImagePickerButton label="Banner no Google Fotos" onSelect={selection => setConfigStoreBanner(selection.url)} />
            <GoogleDriveImagePickerButton label="Escolher banner no Drive" onSelect={selection => setConfigStoreBanner(selection.url)} />
            {configStoreBanner && (
              <button type="button" onClick={() => setConfigStoreBanner('')} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-[9px] font-black uppercase text-red-300">
                <Trash2 className="h-3.5 w-3.5" />
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const profileOperationalControls = (
    <div className="space-y-4">
      <StoreLocationEditor
        value={locationDraft}
        onChange={setLocationDraft}
        disabled={isSaving || isPublishing}
      />
      <StoreOpeningHoursEditor
        value={operationalSettings.openingHours}
        onChange={openingHours =>
          setOperationalSettings(current => ({ ...current, openingHours }))
        }
        disabled={isSaving || isPublishing}
      />
    </div>
  );

  const integrationsControls = (
    <StoreIntegrationsPanel
      value={operationalSettings.integrations}
      onChange={integrations =>
        setOperationalSettings(current => ({ ...current, integrations }))
      }
      disabled={isSaving || isPublishing}
    />
  );

  return (
    <>
      <LegacyStoreConfigModal
        {...props}
        profileMediaControls={profileMediaControls}
        profileOperationalControls={profileOperationalControls}
        integrationsControls={integrationsControls}
      />

      {actionsHost &&
        createPortal(
          <>
            {pendingSync && (
              <span className="hidden sm:inline text-[9px] font-mono uppercase text-amber-400">Sincronização pendente</span>
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
              className={`font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isPublished ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30' : 'bg-teal-500 hover:bg-teal-600 text-slate-950'}`}
            >
              {isPublishing ? 'Processando...' : isPublished ? 'Ocultar' : 'Publicar'}
            </button>
          </>,
          actionsHost
        )}

      {toast &&
        createPortal(
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] bg-slate-900 border border-slate-700 text-white px-5 py-3.5 rounded-2xl shadow-2xl max-w-sm text-center">
            <span className={`text-[11px] font-bold font-mono uppercase tracking-wide ${toast.type === 'success' ? 'text-emerald-300' : toast.type === 'warning' ? 'text-amber-300' : 'text-red-300'}`}>
              {toast.message}
            </span>
          </div>,
          document.body
        )}
    </>
  );
};
