import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import {
  createEmptyStoreIntegrationPlans,
  loadCachedStoreOperationalSettings,
  persistStoreIntegrationPlans,
  saveCachedStoreOperationalSettings,
  subscribeToStoreOperationalSettings,
  type StoreIntegrationPlans,
} from '../utils/storeOperationalSettings';
import MercadoLivreE2ETestBridge from './store/MercadoLivreE2ETestBridge';
import StoreConnectionsWorkspace from './store/StoreConnectionsWorkspace';
import { StoreIntegrationsPanel } from './store/StoreIntegrationsPanel';

type ToastType = 'success' | 'error' | 'info';

interface GerencialIntegrationsRuntimeProps {
  triggerToast: (message: string, type?: ToastType) => void;
}

export function GerencialIntegrationsRuntime({
  triggerToast,
}: GerencialIntegrationsRuntimeProps) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [notice, setNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [integrationPlans, setIntegrationPlans] = useState<StoreIntegrationPlans>(
    createEmptyStoreIntegrationPlans
  );
  const [savingChannels, setSavingChannels] = useState(false);
  const [mercadoLivreOpen, setMercadoLivreOpen] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('integration') === 'mercado_livre') {
      setMercadoLivreOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!mercadoLivreOpen || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMercadoLivreOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mercadoLivreOpen]);

  useEffect(() => {
    if (!user) {
      setIntegrationPlans(createEmptyStoreIntegrationPlans());
      return;
    }

    const cached = loadCachedStoreOperationalSettings(localStorage, user.uid);
    setIntegrationPlans(cached.integrations);

    return subscribeToStoreOperationalSettings(
      user,
      settings => {
        setIntegrationPlans(settings.integrations);
        saveCachedStoreOperationalSettings(localStorage, user.uid, settings);
      },
      error => {
        console.warn('Configurações operacionais das integrações indisponíveis.', error);
      }
    );
  }, [user]);

  const notify = (message: string, type: ToastType = 'info'): void => {
    setNotice({ message, type });
    triggerToast(message, type);
  };

  const updateIntegrationPlans = (plans: StoreIntegrationPlans): void => {
    setIntegrationPlans(plans);
    if (!user) return;

    const cached = loadCachedStoreOperationalSettings(localStorage, user.uid);
    saveCachedStoreOperationalSettings(localStorage, user.uid, {
      ...cached,
      integrations: plans,
    });
  };

  const saveChannelDrafts = async (): Promise<void> => {
    if (!user) {
      notify('Faça login novamente para salvar as integrações.', 'error');
      return;
    }

    try {
      setSavingChannels(true);
      await persistStoreIntegrationPlans(user, integrationPlans);
      notify('Configurações dos canais salvas na loja.', 'success');
    } catch (error) {
      console.error('Falha ao salvar configurações dos canais.', error);
      notify('Não foi possível salvar as configurações dos canais.', 'error');
    } finally {
      setSavingChannels(false);
    }
  };

  return (
    <div className="space-y-5" id="kyrub-gerencial-integrations-runtime" data-kyrub-gerencial-module="integrations-lazy">
      {notice && (
        <div
          className={`rounded-2xl border px-4 py-3 text-[10px] leading-relaxed ${
            notice.type === 'success'
              ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
              : notice.type === 'error'
                ? 'border-red-500/25 bg-red-500/[0.06] text-red-100'
                : 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100'
          }`}
          role="status"
        >
          {notice.message}
        </div>
      )}

      {user ? (
        <>
          <section
            className="rounded-3xl border border-yellow-500/20 bg-yellow-500/[0.04] p-5"
            id="mercado-livre-integration-card"
          >
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-yellow-300">
              Marketplace
            </span>
            <h3 className="mt-1 text-lg font-black text-white">Mercado Livre</h3>
            <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
              Conexão oficial, conta autorizada, sincronização, importação, revisão manual e bancada E2E ficam reunidas em uma única central do Mercado Livre.
            </p>
            <button
              type="button"
              onClick={() => setMercadoLivreOpen(true)}
              className="mt-4 min-h-11 w-full rounded-xl bg-yellow-400 px-4 text-[10px] font-black uppercase tracking-wide text-slate-950 sm:w-auto"
              id="open-mercado-livre-integration"
            >
              Abrir Mercado Livre
            </button>
          </section>

          {mercadoLivreOpen && (
            <div
              className="fixed inset-0 z-[160] bg-slate-950/90 p-2 backdrop-blur-sm sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mercado-livre-integration-modal-title"
              id="mercado-livre-integration-modal"
            >
              <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-yellow-500/20 bg-slate-950 shadow-2xl">
                <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900 px-4 py-4 sm:px-6">
                  <div className="min-w-0">
                    <span className="font-mono text-[8px] font-black uppercase tracking-[0.16em] text-yellow-300">
                      Integrações · Mercado Livre
                    </span>
                    <h2
                      className="mt-1 truncate text-sm font-black uppercase text-white sm:text-base"
                      id="mercado-livre-integration-modal-title"
                    >
                      Central Mercado Livre
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMercadoLivreOpen(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-xl font-bold text-slate-300"
                    aria-label="Fechar Mercado Livre"
                    id="close-mercado-livre-integration"
                  >
                    ×
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto p-3 sm:p-5">
                  <div className="space-y-5">
                    <section className="rounded-3xl border border-yellow-500/20 bg-yellow-500/[0.04] p-5">
                      <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-yellow-300">
                        Autoridade canônica
                      </span>
                      <h3 className="mt-1 text-sm font-black uppercase text-white">Mercado Livre</h3>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                        OAuth, tokens do seller, sincronização e publicação continuam sob a autoridade do Store Connections. Nenhuma credencial da aplicação é solicitada ao lojista nesta tela.
                      </p>
                    </section>

                    <StoreConnectionsWorkspace user={user} storeId={user.uid} notify={notify} />
                    <MercadoLivreE2ETestBridge
                      user={user}
                      storeId={user.uid}
                      notify={notify}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
                  Canais operacionais da loja
                </span>
                <h3 className="mt-1 text-sm font-black uppercase text-white">Demais integrações</h3>
                <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                  Open Delivery, SEFAZ, iFood, 99Food e Shopee continuam vinculados à mesma loja e ao mesmo documento operacional.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveChannelDrafts()}
                disabled={savingChannels}
                className="min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 text-[9px] font-black uppercase text-cyan-200 disabled:opacity-45"
                id="save-consolidated-store-integrations"
              >
                {savingChannels ? 'Salvando...' : 'Salvar canais'}
              </button>
            </div>

            <div id="consolidated-store-channel-plans">
              <style>{`#consolidated-store-channel-plans [data-integration-id="mercado-livre"] { display: none; }`}</style>
              <StoreIntegrationsPanel
                value={integrationPlans}
                onChange={updateIntegrationPlans}
                disabled={savingChannels}
              />
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-[10px] leading-relaxed text-amber-100">
          A sessão autenticada ainda não está disponível para carregar as conexões da loja.
        </div>
      )}
    </div>
  );
}
