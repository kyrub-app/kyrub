import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  BadgeCheck,
  Briefcase,
  CircleDollarSign,
  FileCheck2,
  MapPin,
  ShoppingBag,
  X,
} from 'lucide-react';
import { DeliveryJob, FreelanceJob } from '../../types';
import { auth, db } from '../../utils/firebase';
import { loadCachedUserStore } from '../../utils/storePersistence';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';
import { CourierEarningsProjectionCard } from '../renda/CourierEarningsProjectionCard';
import { LocalServiceDashboardCards } from '../store/LocalServiceDashboardCards';

interface RendaTabProps {
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
): boolean =>
  ['name', 'slug', 'description', 'address'].some(field => {
    const value = data[field];
    return typeof value === 'string' && value.trim().length > 0;
  });

export function RendaTab({
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
  const [hasConfiguredStore, setHasConfiguredStore] =
    useState(false);
  const [isCheckingStore, setIsCheckingStore] =
    useState(true);
  const [isDeliveryEarningsOpen, setIsDeliveryEarningsOpen] =
    useState(false);

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
    if (!isDeliveryEarningsOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDeliveryEarningsOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isDeliveryEarningsOpen]);

  const openRetailerWorkspace = () => {
    setIsGestaoOpen(true);
    setGestaoRole('retailer');
    triggerToast(
      hasConfiguredStore
        ? 'Abrindo a gestão da sua loja.'
        : 'Vamos ativar sua loja no Kyrub Ofertas.',
      'success'
    );
  };

  return (
    <div
      className="space-y-6 animate-fade-in"
      id="renda-tab-container"
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
              <button
                type="button"
                onClick={() => setIsDeliveryEarningsOpen(true)}
                className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-300 transition hover:border-cyan-400/35 hover:bg-cyan-500/[0.14] active:scale-95"
                id="btn-delivery-earnings"
                aria-label="Ver ganhos em entregas"
                aria-haspopup="dialog"
                aria-controls="delivery-earnings-sheet"
                aria-expanded={isDeliveryEarningsOpen}
                title="Ganhos em entregas"
              >
                <CircleDollarSign className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Gerencie entregas locais do seu negócio ou faça
              fretes sob demanda para faturar no ecossistema.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => setShowDeliveryModal(true)}
              className="w-full rounded-xl bg-orange-600 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-orange-500"
              id="btn-solicitar-entrega"
            >
              Solicitar entrega
            </button>
            <button
              type="button"
              onClick={() =>
                setShowFazerEntregasModal(true)
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[10px] font-black uppercase tracking-wider text-orange-400 transition-all hover:text-orange-300"
              id="btn-fazer-entregas"
            >
              <span>Fazer entregas</span>
              {deliveries.filter(
                delivery => delivery.status === 'available'
              ).length > 0 && (
                <span className="rounded-full bg-orange-500 px-1.5 text-[8px] font-bold font-mono text-slate-950">
                  {
                    deliveries.filter(
                      delivery =>
                        delivery.status === 'available'
                    ).length
                  }
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col justify-between space-y-3 rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Briefcase className="h-4 w-4 text-teal-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Kyrub Freelas
              </h3>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Contrate profissionais para sua loja ou preste
              serviços especializados para negócios locais.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => setShowFreelaModal(true)}
              className="w-full rounded-xl bg-teal-500 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 transition-all hover:bg-teal-400"
              id="btn-solicitar-freela"
            >
              Solicitar freela
            </button>
            <button
              type="button"
              onClick={() =>
                setShowFazerFreelasModal(true)
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 py-2 text-[10px] font-black uppercase tracking-wider text-teal-400 transition-all hover:text-teal-300"
              id="btn-fazer-freela"
            >
              <span>Fazer freela</span>
              {freelanceJobs.filter(
                job => job.status === 'open'
              ).length > 0 && (
                <span className="rounded-full bg-teal-500 px-1.5 text-[8px] font-bold font-mono text-slate-950">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <section
          className="flex flex-col justify-between space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-5"
          id="user-store-card"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <ShoppingBag className="h-4 w-4 text-orange-500" />
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Kyrub Ofertas
              </h3>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              {hasConfiguredStore
                ? 'Gerencie seus produtos, configurações e a loja exibida na guia Ofertas do Kyrub.'
                : 'Cadastre seus produtos, configure e publique sua loja na guia Ofertas do Kyrub.'}
            </p>
          </div>

          <button
            type="button"
            onClick={openRetailerWorkspace}
            disabled={isCheckingStore}
            className="w-full rounded-xl bg-orange-600 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-950 transition-all hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60"
            id="btn-criar-loja-ofertas"
          >
            {isCheckingStore
              ? 'Verificando loja...'
              : hasConfiguredStore
                ? 'Acessar loja'
                : 'Ativar loja'}
          </button>

          {hasConfiguredStore && <LocalServiceDashboardCards />}
        </section>

        <section className="flex flex-col justify-between space-y-4 rounded-3xl border border-teal-500/20 bg-slate-900 p-5">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <BadgeCheck className="h-4 w-4 text-teal-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Kyrub Formaliza
              </h3>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Acesse nossas ferramentas auxiliadoras para
              formalizar seu negócio.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              triggerToast(
                'As ferramentas do Kyrub Formaliza serão disponibilizadas nesta área.',
                'info'
              )
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 py-2.5 text-[10px] font-black uppercase tracking-wider text-teal-300 transition-all hover:bg-teal-500/20"
            id="btn-kyrub-formaliza"
          >
            <FileCheck2 className="h-3.5 w-3.5" />
            <span>Acessar ferramentas</span>
          </button>
        </section>
      </div>

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
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-300">
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
