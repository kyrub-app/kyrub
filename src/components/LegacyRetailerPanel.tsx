import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, DollarSign, ClipboardList, Calendar, Clock, LayoutGrid, 
  Plus, Tag, Play, Pause, Trash2, Upload, AlertCircle, ShieldAlert,
  Search, ShieldCheck, Database, Key, Percent, Gift, Award, FileText,
  UserCheck, MapPin, Laptop, Wifi, RefreshCw, Send, ArrowUpRight, ArrowDownLeft,
  Settings, Briefcase, BarChart3, ChevronRight, Fingerprint, Store as StoreIcon,
  Zap, X
} from 'lucide-react';
import Dexie, { type Table } from 'dexie';
import { Tenant, Store, Product, Order } from '../types';
import { db } from '../utils/firebase';
import { doc, runTransaction, deleteDoc } from 'firebase/firestore';
import { listenCollection, saveDocLWW } from '../utils/syncEngine';
import type { BuildUserStoreUpdateInput } from '../utils/userStoreDocument';

// ==========================================
// DEXIE OFFLINE CACHE SCHEMA
// ==========================================
interface CashSession {
  id?: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  initialCash: number;
  finalCash?: number;
}

interface CashMovement {
  id?: number;
  type: 'entrada' | 'saida';
  description: string;
  amount: number;
  category: string;
  timestamp: string;
}

class DexieERPDB extends Dexie {
  sessions!: Table<CashSession>;
  movements!: Table<CashMovement>;

  constructor() {
    super('DexieERPDB');
    this.version(1).stores({
      sessions: '++id, status, openedAt',
      movements: '++id, type, category, timestamp'
    });
  }
}

const erpDB = new DexieERPDB();

// ==========================================
// RETAILER PANEL MAIN COMPONENT
// ==========================================
interface RetailerPanelProps {
  activeRetailerId: string;
  activeRetailer: Tenant | undefined;
  activeStore: Store;
  products: Product[];
  orders: Order[];
  setNewProductModal: (val: boolean) => void;
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
  setNewProductModal,
  setProducts,
  setOrders,
  onUpdateStore,
  triggerToast,
  activeSubTab,
  setActiveSubTab,
  atendimentoSpaces,
  producaoSpaces
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

  // 1. CLIENTS PANEL STATES
  const [clientSearchCode, setClientSearchCode] = useState('');
  const [clientCategory, setClientCategory] = useState<string>('GERAL');
  const [clientItemCount, setClientItemCount] = useState(1);
  const [clientSubTab, setClientSubTab] = useState<string>('GERAL');
  const [activeTickets, setActiveTickets] = useState<any[]>([]);

  useEffect(() => {
    if (atendimentoSpaces && atendimentoSpaces.length > 0) {
      if (!atendimentoSpaces.includes(clientSubTab)) {
        setClientSubTab(atendimentoSpaces[0]);
      }
      if (!atendimentoSpaces.includes(clientCategory)) {
        setClientCategory(atendimentoSpaces[0]);
      }
    }
  }, [atendimentoSpaces]);

  useEffect(() => {
    const tenantId = activeRetailerId || 'tenant_default';
    const unsub = listenCollection(`tenants/${tenantId}/active_sessions`, (docs) => {
      const activeFromRemote = docs.filter(d => d.status !== 'closed');
      setActiveTickets(activeFromRemote);
    });
    return () => unsub();
  }, [activeRetailerId]);

  // 2. CAIXA STATES (Dexie Cached)
  const [isCashierOpen, setIsCashierOpen] = useState(true);
  const [cashList, setCashList] = useState<CashMovement[]>([]);
  const [isSyncingWithFirestore, setIsSyncingWithFirestore] = useState(false);

  useEffect(() => {
    // Load local cached cashier movements from Dexie
    const loadDexieData = async () => {
      try {
        const moves = await erpDB.movements.toArray();
        setCashList(moves);
      } catch (err) {
        console.error(err);
      }
    };
    loadDexieData();
  }, []);

  // 3. KDS / SALES STATES
  const [kdsFilter, setKdsFilter] = useState<string>('TODOS');

