import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { validateBrazilFiscalIssuerIdentity } from '../utils/brazilFiscalIdentifier';
import {
  createEmptyStoreFiscalAccountingDecision,
  createEmptyStoreIntegrationPlans,
  loadCachedStoreOperationalSettings,
  persistStoreIntegrationPlans,
  saveCachedStoreOperationalSettings,
  subscribeToStoreOperationalSettings,
  type StoreFiscalAccountingDecisionRecord,
  type StoreIntegrationPlans,
} from '../utils/storeOperationalSettings';
import MercadoLivreE2ETestBridge from './store/MercadoLivreE2ETestBridge';
import StoreConnectionsWorkspace from './store/StoreConnectionsWorkspace';
import { StoreIntegrationsPanel } from './store/StoreIntegrationsPanel';

type ToastType = 'success' | 'error' | 'info';
type FiscalWorkspaceTab = 'overview' | 'sefaz' | 'accountant-api';

interface GerencialIntegrationsRuntimeProps {
  triggerToast: (message: string, type?: ToastType) => void;
}

const fiscalTabLabel: Record<FiscalWorkspaceTab, string> = {
  overview: 'Visão geral',
  sefaz: 'SEFAZ',
  'accountant-api': 'API Contador',
};

export function GerencialIntegrationsRuntime({
  triggerToast,
}: GerencialIntegrationsRuntimeProps) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [notice, setNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [integrationPlans, setIntegrationPlans] = useState<StoreIntegrationPlans>(
    createEmptyStoreIntegrationPlans
  );
  const [fiscalAccountingDecision, setFiscalAccountingDecision] =
    useState<StoreFiscalAccountingDecisionRecord>(createEmptyStoreFiscalAccountingDecision);
  const [savingChannels, setSavingChannels] = useState(false);
  const [mercadoLivreOpen, setMercadoLivreOpen] = useState(false);
  const [fiscalTab, setFiscalTab] = useState<FiscalWorkspaceTab>('overview');

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
      setFiscalAccountingDecision(createEmptyStoreFiscalAccountingDecision());
      return;
    }

    const cached = loadCachedStoreOperationalSettings(localStorage, user.uid);
    setIntegrationPlans(cached.integrations);
    setFiscalAccountingDecision(cached.fiscalAccountingDecision);

    return subscribeToStoreOperationalSettings(
      user,
      settings => {
        setIntegrationPlans(settings.integrations);
        setFiscalAccountingDecision(settings.fiscalAccountingDecision);
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

  const saveSefazDraft = async (): Promise<void> => {
    if (!user) {
      notify('Faça login novamente para salvar o cadastro fiscal.', 'error');
      return;
    }

    try {
      validateBrazilFiscalIssuerIdentity(
        integrationPlans.sefaz.accountLabel,
        integrationPlans.sefaz.externalStoreId
      );
      setSavingChannels(true);
      await persistStoreIntegrationPlans(user, integrationPlans);
      notify(
        'Cadastro fiscal do emissor salvo. A emissão continua bloqueada até homologação e política contábil executável.',
        'success'
      );
    } catch (error) {
      console.error('Falha ao salvar cadastro fiscal do emissor.', error);
      notify(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o cadastro fiscal do emissor.',
        'error'
      );
    } finally {
      setSavingChannels(false);
    }
  };

  const accountingDecisionRecorded = fiscalAccountingDecision.status === 'recorded';
  const sefazConfigured = integrationPlans.sefaz.status !== 'not-configured';

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
              className="fixed inset-0 z-[160] flex h-[100dvh] min-h-0 items-stretch bg-slate-950/90 p-2 backdrop-blur-sm sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mercado-livre-integration-modal-title"
              id="mercado-livre-integration-modal"
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-yellow-500/20 bg-slate-950 shadow-2xl">
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

                <div
                  className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-5"
                  style={{
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: 'max(6rem, calc(env(safe-area-inset-bottom) + 2rem))',
                  }}
                >
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

          <section
            className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.035] p-5"
            id="accounting-fiscal-integrations-hub"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-violet-300">
                  Gerencial · Integrações
                </span>
                <h3 className="mt-1 text-lg font-black text-white">Contábil / Fiscais</h3>
                <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                  Centraliza a decisão contábil, o preparo da conexão fiscal com a SEFAZ e a futura integração com o sistema ou escritório do contador sem misturar essas autoridades com o fluxo comercial dos pedidos.
                </p>
              </div>
              <span className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 font-mono text-[8px] font-black uppercase tracking-wide text-violet-200">
                Zero emissão automática
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2" role="tablist" aria-label="Contábil e fiscais">
              {(Object.keys(fiscalTabLabel) as FiscalWorkspaceTab[]).map(tab => {
                const active = fiscalTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFiscalTab(tab)}
                    className={`min-h-10 rounded-xl border px-2 py-2 text-[9px] font-black uppercase tracking-wide transition ${
                      active
                        ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                        : 'border-slate-800 bg-slate-950/50 text-slate-500 hover:text-slate-300'
                    }`}
                    id={`accounting-fiscal-tab-${tab}`}
                  >
                    {fiscalTabLabel[tab]}
                  </button>
                );
              })}
            </div>

            {fiscalTab === 'overview' && (
              <div className="mt-4 space-y-4" role="tabpanel" id="accounting-fiscal-overview">
                <section
                  className={`rounded-2xl border p-4 ${
                    accountingDecisionRecorded
                      ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                      : 'border-amber-500/20 bg-amber-500/[0.04]'
                  }`}
                  id="fiscal-accounting-decision-status"
                  aria-live="polite"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`font-mono text-[9px] font-black uppercase tracking-[0.16em] ${
                          accountingDecisionRecorded ? 'text-emerald-300' : 'text-amber-300'
                        }`}
                      >
                        Decisão contábil · somente leitura
                      </span>
                      <h4 className="mt-1 text-sm font-black uppercase text-white">
                        {accountingDecisionRecorded
                          ? 'Referência contábil registrada'
                          : 'Decisão contábil pendente'}
                      </h4>
                      <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                        {accountingDecisionRecorded
                          ? 'Existe evidência de uma orientação contábil registrada. Ela ainda não define gatilho fiscal, família de documento nem concede autoridade de emissão.'
                          : 'A operação fiscal permanece aguardando orientação contábil. Nenhum gatilho, família de documento ou autoridade de emissão é definido por esta tela.'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 font-mono text-[8px] font-black uppercase tracking-wide ${
                        accountingDecisionRecorded
                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                          : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      {accountingDecisionRecorded ? 'Registrada' : 'Pendente'}
                    </span>
                  </div>

                  {accountingDecisionRecorded && (
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <dt className="font-mono text-[8px] font-black uppercase tracking-wide text-slate-500">
                          Referência da orientação
                        </dt>
                        <dd className="mt-1 break-words text-[10px] font-semibold text-slate-200">
                          {fiscalAccountingDecision.policyReference}
                        </dd>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <dt className="font-mono text-[8px] font-black uppercase tracking-wide text-slate-500">
                          Registrada em
                        </dt>
                        <dd className="mt-1 break-words text-[10px] font-semibold text-slate-200">
                          {fiscalAccountingDecision.recordedAt}
                        </dd>
                      </div>
                    </dl>
                  )}
                </section>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                    <span className="font-mono text-[8px] font-black uppercase text-slate-500">Política fiscal executável</span>
                    <strong className="mt-1 block text-[10px] text-amber-200">Ainda não definida</strong>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                    <span className="font-mono text-[8px] font-black uppercase text-slate-500">Autoridade de emissão</span>
                    <strong className="mt-1 block text-[10px] text-amber-200">Bloqueada</strong>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                    <span className="font-mono text-[8px] font-black uppercase text-slate-500">SEFAZ</span>
                    <strong className="mt-1 block text-[10px] text-slate-200">
                      {sefazConfigured ? 'Configuração iniciada' : 'Não configurada'}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {fiscalTab === 'sefaz' && (
              <div className="mt-4 space-y-4" role="tabpanel" id="accounting-fiscal-sefaz">
                <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
                  <span className="font-mono text-[9px] font-black uppercase tracking-wide text-amber-300">
                    Cadastro fiscal
                  </span>
                  <h4 className="mt-1 text-sm font-black uppercase text-white">Identificação fiscal do emissor</h4>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    Cadastre nome ou razão social e CPF/CNPJ do emissor. Novos cadastros permanecem em homologação. Certificado, CSC, senha ou chave privada não devem ser digitados no navegador, e salvar estes dados não concede autoridade de emissão.
                  </p>
                </section>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveSefazDraft()}
                    disabled={savingChannels}
                    className="min-h-10 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 text-[9px] font-black uppercase text-amber-200 disabled:opacity-45"
                    id="save-sefaz-integration"
                  >
                    {savingChannels ? 'Salvando...' : 'Salvar cadastro fiscal'}
                  </button>
                </div>

                <div id="accounting-fiscal-sefaz-plan">
                  <style>{`#accounting-fiscal-sefaz-plan [data-integration-id]:not([data-integration-id="sefaz"]) { display: none; }`}</style>
                  <StoreIntegrationsPanel
                    value={integrationPlans}
                    onChange={updateIntegrationPlans}
                    disabled={savingChannels}
                  />
                </div>
              </div>
            )}

            {fiscalTab === 'accountant-api' && (
              <div className="mt-4 space-y-4" role="tabpanel" id="accounting-fiscal-accountant-api">
                <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
                  <span className="font-mono text-[9px] font-black uppercase tracking-wide text-cyan-300">
                    Fonte da política contábil
                  </span>
                  <h4 className="mt-1 text-sm font-black uppercase text-white">API Contador</h4>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    Ponto reservado para integrar o Kyrub ao sistema do contador ou escritório contábil. Ainda não há conector ativo nem credencial solicitada ao lojista nesta tela.
                  </p>
                </section>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <span className="font-mono text-[8px] font-black uppercase tracking-wide text-slate-500">Estado</span>
                    <strong className="mt-1 block text-[11px] text-slate-200">Sem conexão ativa</strong>
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                      Nenhum fornecedor de API contábil foi presumido e nenhum dado fiscal fictício foi criado.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <span className="font-mono text-[8px] font-black uppercase tracking-wide text-slate-500">Contrato esperado</span>
                    <strong className="mt-1 block text-[11px] text-slate-200">Política versionada e auditável</strong>
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                      A futura integração deverá trazer referência, vigência e parâmetros contábeis explícitos antes de qualquer autorização de emissão.
                    </p>
                  </div>
                </div>

                <p className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 text-[9px] leading-relaxed text-amber-100">
                  Registrar uma referência contábil continua sendo evidência, não política fiscal executável. O Kyrub não escolherá NFC-e, NF-e, NFS-e, CFOP, CST ou tributos por inferência.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
                  Canais operacionais da loja
                </span>
                <h3 className="mt-1 text-sm font-black uppercase text-white">Demais integrações</h3>
                <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                  Open Delivery, iFood, 99Food e Shopee continuam vinculados à mesma loja. SEFAZ agora fica concentrada em Contábil / Fiscais.
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
              <style>{`#consolidated-store-channel-plans [data-integration-id="mercado-livre"], #consolidated-store-channel-plans [data-integration-id="sefaz"] { display: none; }`}</style>
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
