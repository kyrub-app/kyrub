import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  Briefcase,
  CircleDollarSign,
  MapPin,
  ShoppingBag,
  X,
} from 'lucide-react';
import { DeliveryJob, FreelanceJob } from '../../types';
import {mayAcceptNewDelivery} from '../../../shared/storeOrderDistributionPolicy';
import { auth, db } from '../../utils/firebase';
import { loadCachedUserStore } from '../../utils/storePersistence';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';
import { CourierEarningsProjectionCard } from '../renda/CourierEarningsProjectionCard';
import { FreelanceEarningsPlanningCard } from '../renda/FreelanceEarningsPlanningCard';
import { useLocalFreelaCandidate } from '../modals/CanonicalFreelaWorkspace';
import { RendaActivityAlertsBell } from '../renda/RendaActivityAlertsBell';
import { LocalServiceDashboardCards } from '../store/LocalServiceDashboardCards';
import { ErpManagementAlertsBell } from '../store/ErpManagementAlertsBell';

interface RendaTabProps {
  guestReadOnly?: boolean;
  onGuestBrowseDeliveries?: () => void;
  onGuestBrowseFreelas?: () => void;
  onGuestLoginRequired?: (reason: string) => void;
  deliveries: DeliveryJob[];
  freelanceJobs: FreelanceJob[];
  setShowDeliveryModal: (show: boolean) => void;
  setShowFazerEntregasModal: (show: boolean) => void;
  setShowFreelaModal: (show: boolean) => void;
  setShowFazerFreelasModal: (show: boolean) => void;
  setIsGestaoOpen: (open: boolean) => void;
  setGestaoRole: (
    role: 'admin' | 'supplier' | 'retailer' | 'sandbox'
  ) => void;
  triggerToast: (
    msg: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const STORE_CHECK_TIMEOUT_MS = 4_000;

const hasMeaningfulStoreProfile = (
  data: Record<string, unknown>
): boolean => {
  // The first authenticated Create my store action creates the canonical
  // identity before any name or profile fields have been filled out.
  const canonicalId = data.canonicalStoreId;
  if (typeof canonicalId === 'string' && canonicalId.trim().length > 0) return true;
  return ['name', 'slug', 'description', 'address'].some(field => {
    const value = data[field];
    return typeof value === 'string' && value.trim().length > 0;
  });
};

export function RendaTab({
  guestReadOnly = false,
  onGuestBrowseDeliveries,
  onGuestBrowseFreelas,
  onGuestLoginRequired,
  deliveries,
  freelanceJobs,
  setShowDeliveryModal,
  setShowFazerEntregasModal,
  setShowFreelaModal,
  setShowFazerFreelasModal,
  setIsGestaoOpen,
  setGestaoRole,
  triggerToast,
}: RendaTabProps) {
  const localFreelaCandidate = useLocalFreelaCandidate();
  const [hasConfiguredStore, setHasConfiguredStore] =
    useState(false);
  const [isCheckingStore, setIsCheckingStore] =
    useState(true);
  const [isProvisioningFree, setIsProvisioningFree] = useState(false);
  const [isDeliveryEarningsOpen, setIsDeliveryEarningsOpen] =
    useState(false);
  const [isFreelanceEarningsOpen, setIsFreelanceEarningsOpen] = useState(false);
  useEffect(() => {
    let previousUid = auth.currentUser?.uid;
    return onAuthStateChanged(auth, user => {
      if (previousUid !== user?.uid || !user) setIsFreelanceEarningsOpen(false);
      previousUid = user?.uid;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let checkTimeout: number | null = null;

    const clearCheckTimeout = () => {
      if (checkTimeout === null) return;
      window.clearTimeout(checkTimeout);
      checkTimeout = null;
    };

    const unsubscribe = onAuthStateChanged(auth, user => {
      clearCheckTimeout();

      if (!user) {
        setHasConfiguredStore(false);
        setIsCheckingStore(false);
        return;
      }

      const cachedStore = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      const cachedConfigured = cachedStore
        ? hasMeaningfulStoreProfile(cachedStore as unknown as Record<string, unknown>)
        : false;

      setHasConfiguredStore(cachedConfigured);
      setIsCheckingStore(!cachedConfigured);

      checkTimeout = window.setTimeout(() => {
        if (!cancelled) setIsCheckingStore(false);
      }, STORE_CHECK_TIMEOUT_MS);

      void getDoc(
        doc(db, getPrimaryUserStoreDocumentPath(user.uid))
      )
        .then(snapshot => {
          if (cancelled) return;

          const configured =
            snapshot.exists() &&
            hasMeaningfulStoreProfile(
              snapshot.data() as Record<string, unknown>
            );
          setHasConfiguredStore(configured || cachedConfigured);
        })
        .catch(error => {
          console.warn(
            'Não foi possível verificar a loja do usuário.',
            error
          );
          if (!cancelled && cachedConfigured) {
            setHasConfiguredStore(true);
          }
        })
        .finally(() => {
          if (cancelled) return;
          clearCheckTimeout();
          setIsCheckingStore(false);
        });
    });

    return () => {
      cancelled = true;
      clearCheckTimeout();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isDeliveryEarningsOpen && !isFreelanceEarningsOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsDeliveryEarningsOpen(false); setIsFreelanceEarningsOpen(false); }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isDeliveryEarningsOpen, isFreelanceEarningsOpen]);

  const openRetailerWorkspace = async () => {
    if (guestReadOnly) {
      onGuestLoginRequired?.('criar ou acessar sua loja');
      return;
    }
    if (isProvisioningFree) return;
    // Existing stores must remain accessible even when a paid entitlement
    // requires reconciliation; Free provisioning is only for first creation.
    if (hasConfiguredStore) {
      setIsGestaoOpen(true);
      setGestaoRole('retailer');
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      triggerToast('Entre na sua conta para criar sua loja.', 'warning');
      return;
    }
    setIsProvisioningFree(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/plan-control?op=store.free.ensure', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw Error('FREE_STORE_PROVISIONING_FAILED');
      const activation = await response.json() as { canonicalStoreId?: string };
      if (!activation.canonicalStoreId) throw Error('STORE_ACTIVATION_RECEIPT_MISSING');
      setHasConfiguredStore(true);
      setIsGestaoOpen(true);
      setGestaoRole('retailer');
      triggerToast(
        hasConfiguredStore
          ? 'Abrindo a gestão da sua loja.'
          : 'Vamos configurar sua loja no Kyrub Lojas.',
        'success'
      );
    } catch (error) {
      console.warn('Falha ao preparar o acesso à loja.', error);
      triggerToast('Não foi possível preparar sua loja agora. Tente novamente.', 'error');
    } finally {
      setIsProvisioningFree(false);
    }
  };

  return (
    <div
      className="space-y-6 animate-fade-in"
      id="renda-tab-container" data-kyrub-brand-panel="catu"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col justify-between space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
                <h3 className="text-xs font-black uppercase tracking-wider text-white">
                  Kyrub Entregas
                </h3>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">
              <button
                type="button"
                onClick={() => guestReadOnly
                  ? onGuestLoginRequired?.('consultar seus ganhos')
                  : setIsDeliveryEarningsOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-300 transition hover:border-orange-400/35 hover:bg-orange-500/[0.14] active:scale-95"
                id="btn-delivery-earnings"
                aria-label="Ver ganhos em entregas"
                aria-haspopup="dialog"
                aria-controls="delivery-earnings-sheet"
                aria-expanded={isDeliveryEarningsOpen}
                title="Ganhos em entregas"
              >
                <CircleDollarSign className="h-4 w-4" />
              </button>
                <RendaActivityAlertsBell kind="delivery" guestReadOnly={guestReadOnly} onLoginRequired={onGuestLoginRequired}/>
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Gerencie entregas locais do seu negócio ou faça
              fretes sob demanda para faturar no ecossistema.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => guestReadOnly
                ? onGuestLoginRequired?.('solicitar uma entrega')
                : setShowDeliveryModal(true)}
              className="w-full rounded-xl bg-orange-600 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-orange-500"
              id="btn-solicitar-entrega"
            >
              Solicitar entrega
            </button>
            <button
              type="button"
              onClick={() => guestReadOnly
                ? onGuestBrowseDeliveries?.()
                : setShowFazerEntregasModal(true)
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[10px] font-black uppercase tracking-wider text-orange-400 transition-colors hover:text-orange-300"
              id="btn-fazer-entregas"
            >
              <span>Fazer entregas</span>
              {deliveries.filter(
                delivery => delivery.status === 'available' && mayAcceptNewDelivery(delivery)
              ).length > 0 && (
                <span className="rounded-full bg-orange-500 px-1.5 text-[8px] font-bold font-mono text-slate-950">
                  {
                    deliveries.filter(
                      delivery =>
                        delivery.status === 'available' && mayAcceptNewDelivery(delivery)
                    ).length
                  }
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col justify-between space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Briefcase className="h-4 w-4 shrink-0 text-orange-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Kyrub Freelas</h3>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">
              <button type="button"
                onClick={() => guestReadOnly || !auth.currentUser
                  ? onGuestLoginRequired?.('planejar seus ganhos')
                  : setIsFreelanceEarningsOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-300 transition hover:border-orange-400/35 hover:bg-orange-500/[0.14] active:scale-95"
                id="btn-freelance-earnings" aria-label="Ver ganhos em freelas"
                aria-haspopup="dialog" aria-controls="freelance-earnings-sheet"
                aria-expanded={isFreelanceEarningsOpen} title="Ganhos em freelas">
                <CircleDollarSign className="h-4 w-4" />
              </button>
                <RendaActivityAlertsBell kind="freelance" guestReadOnly={guestReadOnly} onLoginRequired={onGuestLoginRequired}/>
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Contrate profissionais para sua loja ou preste
              serviços especializados para negócios locais.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => guestReadOnly
                ? onGuestLoginRequired?.('contratar um freela')
                : setShowFreelaModal(true)}
              className="w-full rounded-xl bg-orange-600 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 transition-colors hover:bg-orange-500"
              id="btn-solicitar-freela"
            >
              Solicitar freela
            </button>
            <button
              type="button"
              onClick={() => guestReadOnly
                ? onGuestBrowseFreelas?.()
                : setShowFazerFreelasModal(true)
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[10px] font-black uppercase tracking-wider text-orange-400 transition-colors hover:text-orange-300"
              id="btn-fazer-freela"
            >
              <span>Fazer freela</span>
              {!localFreelaCandidate && freelanceJobs.filter(
                job => job.status === 'open'
              ).length > 0 && (
                <span className="rounded-full bg-orange-600 px-1.5 text-[8px] font-bold font-mono text-slate-950">
                  {
                    freelanceJobs.filter(
                      job => job.status === 'open'
                    ).length
                  }
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <section
          className="flex flex-col justify-between space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5"
          id="user-store-card"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <ShoppingBag className="h-4 w-4 text-orange-500" />
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Kyrub Lojas
              </h3>
              {!guestReadOnly && hasConfiguredStore && <ErpManagementAlertsBell />}
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              {hasConfiguredStore
                ? 'Gerencie produtos, ofertas e pedidos em um só lugar, com ferramentas do Kyrub para o dia a dia da sua loja.'
                : 'Crie sua loja grátis no Kyrub, divulgue produtos e serviços e organize seu negócio com ferramentas de gestão integradas para catálogo e pedidos.'}
            </p>
          </div>

          <button
            type="button"
            onClick={openRetailerWorkspace}
            disabled={isCheckingStore || isProvisioningFree}
            className="w-full rounded-xl bg-orange-600 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-950 transition-colors hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60"
            id="btn-criar-loja-ofertas"
          >
            {isCheckingStore
              ? 'Verificando loja...'
              : isProvisioningFree
                ? 'Preparando loja...'
              : hasConfiguredStore
                ? 'Acessar loja'
                : 'Criar minha loja'}
          </button>

          {hasConfiguredStore && <LocalServiceDashboardCards />}
        </section>

      </div>

      {isFreelanceEarningsOpen && !guestReadOnly && auth.currentUser && createPortal(
        <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation" onMouseDown={() => setIsFreelanceEarningsOpen(false)}>
          <section id="freelance-earnings-sheet" role="dialog" aria-modal="true"
            aria-labelledby="freelance-earnings-sheet-title"
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[2rem] border border-slate-700/80 bg-slate-950 shadow-2xl sm:max-w-2xl sm:rounded-[2rem]"
            onMouseDown={event => event.stopPropagation()}>
            <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-slate-950/95 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">Kyrub Freelas</p>
                <h2 id="freelance-earnings-sheet-title" className="mt-0.5 text-sm font-black text-white">Ganhos em freelas</h2>
              </div>
              <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300"
                aria-label="Fechar ganhos em freelas" onClick={() => setIsFreelanceEarningsOpen(false)}><X className="h-4 w-4"/></button>
            </header>
            <div className="p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4"><FreelanceEarningsPlanningCard /></div>
          </section>
        </div>, document.body
      )}

      {isDeliveryEarningsOpen && createPortal(
        <div
          className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={() => setIsDeliveryEarningsOpen(false)}
          role="presentation"
        >
          <section
            id="delivery-earnings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-earnings-sheet-title"
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[2rem] border border-slate-700/80 bg-slate-950 shadow-2xl sm:max-w-2xl sm:rounded-[2rem]"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-slate-950/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-300">
                  Kyrub Entregas
                </p>
                <h2
                  className="mt-0.5 text-sm font-black text-white"
                  id="delivery-earnings-sheet-title"
                >
                  Ganhos em entregas
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDeliveryEarningsOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:bg-slate-800 hover:text-white active:scale-95"
                aria-label="Fechar ganhos em entregas"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4">
              <CourierEarningsProjectionCard />
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
