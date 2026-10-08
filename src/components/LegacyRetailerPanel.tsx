import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, DollarSign, ClipboardList, Calendar, Clock, LayoutGrid, 
  Plus, Tag, Play, Pause, Trash2, Upload, AlertCircle, ShieldAlert,
  Search, ShieldCheck, Database, Key, Percent, Gift, Award, FileText,
  UserCheck, MapPin, Laptop, Wifi, RefreshCw, Send, ArrowUpRight, ArrowDownLeft,
  Settings, Briefcase, BarChart3, ChevronRight, Fingerprint, Store as StoreIcon,
  Zap, X
} from 'lucide-react';
import { Tenant, Store, Product, Order } from '../types';
import type { BuildUserStoreUpdateInput } from '../utils/userStoreDocument';
import { auth } from '../utils/firebase';

// ==========================================
// RETAILER PANEL MAIN COMPONENT
// ==========================================
interface RetailerPanelProps {
  activeRetailerId: string;
  activeRetailer: Tenant | undefined;
  activeStore: Store;
  products: Product[];
  orders: Order[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  onUpdateStore: (updates: BuildUserStoreUpdateInput) => Promise<void>;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  activeSubTab: 'clientes' | 'caixa' | 'pedidos' | 'reservas' | 'ponto' | 'gerencial';
  setActiveSubTab: (tab: 'clientes' | 'caixa' | 'pedidos' | 'reservas' | 'ponto' | 'gerencial') => void;
  atendimentoSpaces: string[];
  producaoSpaces: string[];
}

export const RetailerPanel: React.FC<RetailerPanelProps> = ({
  activeRetailerId,
  activeRetailer,
  activeStore,
  products,
  orders,
  setProducts,
  setOrders,
  onUpdateStore,
  triggerToast,
  activeSubTab,
  setActiveSubTab,
  atendimentoSpaces
}) => {
  const activeRetailerProducts = products.filter(p => p.supplierId === activeRetailerId && !p.wholesalePrice);
  
  // Navigation State
  const [activeGerencialModule, setActiveGerencialModule] = useState<string | null>(null);

  // Dynamic Clock for Ponto
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. CLIENTS / ATTENDANCE
  // Canonical customer/table service is mounted by RetailerPanel.tsx.

  // 2. CASH
  // Canonical cash state is mounted by RetailerPanel.tsx via CashWorkspace.

  // 4. RESERVATIONS
  const [reservations, setReservations] = useState<any[]>([]);
  const [showNewReservationModal, setShowNewReservationModal] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResDate, setNewResDate] = useState('');
  const [newResTime, setNewResTime] = useState('');
  const [newResPeople, setNewResPeople] = useState(1);
  const [reservationsLoading, setReservationsLoading] = useState(false);

  // 5. COLLABORATOR PORTAL / CANONICAL TIME CLOCK
  const [pontoLogs, setPontoLogs] = useState<any[]>([]);
  const [pontoLoading, setPontoLoading] = useState(false);

