import React from 'react';
import { Layers } from 'lucide-react';
import { Store, Product, Order } from '../types';

interface StaffViewportProps {
  isStaffLoggedIn: boolean;
  staffEmail: string;
  setStaffEmail: (email: string) => void;
  staffPassword: string;
  setStaffPassword: (password: string) => void;
  handleStaffLogin: (e: React.FormEvent) => void;
  handleStaffLogout: () => void;
  handleGoBackToMain: () => void;
  activeStore: Store | undefined;
  staffProducts: Product[];
  staffOrders: Order[];
}

export function StaffViewport({
  isStaffLoggedIn,
  staffEmail,
  setStaffEmail,
  staffPassword,
  setStaffPassword,
  handleStaffLogin,
  handleStaffLogout,
  handleGoBackToMain,
  activeStore,
  staffProducts,
  staffOrders
}: StaffViewportProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between font-sans antialiased p-4 sm:p-6" id="staff-viewport">
      <div className="flex-1 flex flex-col">
        {/* Staff view header */}
        <header className="border-b border-slate-900 bg-slate-900/90 backdrop-blur-md py-4 px-6 rounded-3xl flex items-center justify-between mb-6 border border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-mono text-[8px] uppercase font-bold text-orange-500">Canal do Colaborador • ERP Kyrub</span>
              <h3 className="text-sm font-black text-white uppercase">Portal Operacional Staff</h3>
            </div>
          </div>
          <button
            onClick={handleGoBackToMain}
            className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer font-bold uppercase tracking-wider"
          >
            Voltar ao App
          </button>
        </header>

        {!isStaffLoggedIn ? (
          <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full py-12">
            <form onSubmit={handleStaffLogin} className="bg-slate-900 border border-slate-800/80 p-8 rounded-3xl space-y-5 w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl" />
              <div className="text-center space-y-1.5 pb-2">
                <h2 className="text-lg font-black text-white uppercase tracking-wider">Acesso Staff</h2>
                <p className="text-xs text-slate-400">Insira as credenciais operacionais fornecidas pelo lojista.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-bold">Email do Colaborador</label>
                  <input
                    type="email"
                    placeholder="staff@kyrub.com"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1 font-bold">Senha de Acesso</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl transition-all shadow-lg shadow-orange-600/10 uppercase tracking-wider text-xs cursor-pointer"
              >
                Autenticar Painel
              </button>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/50 text-[10px] text-slate-500 font-mono text-center">
                <span>Dica de Teste:</span>
                <span className="block text-slate-400 font-bold mt-1">staff@kyrub.com / kyrub123</span>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
              <div>
                <span className="text-xs font-semibold tracking-wider text-orange-400 uppercase font-mono">Estabelecimento Parceiro</span>
                <h2 className="text-2xl font-black text-white tracking-tight">{activeStore?.name}</h2>
                <p className="text-slate-400 text-xs mt-0.5">Sua conta operacional possui privilégios de leitura e expedição física de produtos.</p>
              </div>
              <button
                onClick={handleStaffLogout}
                className="px-4 py-2 bg-red-950 hover:bg-red-900 text-red-300 font-bold rounded-xl text-xs transition-all uppercase cursor-pointer"
              >
                Encerrar Turno (Log Out)
              </button>
            </div>

            {/* Operational dashboard without financial data */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Orders List (Operational read-only view) */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
                <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <span>Pedidos Recebidos (Lista Operacional)</span>
                </h3>

                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                  {staffOrders.map(order => (
                    <div key={order.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-mono text-slate-500 uppercase">ID: {order.id}</span>
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase ${
                          order.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          order.status === 'shipped' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          order.status === 'processing' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {order.status === 'delivered' ? 'Entregue' :
                           order.status === 'shipped' ? 'Enviado' :
                           order.status === 'processing' ? 'Em Preparo' : 'Pendente'}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-mono text-slate-500 uppercase block">Cliente Destinatário</span>
                        <span className="text-xs font-bold text-slate-200">{order.buyerName}</span>
                      </div>

                      <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
                        <span className="text-[10px] font-mono text-slate-500 uppercase block">Itens para Separação</span>
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-slate-300">
                            <span>{item.name}</span>
                            <span className="font-mono text-orange-400 font-bold">x{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {staffOrders.length === 0 && (
                    <p className="text-center text-xs text-slate-500 py-12">Nenhum pedido recente registrado para separação.</p>
                  )}
                </div>
              </div>

              {/* Stock status view */}
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800">
                <h3 className="text-sm font-black text-white uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
                  <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                  <span>Inventário & Estoque Físico</span>
                </h3>

                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {staffProducts.map(prod => (
                    <div key={prod.id} className="bg-slate-950 p-3 rounded-2xl border border-slate-850 flex gap-3">
                      <img src={prod.image} alt={prod.name} className="w-12 h-12 object-cover rounded-xl shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-xs text-slate-200 truncate">{prod.name}</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Categoria: {prod.category}</p>
                        <div className="flex justify-between items-center mt-2.5">
                          <span className="text-[10px] text-slate-500">Unidades em Estoque:</span>
                          <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg ${
                            prod.stock < 10 ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bg-slate-900 text-slate-300 border border-slate-800'
                          }`}>
                            {prod.stock} un
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {staffProducts.length === 0 && (
                    <p className="text-center text-xs text-slate-500 py-12">Nenhum produto cadastrado no inventário.</p>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-900 py-4 mt-6 text-center text-[10px] text-slate-500 font-mono">
        Kyrub Ecosystem Platform • Operações Seguras sem Exposição de Margens • Faturamento Ocultado por Diretrizes de Compliance
      </footer>
    </div>
  );
}
