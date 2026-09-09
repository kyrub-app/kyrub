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

  useEffect(() => onAuthStateChanged(auth, setUser), []);

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
          <section className="rounded-3xl border border-yellow-500/20 bg-yellow-500/[0.04] p-5">
            <div>
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-yellow-300">
                Canal autorizado
              </span>
              <h3 className="mt-1 text-sm font-black uppercase text-white">Mercado Livre</h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                OAuth, tokens do seller, sincronização e publicação continuam sob a autoridade canônica do Store Connections. O planejamento genérico antigo do Mercado Livre foi aposentado para evitar duas configurações concorrentes.
              </p>
            </div>
          </section>

          <StoreConnectionsWorkspace user={user} storeId={user.uid} notify={notify} />
          <MercadoLivreE2ETestBridge
            user={user}
            storeId={user.uid}
            notify={notify}
          />

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
                  Canais operacionais da loja
                </span>
                <h3 className="mt-1 text-sm font-black uppercase text-white">Demais integrações</h3>
                <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                  A configuração que antes ficava em Loja → Integrações agora vive aqui. Os dados continuam vinculados à mesma loja e ao mesmo documento operacional.
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