  // 6. GENERAL FINANCE / HR / CUSTOMIZATION / FISCAL
  // Customization States
  const [storeName, setStoreName] = useState(activeStore?.name || '');
  const [storeDesc, setStoreDesc] = useState(activeStore?.description || '');
  const [storeColor, setStoreColor] = useState(activeStore?.primaryColor || '#3b82f6');
  const [storeKeywords, setStoreKeywords] = useState(activeStore?.keywords?.join(', ') || '');
  const [storeOfferImages, setStoreOfferImages] = useState<string[]>(activeStore?.offerImages || []);
  const [customImageUrl, setCustomImageUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStoreName(activeStore.name || '');
    setStoreDesc(activeStore.description || '');
    setStoreColor(activeStore.primaryColor || '#3b82f6');
    setStoreKeywords((activeStore.keywords || []).join(', '));
    setStoreOfferImages(activeStore.offerImages || []);
  }, [
    activeStore.id,
    activeStore.name,
    activeStore.description,
    activeStore.primaryColor,
    activeStore.keywords,
    activeStore.offerImages,
  ]);

  // Helpers
  const isPremium = activeRetailer?.plan === 'business';

  // ==========================================
  // ECOSSISTEMA: PDV SALE SUBTRACTION LINKED TO MARKETPLACE
  // ==========================================


  const handlePlanUpgrade = () => {
    triggerToast(
      'A contratação do plano Business ainda não está configurada.',
      'info'
    );
  };

  const formatReservationLocalTime = (value: unknown): string => {
    if (typeof value !== 'string') return 'Horário indisponível';
    const match = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::\\d{2})?$/.exec(value.trim());
    if (!match) return 'Horário indisponível';
    const [, year, month, day, hour, minute] = match;
    return `${day}/${month}/${year}, ${hour}:${minute}`;
  };

  // 4. CANONICAL RESERVATIONS
  const loadReservations = async () => {
    const user = auth.currentUser;
    if (!user || !activeRetailerId) return;
    const token = await user.getIdToken();
    const response = await fetch(`/api/staff/reservations?storeId=${encodeURIComponent(activeRetailerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar as reservas.');
    setReservations(Array.isArray(payload?.reservations) ? payload.reservations : []);
  };

  useEffect(() => {
    if (activeSubTab !== 'reservas') return;
    setReservationsLoading(true);
    void loadReservations()
      .catch(error => triggerToast(error instanceof Error ? error.message : 'Não foi possível carregar as reservas.', 'error'))
      .finally(() => setReservationsLoading(false));
  }, [activeSubTab, activeRetailerId]);

  const handleConfirmReservation = async () => {
    if (!newResName.trim() || !newResDate || !newResTime) {
      triggerToast('Preencha cliente, data e horário da reserva.', 'error');
      return;
    }
    const user = auth.currentUser;
    if (!user || !activeRetailerId || reservationsLoading) return;
    setReservationsLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/staff/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: activeRetailerId,
          clientName: newResName.trim(),
          scheduledAt: `${newResDate}T${newResTime}:00`,
          people: newResPeople,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível criar a reserva.');
      await loadReservations();
      setNewResName('');
      setNewResDate('');
      setNewResTime('');
      setNewResPeople(1);
      setShowNewReservationModal(false);
      triggerToast('Reserva agendada com sucesso!', 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível criar a reserva.', 'error');
    } finally {
      setReservationsLoading(false);
    }
  };

  const handleCompleteReservation = async (reservationId: string) => {
    const user = auth.currentUser;
    if (!user || !activeRetailerId || reservationsLoading) return;
    setReservationsLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/staff/reservations/${encodeURIComponent(reservationId)}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: activeRetailerId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a reserva.');
      await loadReservations();
      triggerToast('Reserva concluída.', 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível concluir a reserva.', 'error');
    } finally {
      setReservationsLoading(false);
    }
  };

  // 5. CANONICAL TIME CLOCK
  const loadTimeClockEntries = async () => {
    const user = auth.currentUser;
    if (!user || !activeRetailerId) return;
    const token = await user.getIdToken();
    const response = await fetch(`/api/staff/time-clock/me?storeId=${encodeURIComponent(activeRetailerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar o ponto.');
    setPontoLogs(Array.isArray(payload?.entries) ? payload.entries : []);
  };

  useEffect(() => {
    if (activeSubTab !== 'ponto') return;
    void loadTimeClockEntries().catch(error =>
      triggerToast(error instanceof Error ? error.message : 'Não foi possível carregar o ponto.', 'error')
    );
  }, [activeSubTab, activeRetailerId]);

  const handleTimeClockAction = async (action: 'clock-in' | 'clock-out') => {
    const user = auth.currentUser;
    if (!user || !activeRetailerId || pontoLoading) return;
    setPontoLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/staff/time-clock/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ storeId: activeRetailerId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível registrar o ponto.');
      await loadTimeClockEntries();
      triggerToast(action === 'clock-in' ? 'Entrada registrada com sucesso!' : 'Saída registrada com sucesso!', 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível registrar o ponto.', 'error');
    } finally {
      setPontoLoading(false);
    }
  };

  const hasOpenTimeClockEntry = pontoLogs.some(log => log?.status === 'open');

  // Theme configuration saving
  const handleSaveThemeCustomization = async () => {
    const keywords = storeKeywords
      .split(',')
      .map(keyword => keyword.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);

    try {
      await onUpdateStore({
        name: storeName,
        description: storeDesc,
        primaryColor: storeColor,
        keywords,
        offerImages: [...storeOfferImages],
      });
      triggerToast(
        'Configurações de Vitrine e SEO Local gravadas!',
        'success'
      );
    } catch {
      // The parent persistence handler already restored state and notified.
    }
  };

  const handleSelectPresetBanner = (url: string) => {
    if (storeOfferImages.includes(url)) {
      triggerToast('Imagem já incluída!', 'info');
      return;
    }
    setStoreOfferImages(prev => [...prev, url].slice(0, 5));
  };

  return (
    <div className="space-y-6 text-slate-100 font-sans" id="erp-master-dashboard">
      
      <div className="space-y-6" id="erp-tab-content-area">

          {/* ------------------------------------------
              TAB 1: PAINEL DE CLIENTES
             ------------------------------------------ */}
          {activeSubTab === 'clientes' && (
            <div className="space-y-5 animate-fade-in" id="erp-clientes-tab">
              <div
                id="kyrub-canonical-attendance-anchor"
                className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
              >
                <h3 className="text-sm font-black uppercase text-white">
                  Atendimentos
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Mesas, comandas e pedidos são carregados pelo fluxo canônico da loja.
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------
              TAB 2: PAINEL DO CAIXA (Dexie Cached)
             ------------------------------------------ */}
          {activeSubTab === 'caixa' && (
            <div className="animate-fade-in" id="erp-caixa-tab" />
          )}

          {/* ------------------------------------------
              TAB 3: PAINEL DE PEDIDOS E VENDAS
             ------------------------------------------ */}
          {activeSubTab === 'pedidos' && (
            <div className="animate-fade-in" id="erp-pedidos-tab">
              {/* Central area */}
              <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl py-16 text-center" id="kds-funnel-view">
                <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">NENHUM PEDIDO ENCONTRADO</h4>
                <p className="text-[10px] text-slate-500 mt-1 max-w-sm mx-auto">
                  Os pedidos efetuados na vitrine digital ou integrados via hubs externos serão direcionados para este funil de produção.
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------
              TAB 4: RESERVAS & AGENDAMENTOS
             ------------------------------------------ */}
          {activeSubTab === 'reservas' && (
            <div className="space-y-5 animate-fade-in" id="erp-reservas-tab">
              <div className="flex items-center justify-between bg-slate-900 p-4 rounded-3xl border border-slate-800">
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">Reservas & Agendamentos</h3>
                  <p className="text-[10px] text-slate-400">Controle de Ocupação Futura de Serviços</p>
                </div>
                <button
                  onClick={() => setShowNewReservationModal(true)}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-black px-4 py-2 rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                >
                  + Nova Reserva
                </button>
              </div>

              {reservations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {reservations.map(res => (
                    <div key={res.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono text-purple-400 font-bold">{res.id}</span>
                        <span className="text-[9px] font-mono text-slate-400">{formatReservationLocalTime(res.scheduledLocal ?? res.scheduledAt)}</span>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{res.clientName}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">Pessoas/Companhantes: {res.people}</p>
                      </div>
                      <div className="pt-2 border-t border-slate-850 flex justify-end">
                        <button
                          onClick={() => void handleCompleteReservation(res.id)}
                          disabled={reservationsLoading}
                          className="px-3 py-1 bg-slate-950 border border-slate-850 hover:bg-slate-900 text-[10px] text-emerald-400 font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          Atender / Finalizar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl py-12 text-center">
                  <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-xs text-slate-400 font-bold">NENHUMA RESERVA ENCONTRADA</p>
                  <p className="text-[10px] text-slate-600 mt-1">Crie a primeira reserva usando o botão acima.</p>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------
              TAB 5: MURAL DO COLABORADOR & PONTO
             ------------------------------------------ */}
          {activeSubTab === 'ponto' && (
            <div className="space-y-5 animate-fade-in" id="erp-ponto-tab">
              <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 p-6 rounded-3xl text-center space-y-4">
                <div>
                  <span className="text-[9px] font-mono text-orange-400 font-bold uppercase tracking-wider block">Mural do Colaborador</span>
                  <h3 className="text-xs font-black text-white uppercase mt-0.5">REGISTRO DE PONTO</h3>
                  <p className="text-[10px] text-slate-400">Registro vinculado à sua identidade Kyrub</p>
                </div>

                <div className="bg-slate-950 border border-slate-850/80 p-5 rounded-2xl font-mono">
                  <span className="text-3xl font-black text-white tracking-tight">
                    {currentTime.toLocaleTimeString()}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-1">
                    {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>

                <button
                  onClick={() => void handleTimeClockAction(hasOpenTimeClockEntry ? 'clock-out' : 'clock-in')}
                  disabled={pontoLoading}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Fingerprint className="w-4 h-4 text-slate-950" />
                  <span>{pontoLoading ? 'REGISTRANDO...' : hasOpenTimeClockEntry ? 'REGISTRAR SAÍDA' : 'REGISTRAR ENTRADA'}</span>
                </button>

                <div className="pt-4 border-t border-slate-850 text-left space-y-2">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Histórico de Hoje</span>
                  {pontoLogs.length > 0 ? (
                    <div className="space-y-1.5">
                      {pontoLogs.map((log, idx) => (
                        <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-[10px] font-mono flex items-center justify-between">
                          <div>
                            <span className="text-white font-bold block">{log.status === 'open' ? 'Entrada registrada' : 'Turno encerrado'}</span>
                            <span className="text-slate-500">{log.clockOutAt ? 'Entrada e saída registradas pelo servidor' : 'Turno em andamento'}</span>
                          </div>
                          <span className="text-emerald-400 font-bold">{log.status === 'open' ? 'ABERTO' : 'FECHADO'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-[10px] text-slate-600 py-3 font-mono">NENHUM REGISTRO HOJE</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------
              TAB 6: PAINEL GERENCIAL (BENTO MENU & DETAILS)
             ------------------------------------------ */}
          {activeSubTab === 'gerencial' && (
            <div className="space-y-5 animate-fade-in" id="erp-gerencial-tab">
              
              {activeGerencialModule === null ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Products */}
                  <button
                    onClick={() => setActiveGerencialModule('produtos')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-400 border border-orange-500/20">
                      <Tag className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-orange-400 transition-colors">PRODUTOS & ESTOQUE</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        Catálogo e estoque avançado com lotes, validades e controle de grades.
                      </p>
                    </div>
                  </button>

                  {/* Vendas / Sales */}
                  <button
                    onClick={() => setActiveGerencialModule('vendas')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400 border border-blue-500/20">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-blue-400 transition-colors">VENDAS & ANALYTICS</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        Gráficos de faturamento, ticket médio e metas da organização.
                      </p>
                    </div>
                  </button>

                  {/* Financeiro */}
                  <button
                    onClick={() => setActiveGerencialModule('financeiro')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-emerald-400 transition-colors">FINANCEIRO INTERNO</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        Movimentações internas, custos, entradas e balanços periódicos.
                      </p>
                    </div>
                  </button>

                  {/* Equipe / RH */}
                  <button
                    onClick={() => setActiveGerencialModule('rh')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-pink-500/10 rounded-2xl flex items-center justify-center text-pink-400 border border-pink-500/20">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-pink-400 transition-colors">RECURSOS HUMANOS</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        Gestão de colaboradores, cargos, admissões e chamados de extra.
                      </p>
                    </div>
                  </button>

                  {/* CRM */}
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="relative bg-slate-900 border border-slate-850 p-5 rounded-3xl text-left transition-all cursor-not-allowed space-y-2 opacity-75"
                  >
                    <span className="absolute top-4 right-4 text-[8px] font-mono font-black uppercase tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                      Em desenvolvimento
                    </span>
                    <div className="w-10 h-10 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-400 border border-cyan-500/20">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase">CRM</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5 pr-20">
                        Relacionamento, segmentação, histórico e inteligência sobre a base de clientes.
                      </p>
                    </div>
                  </button>

                  {/* Marketing Analytics */}
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="relative bg-slate-900 border border-slate-850 p-5 rounded-3xl text-left transition-all cursor-not-allowed space-y-2 opacity-75"
                  >
                    <span className="absolute top-4 right-4 text-[8px] font-mono font-black uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                      Em desenvolvimento
                    </span>
                    <div className="w-10 h-10 bg-violet-500/10 rounded-2xl flex items-center justify-center text-violet-400 border border-violet-500/20">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase">MARKETING</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5 pr-20">
                        Aquisição, conversão, retenção, canais e insights de performance comercial.
                      </p>
                    </div>
                  </button>

                  {/* Integracoes / Sandbox */}
                  <button
                    onClick={() => setActiveGerencialModule('integracoes')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-400 border border-purple-500/20">
                      <Settings className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-purple-400 transition-colors">INTEGRAÇÕES</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        API tokens, webhooks e canais externos validados pelo backend.
                      </p>
                    </div>
                  </button>

                  {/* Vouchers */}
                  <button
                    onClick={() => setActiveGerencialModule('vouchers')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-400 border border-amber-500/20">
                      <Percent className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-amber-400 transition-colors">CUPONS & VOUCHERS</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        Criação e gestão de cupons, vouchers e incentivos promocionais da vitrine.
                      </p>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveGerencialModule(null)}
                      className="px-3 py-1.5 bg-slate-950 border border-slate-850 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      ← Menu Gerencial
                    </button>
                    <span className="text-xs text-slate-500 font-mono">/ {activeGerencialModule}</span>
                  </div>

                  {/* SUBMODULE: PRODUTOS */}
                  {activeGerencialModule === 'produtos' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* Custons */}
                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                          <h4 className="text-xs font-black text-white uppercase">Aparência da Vitrine</h4>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Nome de Exibição</label>
                            <input
                              type="text"
                              value={storeName}
                              onChange={(e) => setStoreName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Palavras-Chave SEO Local</label>
                            <input
                              type="text"
                              placeholder="ex: eletronicos, informatica, pc gamer"
                              value={storeKeywords}
                              onChange={(e) => setStoreKeywords(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white"
                            />
                          </div>

                          <button
                            onClick={handleSaveThemeCustomization}
                            className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase"
                          >
                            Salvar Alterações
                          </button>
                        </div>
                      </div>

                      {/* Items */}
                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                          <h4 className="text-xs font-black text-white uppercase">Itens Ativos no Estoque</h4>

                        </div>

                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {activeRetailerProducts.map(prod => (
                            <div key={prod.id} className="bg-slate-950 p-2.5 rounded-2xl border border-slate-850/60 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <img src={prod.image} alt={prod.name} className="w-10 h-10 object-cover rounded-lg" />
                                <div className="text-xs">
                                  <strong className="text-slate-200 block truncate max-w-[150px]">{prod.name}</strong>
                                  <span className="text-[10px] text-emerald-400">R$ {prod.price.toFixed(2)}</span>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono text-slate-500">Estoque: {prod.stock} un</span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}

                  {/* SUBMODULE: RECURSOS HUMANOS */}
                  {activeGerencialModule === 'rh' && (
                    <div
                      id="kyrub-store-hr-legacy-anchor"
                      className="min-w-0"
                    />
                  )}

                  {/* SUBMODULE: FINANCEIRO INTERNO */}
                  {activeGerencialModule === 'financeiro' && (
                    <div
                      id="kyrub-store-finance-legacy-anchor"
                      className="min-w-0"
                    />
                  )}

                  {/* SUBMODULE: INTEGRATIONS */}
                  {activeGerencialModule === 'integracoes' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-purple-400 uppercase">Configuração de canais externos</h4>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Sincronize seu catálogo físico e digital com marketplaces líderes do mercado nacional.
                        </p>
                        
                        <div className="space-y-2">
                          {['Mercado Livre', 'Shopee', 'Amazon Brasil', 'Kyrub Marketplace Hub'].map(channel => (
                            <div key={channel} className="bg-slate-950 p-3 rounded-2xl border border-slate-850 flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-200">{channel}</span>
                              <span className="text-[9px] font-mono bg-slate-900 border border-slate-800 text-slate-500 px-2 py-0.5 rounded">
                                Desconectado
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-3">
                        <h4 className="text-xs font-black text-orange-400 uppercase">Webhooks de integração</h4>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Eventos externos só aparecem no KDS depois de serem recebidos e validados pelo backend. Este painel não gera pedidos simulados.
                        </p>
                      </div>

                    </div>
                  )}

                  {/* SUBMODULE: VENDAS (Sales) */}
                  {activeGerencialModule === 'vendas' && (
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-850 space-y-3">
                      <h4 className="text-xs font-black text-blue-500 uppercase">GERENCIAL: SALES</h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Indicadores de vendas serão exibidos somente quando derivados dos pedidos e pagamentos reais da loja.
                      </p>
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950 p-6 text-center text-[10px] font-mono uppercase text-slate-500">
                        Nenhum indicador demonstrativo é exibido.
                      </div>
                    </div>
                  )}

                  {/* SUBMODULE: VOUCHERS */}
                  {activeGerencialModule === 'vouchers' && (
                    <div
                      id="kyrub-store-promotions-legacy-anchor"
                      className="min-w-0"
                    />
                  )}

                </div>
              )}

            </div>
          )}

        </div>

      {/* ==========================================
          MODAL 1: RESERVAS FORM
         ========================================== */}
      {showNewReservationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-black text-white uppercase tracking-wider">Nova Reserva Futura</h3>
              <button 
                onClick={() => setShowNewReservationModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">NOME DO CLIENTE</label>
                <input
                  type="text"
                  placeholder="Nome Completo..."
                  value={newResName}
                  onChange={(e) => setNewResName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">DATA</label>
                  <input
                    type="date"
                    value={newResDate}
                    onChange={(e) => setNewResDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">HORA</label>
                  <input
                    type="time"
                    value={newResTime}
                    onChange={(e) => setNewResTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">COMPANHANTES/PESSOAS</label>
                <input
                  type="number"
                  min={1}
                  value={newResPeople}
                  onChange={(e) => setNewResPeople(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white text-center"
                />
              </div>

              <button
                onClick={handleConfirmReservation}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-black rounded-xl text-xs uppercase"
              >
                Confirmar Reserva
              </button>
            </div>
          </div>
        </div>
      )}



    </div>
  );
};