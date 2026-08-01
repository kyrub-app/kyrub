import React from 'react';
import {
  Activity,
  Database,
  Package,
  Settings,
  ShoppingCart,
  Store as StoreIcon,
  Users,
} from 'lucide-react';
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

const formatCurrency = (value: number): string =>
  value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

export const AdminPanel: React.FC<AdminPanelProps> = ({
  tenants,
  stores,
  products,
  orders,
}) => {
  const totalGmvB2B = orders
    .filter(order => order.type === 'wholesale')
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const totalGmvB2C = orders
    .filter(order => order.type === 'retail')
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const totalGmv = totalGmvB2B + totalGmvB2C;
  const businessTenants = tenants.filter(
    tenant => tenant.plan === 'business'
  ).length;

  return (
    <div className="space-y-8 animate-fade-in" id="admin-panel-container">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-blue-400">
            Visão gerencial local
          </span>
          <h2 className="text-3xl font-black tracking-tight text-white">
            Painel de Controle Kyrub
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Contagens e volumes calculados somente a partir dos dados atualmente
            carregados. Receita, conversão e preços dependem de regras comerciais
            ainda não configuradas neste painel.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="font-mono text-xs text-slate-300">
            Saúde detalhada disponível no Control Plane
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div
          className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900 p-6 shadow-lg"
          id="stat-gmv"
        >
          <ShoppingCart className="h-5 w-5 text-blue-400" />
          <p className="mt-4 font-mono text-xs uppercase text-slate-500">
            GMV observado
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {formatCurrency(totalGmv)}
          </p>
          <p className="mt-2 text-[11px] text-slate-400">
            B2B: {formatCurrency(totalGmvB2B)} · B2C:{' '}
            {formatCurrency(totalGmvB2C)}
          </p>
        </div>

        <div
          className="rounded-2xl border border-slate-800/80 bg-slate-900 p-6 shadow-lg"
          id="stat-orders"
        >
          <Database className="h-5 w-5 text-emerald-400" />
          <p className="mt-4 font-mono text-xs uppercase text-slate-500">
            Pedidos carregados
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {orders.length.toLocaleString('pt-BR')}
          </p>
          <p className="mt-2 text-[11px] text-slate-400">
            Contagem do conjunto disponível nesta sessão.
          </p>
        </div>

        <div
          className="rounded-2xl border border-slate-800/80 bg-slate-900 p-6 shadow-lg"
          id="stat-tenants"
        >
          <StoreIcon className="h-5 w-5 text-orange-400" />
          <p className="mt-4 font-mono text-xs uppercase text-slate-500">
            Lojas registradas
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {stores.length.toLocaleString('pt-BR')}
          </p>
          <p className="mt-2 text-[11px] text-slate-400">
            {businessTenants.toLocaleString('pt-BR')} tenant(s) com plano
            Business registrado.
          </p>
        </div>

        <div
          className="rounded-2xl border border-slate-800/80 bg-slate-900 p-6 shadow-lg"
          id="stat-products"
        >
          <Package className="h-5 w-5 text-violet-400" />
          <p className="mt-4 font-mono text-xs uppercase text-slate-500">
            Produtos carregados
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {products.length.toLocaleString('pt-BR')}
          </p>
          <p className="mt-2 text-[11px] text-slate-400">
            Conversão comercial ainda não mensurada.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div
          className="rounded-3xl border border-slate-800/80 bg-slate-900 p-6 lg:col-span-2"
          id="tenant-list-card"
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white">
              <Users className="h-5 w-5 text-blue-500" />
              <span>Contas comerciais registradas</span>
            </h3>
            <span className="rounded-lg bg-slate-950 px-2.5 py-1 font-mono text-xs text-slate-400">
              {tenants.length.toLocaleString('pt-BR')}
            </span>
          </div>

          {tenants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
              Nenhuma conta comercial está disponível nesta sessão.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 font-mono text-xs uppercase text-slate-500">
                    <th className="pb-3">Organização</th>
                    <th className="pb-3">Tipo</th>
                    <th className="pb-3">Plano registrado</th>
                    <th className="pb-3">E-mail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {tenants.map(tenant => {
                    const store = tenant.storeId
                      ? stores.find(item => item.id === tenant.storeId)
                      : undefined;
                    const initial = tenant.name.trim().charAt(0).toUpperCase() || 'K';

                    return (
                      <tr key={tenant.id}>
                        <td className="py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-white">
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-white">
                                {tenant.name || 'Nome não informado'}
                              </span>
                              {store?.slug && (
                                <span className="block truncate text-[10px] text-slate-500">
                                  /{store.slug}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-4 text-xs text-slate-300">
                          {tenant.role === 'supplier'
                            ? 'Fornecedor'
                            : 'Lojista'}
                        </td>
                        <td className="py-4 text-xs text-slate-300">
                          {tenant.plan === 'business' ? 'Business' : 'Grátis'}
                        </td>
                        <td className="py-4 font-mono text-xs text-slate-400">
                          {tenant.email || 'Não informado'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          className="space-y-6 rounded-3xl border border-slate-800/80 bg-slate-900 p-6"
          id="platform-config-card"
        >
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <Settings className="h-5 w-5 text-slate-400" />
            <span>Estado comercial</span>
          </h3>

          <div className="space-y-4 text-xs leading-relaxed text-slate-400">
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <strong className="text-amber-300">Ainda não configurado</strong>
              <p className="mt-2">
                Comissão, preço de assinatura, conversão e receita não são
                calculados até existirem regras comerciais e fonte de cobrança
                aprovadas.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <strong className="text-slate-200">Regra ativa conhecida</strong>
              <p className="mt-2">
                O plano gratuito permite até cinco produtos cadastrados. Outros
                limites e benefícios devem vir da configuração oficial de planos.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <strong className="text-slate-200">Administração segura</strong>
              <p className="mt-2">
                Promoções de plano, permissões, auditoria e saúde do sistema devem
                ser executadas no Control Plane autenticado, nunca por uma mutação
                local desta tela.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