  useEffect(() => {
    if (producaoSpaces && producaoSpaces.length > 0) {
      if (!producaoSpaces.includes(kdsFilter)) {
        setKdsFilter(producaoSpaces[0]);
      }
    }
  }, [producaoSpaces]);
  
  // 4. RESERVATIONS
  const [reservations, setReservations] = useState<any[]>([]);
  const [showNewReservationModal, setShowNewReservationModal] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResDate, setNewResDate] = useState('');
  const [newResTime, setNewResTime] = useState('');
  const [newResPeople, setNewResPeople] = useState(1);

  // 5. COLLABORATOR PORTAL / GPS PUNCH-IN
  const [pontoLogs, setPontoLogs] = useState<any[]>([]);

  // 6. GENERAL FINANCE / HR / CUSTOMIZATION / FISCAL
  const [hrWorkers, setHrWorkers] = useState<any[]>([]);

  const [finMovements, setFinMovements] = useState<any[]>([]);
  const [newFinDesc, setNewFinDesc] = useState('');
  const [newFinVal, setNewFinVal] = useState('');
  const [newFinType, setNewFinType] = useState<'entrada' | 'saida'>('entrada');
  const [newFinCat, setNewFinCat] = useState('Mercadorias');

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

  // Vouchers state
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherType, setNewVoucherType] = useState<'percentage' | 'fixed'>('percentage');
  const [newVoucherVal, setNewVoucherVal] = useState('');
  const [newVoucherLimit, setNewVoucherLimit] = useState('');

  // FISCAL SEFAZ ENGINE STATE
  const [fiscalLogs, setFiscalLogs] = useState<string[]>([]);
  const [showFiscalLogsModal, setShowFiscalLogsModal] = useState(false);
  const [latestFiscalXml, setLatestFiscalXml] = useState<string>('');

  // Helpers
  const isPremium = activeRetailer?.plan === 'business';

  // ==========================================
  // ECOSSISTEMA: PDV SALE SUBTRACTION LINKED TO MARKETPLACE
  // ==========================================
  const registerFiscalIntegrationPending = () => {
    setLatestFiscalXml('');
    setFiscalLogs(prev => [
      `[${new Date().toLocaleTimeString()}] Documento fiscal não emitido: integração fiscal ainda não configurada para esta loja.`,
      ...prev
    ]);
  };

  const handleOpenTicket = async () => {
    if (!clientSearchCode.trim()) {
      triggerToast('Insira um nome ou identificador do cliente!', 'error');
      return;
    }
    const id = `TCK-${Math.floor(100 + Math.random() * 900)}`;
    const newTicket = {
      id,
      name: `${clientCategory} - ${clientSearchCode}`,
      category: clientCategory.toUpperCase(),
      items: clientItemCount,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setActiveTickets([newTicket, ...activeTickets]);
    setClientSearchCode('');
    triggerToast(`Atendimento ${id} aberto com sucesso!`, 'success');

    // Dual-write to Firestore in background
    const tenantId = activeRetailerId || 'tenant_default';
    await saveDocLWW(`tenants/${tenantId}/active_sessions`, id, newTicket);
  };

  const handleCheckoutTicket = async (ticketId: string) => {
    const ticket = activeTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    // Use transaction lock
    const tenantId = activeRetailerId || 'tenant_default';
    const ticketRef = doc(db, 'tenants', tenantId, 'active_sessions', ticketId);
    try {
      await runTransaction(db, async (transaction) => {
        const ticketDoc = await transaction.get(ticketRef);
        if (ticketDoc.exists()) {
          const data = ticketDoc.data();
          if (data.status === 'closed') {
            throw new Error('Esta comanda já foi fechada por outro operador!');
          }
          transaction.update(ticketRef, { 
            status: 'closed', 
            closedAt: new Date().toISOString(),
            closedBy: activeRetailer?.email || 'Operador',
            updatedAt: new Date().toISOString()
          });
        } else {
          // If it doesn't exist on server yet, write it as closed
          transaction.set(ticketRef, {
            ...ticket,
            status: 'closed',
            closedAt: new Date().toISOString(),
            closedBy: activeRetailer?.email || 'Operador',
            updatedAt: new Date().toISOString()
          });
        }
      });
    } catch (error: any) {
      triggerToast(error.message || 'Falha concorrente ao fechar comanda!', 'error');
      return;
    }

    // The ticket is closed without fabricating price, stock or fiscal data.
    // Real stock and financial movements will be recorded when the sale flow
    // provides validated items, quantities and payment totals.
    registerFiscalIntegrationPending();

    setActiveTickets(prev => prev.filter(t => t.id !== ticketId));
    triggerToast(
      `Atendimento ${ticket.id} fechado. Emissão fiscal ainda não configurada.`,
      'success'
    );
  };

  const handleManualProductAddition = () => {
    if (activeRetailer?.plan === 'free' && activeRetailerProducts.length >= 5) {
      triggerToast('Limite Freemium atingido! Faça upgrade para o plano Business para cadastrar mais de 5 produtos.', 'error');
      return;
    }
    setNewProductModal(true);
  };

  const handlePlanUpgrade = () => {
    triggerToast(
      'A contratação do plano Business ainda não está configurada.',
      'info'
    );
  };

  // 4. RESERVATIONS CONFIRMATION
  const handleConfirmReservation = () => {
    if (!newResName.trim()) {
      triggerToast('Nome do cliente é obrigatório!', 'error');
      return;
    }
    const newRes = {
      id: `res-${Math.floor(Math.random() * 1000)}`,
      client: newResName,
      date: newResDate.split('-').reverse().join('/'),
      time: newResTime,
      people: newResPeople
    };
    setReservations([newRes, ...reservations]);
    setNewResName('');
    setShowNewReservationModal(false);
    triggerToast(`Reserva para ${newResName} agendada com sucesso!`, 'success');
  };

  // 5. CLOCK IN
  const handleClockIn = () => {
    const timeStr = currentTime.toLocaleTimeString();
    const dateStr = currentTime.toLocaleDateString();
    const newLog = {
      time: timeStr,
      date: dateStr,
      location: ''
    };
    setPontoLogs([newLog, ...pontoLogs]);
    triggerToast(`Ponto registrado com sucesso às ${timeStr}!`, 'success');
  };

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

  const handleSyncFirestore = () => {
    setIsSyncingWithFirestore(true);
    setTimeout(() => {
      setIsSyncingWithFirestore(false);
      triggerToast('Sincronização reativa de cache Dexie concluída com o Firestore!', 'success');
    }, 1200);
  };

  // Totalized sales
  const cashTotalDinheiro = cashList.filter(c => c.type === 'entrada').reduce((sum, c) => sum + c.amount, 0);
  const cashTotalCartao = orders.filter(o => o.type === 'retail' && o.storeId === activeStore?.id).reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="space-y-6 text-slate-100 font-sans" id="erp-master-dashboard">
      
      <div className="space-y-6" id="erp-tab-content-area">

          {/* ------------------------------------------
              TAB 1: PAINEL DE CLIENTES
             ------------------------------------------ */}
          {activeSubTab === 'clientes' && (
            <div className="space-y-5 animate-fade-in" id="erp-clientes-tab">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 p-4 rounded-3xl border border-slate-800">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-black text-white flex items-center gap-1.5 uppercase">
                    <span>Atendimentos Ativos</span>
                    <span className="text-[10px] font-mono bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.2 rounded-full">
                      {activeTickets.length} Ativos
                    </span>
                  </h3>
                </div>

                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center w-full" id="erp-attendance-opener-row">
                  <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 w-full sm:w-auto">
                    <input
                      type="text"
                      placeholder="Nome ou Cód. do Cliente..."
                      value={clientSearchCode}
                      onChange={(e) => setClientSearchCode(e.target.value)}
                      className="bg-transparent border-none text-xs text-white focus:outline-none font-semibold py-0.5 w-full sm:w-44"
                    />
                  </div>
                  <select
                    value={clientCategory}
                    onChange={(e) => setClientCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-semibold cursor-pointer w-full sm:w-auto"
                  >
                    {atendimentoSpaces.map(space => (
                      <option key={space} value={space}>{space}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="number"
                      min={1}
                      value={clientItemCount}
                      onChange={(e) => setClientItemCount(parseInt(e.target.value) || 1)}
                      className="flex-1 sm:w-14 bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white text-center focus:outline-none font-semibold"
                      title="Quantidade de pessoas"
                    />
                    <button
                      onClick={handleOpenTicket}
                      className="bg-orange-500 hover:bg-orange-600 text-slate-950 p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 w-10 h-10 sm:w-8 sm:h-8 shadow-sm"
                      title="Abrir Atendimento"
                    >
                      <Plus className="w-4 h-4 font-black" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Sub-abas de Categorias (Filtros em bloco) */}
              <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-none max-w-full pb-1">
                {atendimentoSpaces.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setClientSubTab(cat)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                      clientSubTab === cat 
                        ? 'bg-orange-500 text-slate-950' 
                        : 'bg-slate-900 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Active tickets listings */}
              {activeTickets.filter(t => clientSubTab === (atendimentoSpaces[0] || 'GERAL') || t.category === clientSubTab).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeTickets.filter(t => clientSubTab === (atendimentoSpaces[0] || 'GERAL') || t.category === clientSubTab).map(ticket => (
                    <div key={ticket.id} className="bg-slate-900 border border-slate-800 p-4 rounded-3xl space-y-4 flex flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[9px] font-mono text-orange-400 uppercase font-black">{ticket.category} • {ticket.id}</span>
                          <h4 className="text-sm font-black text-white mt-1">{ticket.name}</h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">Qtd. Itens Solicitados: {ticket.items}</p>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500">{ticket.createdAt}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-850">
                        <button
                          onClick={() => handleCheckoutTicket(ticket.id)}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Faturar & Transmitir Fiscal
                        </button>
                        <button
                          onClick={async () => {
                            const tenantId = activeRetailerId || 'tenant_default';
                            setActiveTickets(activeTickets.filter(t => t.id !== ticket.id));
                            try {
                              await deleteDoc(doc(db, 'tenants', tenantId, 'active_sessions', ticket.id));
                            } catch (err) {
                              console.error("Error deleting session doc in Firestore:", err);
                            }
                            triggerToast('Atendimento cancelado.', 'info');
                          }}
                          className="p-2 bg-slate-950 border border-slate-850 hover:bg-red-950/20 text-red-400 hover:text-red-300 rounded-xl transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl py-12 text-center" id="empty-clients">
                  <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-xs text-slate-400 font-bold">NENHUM CLIENTE EM ATENDIMENTO</p>
                  <p className="text-[11px] text-slate-500 mt-1">Insira os dados acima para abrir um novo atendimento do caixa.</p>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------
              TAB 2: PAINEL DO CAIXA (Dexie Cached)
             ------------------------------------------ */}
          {activeSubTab === 'caixa' && (
            <div className="space-y-5 animate-fade-in" id="erp-caixa-tab">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">DINHEIRO (LOCAL CACHE)</span>
                  <strong className="text-xl font-mono text-white">
                    R$ {cashTotalDinheiro.toFixed(2)}
                  </strong>
                  <p className="text-[10px] text-slate-400">Gravado via Dexie Offline-First</p>
                </div>
                
                <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">CARTÃO / PIX (ONLINE)</span>
                  <strong className="text-xl font-mono text-teal-400">
                    R$ {cashTotalCartao.toFixed(2)}
                  </strong>
                  <p className="text-[10px] text-slate-400">Sincronizado via Gateway de Vendas</p>
                </div>

                <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 flex flex-col justify-center space-y-2">
                  <button
                    onClick={() => {
                      setIsCashierOpen(!isCashierOpen);
                      triggerToast(isCashierOpen ? 'Caixa fechado com sucesso.' : 'Caixa aberto para lançamentos.', 'info');
                    }}
                    className={`w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                      isCashierOpen 
                        ? 'bg-red-950/80 hover:bg-red-900/60 text-red-400 border border-red-800' 
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {isCashierOpen ? 'FECHAR CAIXA' : 'ABRIR CAIXA'}
                  </button>
                  
                  <button
                    onClick={handleSyncFirestore}
                    disabled={isSyncingWithFirestore}
                    className="w-full py-2 bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-400 hover:text-slate-300 rounded-xl text-[10px] uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingWithFirestore ? 'animate-spin text-orange-400' : 'text-slate-400'}`} />
                    <span>Sincronizar Dexie</span>
                  </button>
                </div>
              </div>

              {/* Transactions logs list */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">Últimas Movimentações do Caixa</h3>
                  <span className="text-[9px] font-mono text-emerald-400 font-bold flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    <span>SQLite/Dexie Ativo</span>
                  </span>
                </div>

                {cashList.length > 0 ? (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {cashList.map((c, idx) => (
                      <div key={idx} className="bg-slate-950 p-3 rounded-2xl border border-slate-850/60 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2.5">
                          {c.type === 'entrada' ? (
                            <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4 text-red-400 shrink-0" />
                          )}
                          <div>
                            <span className="text-slate-200 font-bold block">{c.description}</span>
                            <span className="text-[10px] text-slate-500">{c.category} • {c.timestamp}</span>
                          </div>
                        </div>
                        <span className={c.type === 'entrada' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                          {c.type === 'entrada' ? '+' : '-'} R$ {c.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-xs text-slate-500 py-8 font-mono">NENHUMA MOVIMENTAÇÃO REGISTRADA</p>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------
              TAB 3: PAINEL DE PEDIDOS E VENDAS
             ------------------------------------------ */}
          {activeSubTab === 'pedidos' && (
            <div className="space-y-5 animate-fade-in" id="erp-pedidos-tab">
              {/* Filter pills */}
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-900 overflow-x-auto whitespace-nowrap scrollbar-none max-w-full pb-1">
                {producaoSpaces.map(f => (
                  <button
                    key={f}
                    onClick={() => setKdsFilter(f)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                      kdsFilter === f 
                        ? 'bg-orange-500 text-slate-950' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

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
                        <span className="text-[9px] font-mono text-slate-400">{res.date} • {res.time}</span>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{res.client}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">Pessoas/Companhantes: {res.people}</p>
                      </div>
                      <div className="pt-2 border-t border-slate-850 flex justify-end">
                        <button
                          onClick={() => {
                            setReservations(reservations.filter(r => r.id !== res.id));
                            triggerToast('Reserva concluída.', 'success');
                          }}
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
                  <p className="text-[10px] text-slate-400">Validação obrigatória via Geofencing GPS</p>
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
                  onClick={handleClockIn}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Fingerprint className="w-4 h-4 text-slate-950" />
                  <span>REGISTRAR ENTRADA</span>
                </button>

                <div className="pt-4 border-t border-slate-850 text-left space-y-2">
                  <span className="text-[10px] font-mono text-slate-500 uppercase block">Histórico de Hoje</span>
                  {pontoLogs.length > 0 ? (
                    <div className="space-y-1.5">
                      {pontoLogs.map((log, idx) => (
                        <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-[10px] font-mono flex items-center justify-between">
                          <div>
                            <span className="text-white font-bold block">Entrada Registrada</span>
                            <span className="text-slate-500">{log.location || 'Localização não registrada'}</span>
                          </div>
                          <span className="text-emerald-400 font-bold">{log.time}</span>
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

                  {/* Integracoes / Sandbox */}
                  <button
                    onClick={() => setActiveGerencialModule('integracoes')}
                    className="bg-slate-900 border border-slate-850 hover:border-orange-500/30 p-5 rounded-3xl text-left transition-all cursor-pointer group space-y-2"
                  >
                    <div className="w-10 h-10 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-400 border border-purple-500/20">
                      <Settings className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase group-hover:text-purple-400 transition-colors">INTEGRAÇÕES & SANDBOX</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                        API tokens, Webhooks, sandbox de simulação e faturadores externos.
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
                        Campanhas de marketing e cupons de desconto para a sua vitrine.
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
                          <button
                            onClick={handleManualProductAddition}
                            className="text-orange-400 hover:text-orange-300 text-[10px] font-mono uppercase font-bold"
                          >
                            + Novo Item
                          </button>
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
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-850 space-y-5">
                      <div className="flex items-center justify-between border-b border-slate-850 pb-3">
                        <div>
                          <h4 className="text-xs font-black text-pink-500 uppercase">RECURSOS HUMANOS</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">Gestão Completa de Equipe & Folha</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => triggerToast('Menu de cargos e equipe acessado.', 'info')}
                            className="bg-pink-950/80 text-pink-400 border border-pink-900/60 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase cursor-pointer"
                          >
                            Equipe
                          </button>
                          <button 
                            onClick={() => triggerToast('Contratação de Extra/Freelancer iniciada via Kyrub Freelas.', 'info')}
                            className="bg-orange-600 hover:bg-orange-500 text-white font-black px-3 py-1.5 rounded-xl text-[10px] uppercase cursor-pointer"
                          >
                            Chamar Extra
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {hrWorkers.map(w => (
                          <div key={w.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <strong className="text-xs text-white">{w.name}</strong>
                                <span className="bg-pink-500/10 text-pink-400 text-[8px] font-mono font-bold px-1.5 py-0.2 rounded-full uppercase">
                                  {w.role}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">{w.email}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                <span>Ativo</span>
                              </span>
                              <button 
                                onClick={() => triggerToast(`Folha de pagamento para ${w.name} gerada com sucesso!`, 'success')}
                                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] text-slate-300 rounded-lg cursor-pointer"
                              >
                                Folha
                              </button>
                              <button 
                                onClick={() => triggerToast(`Editar dados de ${w.name}`, 'info')}
                                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-[10px] text-slate-300 rounded-lg cursor-pointer"
                              >
                                Editar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => triggerToast('Cadastros de segurança e acessos de equipe abertos.', 'info')}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-xl text-xs uppercase text-center cursor-pointer"
                      >
                        + Gerenciar Cadastros & Senhas
                      </button>
                    </div>
                  )}

                  {/* SUBMODULE: FINANCEIRO INTERNO */}
                  {activeGerencialModule === 'financeiro' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      
                      {/* Form inputs */}
                      <div className="lg:col-span-1 bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-white uppercase border-b border-slate-850 pb-2">Lançar Movimentação</h4>
                        
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Descrição</label>
                            <input
                              type="text"
                              value={newFinDesc}
                              onChange={(e) => setNewFinDesc(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                              placeholder="Ex: Conta de Luz"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Valor R$</label>
                            <input
                              type="number"
                              value={newFinVal}
                              onChange={(e) => setNewFinVal(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                              placeholder="0,00"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Tipo</label>
                            <select
                              value={newFinType}
                              onChange={(e) => setNewFinType(e.target.value as any)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                            >
                              <option value="entrada">Entrada (+)</option>
                              <option value="saida">Saída (-)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Categoria</label>
                            <select
                              value={newFinCat}
                              onChange={(e) => setNewFinCat(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                            >
                              <option value="Mercadorias">Mercadorias</option>
                              <option value="Custos Operacionais">Custos Operacionais</option>
                              <option value="Logística">Logística</option>
                            </select>
                          </div>

                          <button
                            onClick={() => {
                              if (!newFinDesc.trim() || !newFinVal) {
                                triggerToast('Preencha os dados do lançamento!', 'error');
                                return;
                              }
                              const entry = {
                                id: `f-${Date.now()}`,
                                desc: newFinDesc,
                                val: parseFloat(newFinVal),
                                type: newFinType,
                                cat: newFinCat
                              };
                              setFinMovements([entry, ...finMovements]);
                              setNewFinDesc('');
                              setNewFinVal('');
                              triggerToast('Lançamento registrado com sucesso!', 'success');
                            }}
                            className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase"
                          >
                            Registrar Movimentação
                          </button>
                        </div>
                      </div>

                      {/* Display summary */}
                      <div className="lg:col-span-2 bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-emerald-400 uppercase">GERENCIAL: FINANCE</h4>
                        
                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850 text-center font-mono">
                            <span className="text-[8px] text-slate-500 block uppercase">ENTRADAS (MÊS)</span>
                            <strong className="text-emerald-400 text-xs">
                              R$ {finMovements.filter(m => m.type === 'entrada').reduce((sum, m) => sum + m.val, 0).toFixed(2)}
                            </strong>
                          </div>
                          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850 text-center font-mono">
                            <span className="text-[8px] text-slate-500 block uppercase">SAÍDAS (MÊS)</span>
                            <strong className="text-red-400 text-xs">
                              R$ {finMovements.filter(m => m.type === 'saida').reduce((sum, m) => sum + m.val, 0).toFixed(2)}
                            </strong>
                          </div>
                          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850 text-center font-mono">
                            <span className="text-[8px] text-slate-500 block uppercase">SALDO ATUAL</span>
                            <strong className="text-white text-xs">
                              R$ {(finMovements.filter(m => m.type === 'entrada').reduce((sum, m) => sum + m.val, 0) - finMovements.filter(m => m.type === 'saida').reduce((sum, m) => sum + m.val, 0)).toFixed(2)}
                            </strong>
                          </div>
                        </div>

                        <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                          {finMovements.map(m => (
                            <div key={m.id} className="bg-slate-950 p-2 rounded-xl border border-slate-850 flex items-center justify-between text-xs font-mono">
                              <div>
                                <span className="text-slate-300 block">{m.desc}</span>
                                <span className="text-[9px] text-slate-500">{m.cat}</span>
                              </div>
                              <span className={m.type === 'entrada' ? 'text-emerald-400' : 'text-red-400'}>
                                {m.type === 'entrada' ? '+' : '-'} R$ {m.val.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}

                  {/* SUBMODULE: INTEGRATIONS & SANDBOX */}
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

                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-orange-400 uppercase">Sandbox Simulador</h4>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Envie um payload de teste para simular o recebimento de uma venda integrada no KDS.
                        </p>

                        <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-850 font-mono text-[10px] text-slate-400">
                          <p className="text-emerald-400">POST /api/webhooks/order-received</p>
                          <p className="text-slate-500">Nenhuma requisição simulada nesta sessão.</p>
                        </div>

                        <button
                          onClick={() => {
                            triggerToast('Simulação de Payload recebido! Novo pedido integrado no funil KDS.', 'success');
                          }}
                          className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase"
                        >
                          Disparar Payload Webhook
                        </button>
                      </div>

                    </div>
                  )}

                  {/* SUBMODULE: VENDAS (Sales) */}
                  {activeGerencialModule === 'vendas' && (
                    <div className="bg-slate-900 p-6 rounded-3xl border border-slate-850 space-y-5">
                      <h4 className="text-xs font-black text-blue-500 uppercase">GERENCIAL: SALES</h4>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 block uppercase font-bold">Vendas Hoje</span>
                          <strong className="text-white text-xs font-mono">R$ 1.842,90</strong>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 block uppercase font-bold">Ticket Médio</span>
                          <strong className="text-white text-xs font-mono">R$ 153,50</strong>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 block uppercase font-bold">Total Pedidos</span>
                          <strong className="text-white text-xs font-mono">12 un</strong>
                        </div>
                        <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850">
                          <span className="text-[8px] text-slate-500 block uppercase font-bold">Meta Alcançada</span>
                          <strong className="text-emerald-400 text-xs font-mono">92 %</strong>
                        </div>
                      </div>

                      <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl text-center space-y-1">
                        <span className="text-[9px] font-mono text-slate-500 uppercase block">GRÁFICO DE VENDAS (ÚLTIMOS 15 DIAS)</span>
                        <div className="h-28 flex items-end justify-center gap-2 pt-4">
                          {[30, 45, 25, 60, 80, 50, 95, 70, 85, 40, 65, 90, 110, 80, 120].map((val, idx) => (
                            <div key={idx} className="flex-1 bg-blue-500/80 rounded-t" style={{ height: `${val}%` }} title={`Dia ${idx + 1}: R$ ${val * 10}`} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SUBMODULE: VOUCHERS */}
                  {activeGerencialModule === 'vouchers' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-amber-500 uppercase">Criar Novo Cupom</h4>
                        
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">CÓDIGO DO CUPOM</label>
                            <input
                              type="text"
                              value={newVoucherCode}
                              onChange={(e) => setNewVoucherCode(e.target.value)}
                              placeholder="Ex: SPECIAL50"
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white uppercase"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">TIPO DE DESCONTO</label>
                            <select
                              value={newVoucherType}
                              onChange={(e) => setNewVoucherType(e.target.value as any)}
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                            >
                              <option value="percentage">Porcentagem (%)</option>
                              <option value="fixed">Valor Fixo (R$)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">VALOR DO DESCONTO</label>
                            <input
                              type="number"
                              value={newVoucherVal}
                              onChange={(e) => setNewVoucherVal(e.target.value)}
                              placeholder="Ex: 10"
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">LIMITE DE USO</label>
                            <input
                              type="number"
                              value={newVoucherLimit}
                              onChange={(e) => setNewVoucherLimit(e.target.value)}
                              placeholder="Ex: 100"
                              className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white"
                            />
                          </div>

                          <button
                            onClick={() => {
                              if (!newVoucherCode.trim() || !newVoucherVal) {
                                triggerToast('Preencha os campos do voucher!', 'error');
                                return;
                              }
                              const voucher = {
                                id: `v-${Date.now()}`,
                                code: newVoucherCode.toUpperCase(),
                                type: newVoucherType,
                                val: parseFloat(newVoucherVal),
                                limit: parseInt(newVoucherLimit) || 100
                              };
                              setVouchers([...vouchers, voucher]);
                              setNewVoucherCode('');
                              setNewVoucherVal('');
                              setNewVoucherLimit('');
                              triggerToast(`Cupom ${voucher.code} ativado com sucesso!`, 'success');
                            }}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase"
                          >
                            Ativar Cupom Promocional
                          </button>
                        </div>
                      </div>

                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4">
                        <h4 className="text-xs font-black text-white uppercase">Cupons Promocionais Ativos</h4>
                        <div className="space-y-2">
                          {vouchers.map(v => (
                            <div key={v.id} className="bg-slate-950 p-3 rounded-2xl border border-slate-850 flex items-center justify-between text-xs">
                              <div className="font-mono">
                                <strong className="text-amber-400 block">{v.code}</strong>
                                <span className="text-slate-500 text-[10px]">Limite de Uso: {v.limit} un</span>
                              </div>
                              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full">
                                {v.type === 'percentage' ? `${v.val}% OFF` : `R$ ${v.val} OFF`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
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

      {/* ==========================================
          MODAL 2: TERMINAL SEFAZ / FISCAL CONSOLE LOGS
         ========================================== */}
      {showFiscalLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-855 pb-2">
              <div className="flex items-center gap-2">
                <Laptop className="w-5 h-5 text-emerald-400 animate-pulse" />
                <h3 className="text-xs font-black text-white uppercase tracking-wider">Terminal SEFAZ Retaguarda Fator-PDV</h3>
              </div>
              <button 
                onClick={() => setShowFiscalLogsModal(false)}
                className="p-1.5 bg-slate-950 border border-slate-850 text-slate-400 hover:text-white rounded-lg"
              >
                Fechar
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              A integração fiscal ainda não está configurada para esta loja. Nenhum XML, protocolo ou autorização é fabricado pelo painel.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Transmissões Recentes</span>
                <div className="bg-slate-950 border border-slate-850 p-3 rounded-2xl h-60 overflow-y-auto text-[10px] font-mono text-slate-300 space-y-2">
                  {fiscalLogs.length > 0 ? (
                    fiscalLogs.map((log, idx) => (
                      <p key={idx} className="border-b border-slate-900/50 pb-1.5 last:border-b-0">{log}</p>
                    ))
                  ) : (
                    <p className="text-slate-600">Nenhuma transmissão fiscal registrada no faturamento recente.</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Último documento fiscal</span>
                <div className="bg-slate-950 border border-slate-850 p-3 rounded-2xl h-60 overflow-y-auto text-[9px] font-mono text-amber-500/95 leading-tight whitespace-pre">
                  {latestFiscalXml || 'Nenhum documento fiscal emitido.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
