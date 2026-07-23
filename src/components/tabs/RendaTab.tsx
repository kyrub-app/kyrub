import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  BadgeCheck,
  Briefcase,
  FileCheck2,
  MapPin,
  ShoppingBag,
} from 'lucide-react';
import { DeliveryJob, FreelanceJob } from '../../types';
import { auth, db } from '../../utils/firebase';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';

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

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!user) {
        setHasConfiguredStore(false);
        setIsCheckingStore(false);
        return;
      }

      setIsCheckingStore(true);

      void getDoc(
        doc(db, getPrimaryUserStoreDocumentPath(user.uid))
      )
        .then(snapshot => {
          if (cancelled) return;

          setHasConfiguredStore(
            snapshot.exists() &&
              hasMeaningfulStoreProfile(
                snapshot.data() as Record<string, unknown>
              )
          );
        })
        .catch(error => {
          console.warn(
            'Não foi possível verificar a loja do usuário.',
            error
          );
          if (!cancelled) setHasConfiguredStore(false);
        })
        .finally(() => {
          if (!cancelled) setIsCheckingStore(false);
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const openRetailerWorkspace = () => {
    setIsGestaoOpen(true);
    setGestaoRole('retailer');
    triggerToast(
      hasConfiguredStore
        ? 'Abrindo a gestão da sua loja.'
        : 'Vamos configurar sua loja no Kyrub Ofertas.',
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
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-orange-500" />
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Kyrub Entregas
              </h3>
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
                : 'Criar loja'}
          </button>
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
    </div>
  );
}
