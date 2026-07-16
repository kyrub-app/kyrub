import React from 'react';
import { MapPin, Briefcase, ShoppingBag } from 'lucide-react';
import { DeliveryJob, FreelanceJob } from '../../types';

interface RendaTabProps {
  deliveries: DeliveryJob[];
  freelanceJobs: FreelanceJob[];
  setShowDeliveryModal: (show: boolean) => void;
  setShowFazerEntregasModal: (show: boolean) => void;
  setShowFreelaModal: (show: boolean) => void;
  setShowFazerFreelasModal: (show: boolean) => void;
  setIsGestaoOpen: (open: boolean) => void;
  setGestaoRole: (role: 'admin' | 'supplier' | 'retailer' | 'sandbox') => void;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function RendaTab({
  deliveries,
  freelanceJobs,
  setShowDeliveryModal,
  setShowFazerEntregasModal,
  setShowFreelaModal,
  setShowFazerFreelasModal,
  setIsGestaoOpen,
  setGestaoRole,
  triggerToast
}: RendaTabProps) {
  return (
    <div className="space-y-6 animate-fade-in" id="renda-tab-container">
      
      {/* LINE 1: Dual cards side by side - 99entregas and 99freelas */}
      <div className="grid grid-cols-2 gap-4">
        {/* Delivery Vacancies Portals */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-orange-500" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Entregas</h3>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Gerencie entregas locais do seu negócio ou faça fretes sob demanda para faturar no ecossistema de varejo.
            </p>
          </div>
          <div className="space-y-2 pt-1">
            <button
              onClick={() => setShowDeliveryModal(true)}
              className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-orange-600/10 cursor-pointer"
              id="btn-solicitar-entrega"
            >
              Solicitar Entrega
            </button>
            <button
              onClick={() => setShowFazerEntregasModal(true)}
              className="w-full py-2 bg-slate-950 border border-slate-800 text-orange-400 hover:text-orange-300 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
              id="btn-fazer-entregas"
            >
              <span>Fazer Entregas</span>
              {deliveries.filter(d => d.status === 'available').length > 0 && (
                <span className="bg-orange-500 text-slate-950 text-[8px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                  {deliveries.filter(d => d.status === 'available').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Freelancer Vacancies Portals */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-teal-400" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Freelas</h3>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Contrate profissionais sob demanda para sua loja ou preste serviços especializados para empresas locais.
            </p>
          </div>
          <div className="space-y-2 pt-1">
            <button
              onClick={() => setShowFreelaModal(true)}
              className="w-full py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-teal-500/10 cursor-pointer"
              id="btn-solicitar-freela"
            >
              Solicitar Freela
            </button>
            <button
              onClick={() => setShowFazerFreelasModal(true)}
              className="w-full py-2 bg-slate-950 border border-slate-800 text-teal-400 hover:text-teal-300 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
              id="btn-fazer-freela"
            >
              <span>Fazer Freela</span>
              {freelanceJobs.filter(f => f.status === 'open').length > 0 && (
                <span className="bg-teal-500 text-slate-950 text-[8px] font-bold px-1.5 py-0.2 rounded-full font-mono">
                  {freelanceJobs.filter(f => f.status === 'open').length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* LINE 2: Retailer Management Card - Width 1 column mobile */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 flex flex-col justify-between" id="user-store-card">
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-orange-500" />
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Kyrub Ofertas</h3>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Crie sua loja e veja aqui um dashboard com os principais relatórios para vc gerenciar seu negócio.
          </p>
        </div>
        <div className="pt-2">
          <button
            onClick={() => {
              setIsGestaoOpen(true);
              setGestaoRole('retailer');
              triggerToast('Inicializando Tenant de Lojista... Bem-vindo ao Painel de Clientes!', 'success');
            }}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-slate-950 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md shadow-orange-600/10 cursor-pointer text-center block"
            id="btn-criar-loja-ofertas"
          >
            Criar Loja
          </button>
        </div>
      </div>
    </div>
  );
}
