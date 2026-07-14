import React from 'react';
import { Users, Settings, TrendingUp, ShieldCheck, Sparkles, Database } from 'lucide-react';
import { Tenant, Store, Order } from '../types';

interface AdminPanelProps {
  tenants: Tenant[];
  stores: Store[];
  products: any[];
  orders: Order[];
  setTenants: React.Dispatch<React.SetStateAction<Tenant[]>>;
  setStores: React.Dispatch<React.SetStateAction<Store[]>>;
  triggerToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  tenants,
  stores,
  products,
  orders,
  setTenants,
  setStores,
  triggerToast
}) => {
  // Platform Metrics
  const totalGmvB2B = orders.filter(o => o.type === 'wholesale').reduce((sum, o) => sum + o.total, 0);
  const totalGmvB2C = orders.filter(o => o.type === 'retail').reduce((sum, o) => sum + o.total, 0);
  const platformRevenue = (totalGmvB2C * 0.1) + (tenants.filter(t => t.plan === 'business').length * 99);

  const handleForceUpgrade = (tenantId: string) => {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, plan: 'business' } : t));
    const tenant = tenants.find(t => t.id === tenantId);
    if (tenant?.storeId) {
      setStores(prev => prev.map(s => s.id === tenant.storeId ? { ...s, plan: 'business' } : s));
    }
    triggerToast('Conta promovida para Premium Kyrub Business!', 'success');
  };

  return (
    <div className="space-y-8 animate-fade-in" id="admin-panel-container">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold tracking-wider text-blue-400 uppercase font-mono">Dono da Plataforma</span>
          <h2 className="text-3xl font-black text-white tracking-tight">Painel de Controle Kyrub</h2>
          <p className="text-slate-400 text-sm mt-1">Monitore o faturamento B2B2C, configure comissões e audite tenants ativos no ecossistema.</p>
        </div>
        <div className="bg-slate-900 px-4 py-3 rounded-2xl border border-slate-800 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-mono text-xs text-slate-300">Infra: Cloud Run + Cloudflare</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg relative overflow-hidden" id="stat-gmv">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl" />
          <p className="text-xs font-mono uppercase text-slate-500">GMV Total Transacionado</p>
          <p className="text-2xl font-black text-white mt-2">R$ {(totalGmvB2B + totalGmvB2C).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <div className="flex items-center gap-1.5 mt-2 text-slate-400 text-[11px]">
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            <span>B2B: R$ {totalGmvB2B.toLocaleString('pt-BR')} | B2C: R$ {totalGmvB2C.toLocaleString('pt-BR')}</span>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="stat-revenue">
          <p className="text-xs font-mono uppercase text-slate-500">Receita da Plataforma</p>
          <p className="text-2xl font-black text-emerald-400 mt-2">R$ {platformRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          <p className="text-[11px] text-slate-400 mt-2">10% comissão B2C + R$ 99 Assinatura Business</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="stat-tenants">
          <p className="text-xs font-mono uppercase text-slate-500">Lojas Ativas (Tenants)</p>
          <p className="text-2xl font-black text-white mt-2">{stores.length} Lojas</p>
          <p className="text-[11px] text-slate-400 mt-2">Todos com painel ERP autônomo</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="stat-conversion">
          <p className="text-xs font-mono uppercase text-slate-500">Taxa de Conversão Geral</p>
          <p className="text-2xl font-black text-blue-400 mt-2">4.2%</p>
          <p className="text-[11px] text-slate-400 mt-2">Média otimizada do ecossistema</p>
        </div>
      </div>

      {/* Tenant List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 lg:col-span-2" id="tenant-list-card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500" />
              <span>Lojistas e Fornecedores Kyrub</span>
            </h3>
            <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg">
              {tenants.length} tenants ativos
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 font-mono text-xs uppercase">
                  <th className="pb-3">Organização</th>
                  <th className="pb-3">Tipo</th>
                  <th className="pb-3">Plano</th>
                  <th className="pb-3">Email</th>
                  <th className="pb-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {tenants.map(t => (
                  <tr key={t.id} className="group">
                    <td className="py-4 font-medium text-white flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs">
                        {t.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span>{t.name}</span>
                        {t.storeId && (
                          <span className="block text-[10px] text-slate-500">/{stores.find(s => s.id === t.storeId)?.slug}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase font-mono ${
                        t.role === 'supplier' ? 'bg-indigo-950 text-indigo-400 border border-indigo-900' : 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                      }`}>
                        {t.role === 'supplier' ? 'Fornecedor' : 'Lojista'}
                      </span>
                    </td>
                    <td className="py-4">
                      <span className={`text-xs font-medium ${t.plan === 'business' ? 'text-yellow-400 flex items-center gap-1' : 'text-slate-400'}`}>
                        {t.plan === 'business' ? (
                          <>
                            <Sparkles className="w-3.5 h-3.5 shrink-0 text-yellow-400" />
                            <span>Business (R$ 99)</span>
                          </>
                        ) : 'Grátis'}
                      </span>
                    </td>
                    <td className="py-4 text-slate-400 font-mono text-xs">{t.email}</td>
                    <td className="py-4 text-right">
                      {t.plan === 'free' ? (
                        <button
                          onClick={() => handleForceUpgrade(t.id)}
                          className="text-xs bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg transition-all"
                          id={`force-upgrade-btn-${t.id}`}
                        >
                          Forçar Premium
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">Premium Ativo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Configurations */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 space-y-6" id="platform-config-card">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-400" />
            <span>Regras do Ecossistema</span>
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-2">Taxa de Comissão (B2C)</label>
              <div className="flex items-center gap-4">
                <input type="range" min="5" max="25" defaultValue="10" className="w-full accent-blue-500 bg-slate-800" />
                <span className="font-bold text-blue-400 text-sm">10%</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Deduzida de forma transparente no fechamento do carrinho.</p>
            </div>

            <div className="border-t border-slate-800/60 pt-4">
              <label className="block text-xs font-mono text-slate-400 uppercase mb-2">Configurações de Tenant</label>
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 space-y-2 text-xs font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>Database:</span>
                  <span className="text-slate-200">Firestore (Zero-Trust)</span>
                </div>
                <div className="flex justify-between">
                  <span>Edge Routing:</span>
                  <span className="text-slate-200">Cloudflare Enterprise</span>
                </div>
                <div className="flex justify-between">
                  <span>Server Engine:</span>
                  <span className="text-slate-200">Google Cloud Run</span>
                </div>
                <div className="flex justify-between">
                  <span>SSL & Tenants:</span>
                  <span className="text-emerald-400 font-bold">Ativo (*.kyrub.com)</span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800/60 pt-4 space-y-2 text-xs text-slate-400">
              <h4 className="font-bold text-slate-300">Regras de Escopo:</h4>
              <ul className="space-y-1.5 list-disc pl-4">
                <li>Lojista grátis publica até <strong className="text-slate-200">5 produtos</strong>.</li>
                <li>Importações em 1 clique direto dos catálogos de fornecedores.</li>
                <li>Upgrade de plano para produtos ilimitados por <strong className="text-yellow-400">R$ 99/mês</strong>.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
