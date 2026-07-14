import React from 'react';
import { Package, Plus, Clock } from 'lucide-react';
import { Tenant, Product, Order } from '../types';

interface SupplierPanelProps {
  activeSupplierId: string;
  activeSupplier: Tenant | undefined;
  products: Product[];
  orders: Order[];
  setNewProductModal: (val: boolean) => void;
  handleUpdateOrderStatus: (orderId: string, newStatus: 'processing' | 'shipped' | 'delivered') => void;
}

export const SupplierPanel: React.FC<SupplierPanelProps> = ({
  activeSupplierId,
  activeSupplier,
  products,
  orders,
  setNewProductModal,
  handleUpdateOrderStatus
}) => {
  // Stats
  const wholesaleOrders = orders.filter(o => o.type === 'wholesale');
  const totalRevenue = wholesaleOrders
    .filter(o => {
      const firstItemProdId = o.items[0]?.productId;
      const associatedProduct = products.find(p => p.id === firstItemProdId);
      return associatedProduct?.supplierId === activeSupplierId || (firstItemProdId?.startsWith('p-b2b-') && activeSupplierId === 't-1');
    })
    .reduce((sum, o) => sum + o.total, 0);

  const activeSupplierProducts = products.filter(p => p.supplierId === activeSupplierId && p.wholesalePrice);

  return (
    <div className="space-y-8 animate-fade-in" id="supplier-panel-container">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold tracking-wider text-indigo-400 uppercase font-mono">Painel de Fornecimento B2B</span>
          <h2 className="text-3xl font-black text-white tracking-tight">{activeSupplier?.name}</h2>
          <p className="text-slate-400 text-sm mt-1">Gerencie seu estoque atacadista Kyrub, cadastre novos produtos e fature vendendo em lote para varejistas.</p>
        </div>
        <div>
          <button
            onClick={() => setNewProductModal(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-500/15 transition-all text-sm"
            id="supplier-add-product-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Produto de Atacado</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="supplier-stat-rev">
          <p className="text-xs font-mono uppercase text-slate-500">Vendas por Atacado (Faturamento)</p>
          <p className="text-2xl font-black text-white mt-2">
            R$ {totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">Vendas diretas para varejistas do ecossistema</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="supplier-stat-orders">
          <p className="text-xs font-mono uppercase text-slate-500">Pedidos Recebidos</p>
          <p className="text-2xl font-black text-indigo-400 mt-2">
            {wholesaleOrders.length} Pedidos
          </p>
          <p className="text-[11px] text-slate-400 mt-2">Lotes encomendados por lojistas para revenda</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="supplier-stat-count">
          <p className="text-xs font-mono uppercase text-slate-500">Itens no Catálogo B2B</p>
          <p className="text-2xl font-black text-white mt-2">
            {activeSupplierProducts.length} Produtos
          </p>
          <p className="text-[11px] text-slate-400 mt-2">Disponíveis para importação de varejistas</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800/80 shadow-lg" id="supplier-stat-stock">
          <p className="text-xs font-mono uppercase text-slate-500">Estoque Médio Disponível</p>
          <p className="text-2xl font-black text-indigo-400 mt-2">1,580 un.</p>
          <p className="text-[11px] text-slate-400 mt-2">Logística Kyrub de pronta-entrega</p>
        </div>
      </div>

      {/* Catalog & orders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Catalog list */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80 lg:col-span-2" id="supplier-catalog-card">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-500" />
            <span>Seu Catálogo Atacadista B2B</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeSupplierProducts.map(prod => (
              <div key={prod.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50 flex gap-4" id={`supplier-item-${prod.id}`}>
                <img src={prod.image} alt={prod.name} className="w-20 h-20 object-cover rounded-xl shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] uppercase font-mono text-indigo-400 bg-indigo-950/50 border border-indigo-900 px-1.5 py-0.5 rounded">
                    {prod.category}
                  </span>
                  <h4 className="font-bold text-sm text-slate-200 mt-1 truncate">{prod.name}</h4>
                  
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[9px] text-slate-500 block uppercase font-mono">Preço Atacado</span>
                      <span className="font-mono text-xs font-bold text-white">R$ {prod.wholesalePrice?.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block uppercase font-mono">Sugerido Varejo</span>
                      <span className="font-mono text-xs font-medium text-slate-400">R$ {prod.price.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2.5 border-t border-slate-900 pt-2 text-[10px] text-slate-400">
                    <span>Estoque: <strong className="text-slate-200">{prod.stock} un</strong></span>
                    <span>Pedido Mín: <strong className="text-slate-200">10 un</strong></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Wholesale orders list */}
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800/80" id="supplier-orders-card">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-400" />
            <span>Pedidos de Lotes Recentes</span>
          </h3>

          <div className="space-y-4">
            {wholesaleOrders.map(order => (
              <div key={order.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-3" id={`wholesale-order-card-${order.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-indigo-400 font-bold">{order.id}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    order.status === 'delivered' ? 'bg-emerald-950 text-emerald-400' :
                    order.status === 'shipped' ? 'bg-blue-950 text-blue-400' : 'bg-yellow-950 text-yellow-400'
                  }`}>
                    {order.status === 'delivered' ? 'Entregue' :
                     order.status === 'shipped' ? 'Enviado' : 'Pendente'}
                  </span>
                </div>

                <div className="text-xs text-slate-300">
                  <p className="font-bold text-slate-200">Cliente B2B: {order.buyerName}</p>
                  <ul className="mt-1.5 space-y-1 text-slate-400">
                    {order.items.map((it, i) => (
                      <li key={i}>{it.quantity}x {it.name}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center justify-between border-t border-slate-900 pt-2.5">
                  <span className="text-xs text-slate-400">Total B2B: <strong className="text-white font-mono">R$ {order.total.toFixed(2)}</strong></span>
                  
                  {order.status === 'pending' && (
                    <button
                      onClick={() => handleUpdateOrderStatus(order.id, 'shipped')}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] px-2.5 py-1 rounded"
                    >
                      Despachar Lote
                    </button>
                  )}
                  {order.status === 'shipped' && (
                    <button
                      onClick={() => handleUpdateOrderStatus(order.id, 'delivered')}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded"
                    >
                      Confirmar Entrega
                    </button>
                  )}
                </div>
              </div>
            ))}

            {wholesaleOrders.length === 0 && (
              <p className="text-center text-xs text-slate-500 py-8">Nenhum lote encomendado ainda.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
