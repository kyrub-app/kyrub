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
  staffOrders,
}: StaffViewportProps) {
  return (
    <div
      className="flex min-h-[100dvh] min-w-0 flex-col justify-between overflow-x-hidden bg-slate-950 p-3 font-sans text-slate-100 antialiased sm:p-6"
      id="staff-viewport"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-5 flex min-w-0 flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900/90 px-4 py-4 backdrop-blur-md sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-600">
              <Layers className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <span className="block truncate font-mono text-[8px] font-bold uppercase text-orange-500">
                Canal do Colaborador • ERP Kyrub
              </span>
              <h3 className="truncate text-sm font-black uppercase text-white">
                Portal Operacional Staff
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={handleGoBackToMain}
            className="min-h-11 w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-slate-800 sm:w-auto"
          >
            Voltar ao App
          </button>
        </header>

        {!isStaffLoggedIn ? (
          <div className="flex w-full flex-1 items-center justify-center py-8 sm:py-12">
            <form
              onSubmit={handleStaffLogin}
              className="relative w-full max-w-sm space-y-5 overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900 p-5 shadow-2xl sm:p-8"
            >
              <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-orange-500/5 blur-2xl" />
              <div className="space-y-1.5 pb-2 text-center">
                <h2 className="text-lg font-black uppercase tracking-wider text-white">
                  Acesso Staff
                </h2>
                <p className="text-xs leading-relaxed text-slate-400">
                  Insira as credenciais operacionais fornecidas pelo lojista.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase text-slate-400">
                    Email do Colaborador
                  </label>
                  <input
                    type="email"
                    placeholder="staff@kyrub.com"
                    value={staffEmail}
                    onChange={event => setStaffEmail(event.target.value)}
                    autoComplete="username"
                    className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-3 text-white outline-none transition-colors focus:border-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase text-slate-400">
                    Senha de Acesso
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={staffPassword}
                    onChange={event => setStaffPassword(event.target.value)}
                    autoComplete="current-password"
                    className="min-h-12 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-3 text-white outline-none transition-colors focus:border-orange-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="min-h-12 w-full rounded-xl bg-orange-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-orange-600/10 transition-colors hover:bg-orange-500"
              >
                Autenticar Painel
              </button>

              <div className="rounded-xl border border-slate-800/50 bg-slate-950/60 p-3 text-center font-mono text-[10px] text-slate-500">
                <span>Dica de Teste:</span>
                <span className="mt-1 block break-all font-bold text-slate-400">
                  staff@kyrub.com / kyrub123
                </span>
              </div>
            </form>
          </div>
        ) : (
          <div className="min-w-0 flex-1 space-y-5 sm:space-y-6">
            <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-orange-400 font-mono">
                  Estabelecimento Parceiro
                </span>
                <h2 className="mt-1 break-words text-xl font-black tracking-tight text-white sm:text-2xl">
                  {activeStore?.name || 'Loja não identificada'}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Sua conta operacional possui privilégios de leitura e expedição física de produtos.
                </p>
              </div>
              <button
                type="button"
                onClick={handleStaffLogout}
                className="min-h-11 w-full rounded-xl bg-red-950 px-4 py-2.5 text-xs font-bold uppercase text-red-300 transition-colors hover:bg-red-900 sm:w-auto"
              >
                Encerrar Turno
              </button>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
                <h3 className="mb-4 flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-black uppercase text-white">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-orange-500" />
                  <span className="min-w-0">Pedidos Recebidos</span>
                </h3>

                <div className="kyrub-modal-scroll max-h-[480px] space-y-4 overflow-y-auto pr-1">
                  {staffOrders.map(order => (
                    <article
                      key={order.id}
                      className="min-w-0 space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4"
                    >
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 break-all font-mono text-[10px] uppercase text-slate-500">
                          ID: {order.id}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                            order.status === 'delivered'
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                              : order.status === 'shipped'
                                ? 'border-blue-500/20 bg-blue-500/10 text-blue-400'
                                : order.status === 'processing'
                                  ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400'
                                  : 'border-slate-700 bg-slate-800 text-slate-400'
                          }`}
                        >
                          {order.status === 'delivered'
                            ? 'Entregue'
                            : order.status === 'shipped'
                              ? 'Enviado'
                              : order.status === 'processing'
                                ? 'Em Preparo'
                                : 'Pendente'}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-slate-500">
                          Cliente Destinatário
                        </span>
                        <span className="break-words text-xs font-bold text-slate-200">
                          {order.buyerName}
                        </span>
                      </div>

                      <div className="space-y-1.5 border-t border-slate-900 pt-2.5">
                        <span className="block font-mono text-[10px] uppercase text-slate-500">
                          Itens para Separação
                        </span>
                        {order.items.map((item, index) => (
                          <div
                            key={`${order.id}-${item.productId || index}`}
                            className="flex min-w-0 items-start justify-between gap-3 text-xs text-slate-300"
                          >
                            <span className="min-w-0 break-words">{item.name}</span>
                            <span className="shrink-0 font-mono font-bold text-orange-400">
                              x{item.quantity}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}

                  {staffOrders.length === 0 && (
                    <p className="py-12 text-center text-xs leading-relaxed text-slate-500">
                      Nenhum pedido recente registrado para separação.
                    </p>
                  )}
                </div>
              </section>

              <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
                <h3 className="mb-4 flex items-center gap-2 border-b border-slate-800 pb-3 text-sm font-black uppercase text-white">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-teal-500" />
                  <span className="min-w-0">Inventário e Estoque</span>
                </h3>

                <div className="kyrub-modal-scroll max-h-[480px] space-y-3 overflow-y-auto pr-1">
                  {staffProducts.map(product => (
                    <article
                      key={product.id}
                      className="flex min-w-0 gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Layers className="h-4 w-4 text-slate-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-xs font-bold text-slate-200">
                          {product.name}
                        </h4>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                          Categoria: {product.category || 'Não informada'}
                        </p>
                        <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 text-[10px] text-slate-500">
                            Unidades em estoque
                          </span>
                          <span
                            className={`shrink-0 rounded-lg border px-2 py-0.5 font-mono text-xs font-bold ${
                              product.stock < 10
                                ? 'border-red-500/25 bg-red-500/15 text-red-400'
                                : 'border-slate-800 bg-slate-900 text-slate-300'
                            }`}
                          >
                            {product.stock} un
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}

                  {staffProducts.length === 0 && (
                    <p className="py-12 text-center text-xs leading-relaxed text-slate-500">
                      Nenhum produto cadastrado no inventário.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <footer className="mt-6 border-t border-slate-900 px-2 py-4 text-center font-mono text-[9px] leading-relaxed text-slate-500 sm:text-[10px]">
        Kyrub Ecosystem Platform • Operações seguras sem exposição de margens
      </footer>
    </div>
  );
}
