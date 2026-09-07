import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  CheckCircle2,
  DollarSign,
  Package,
  Percent,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { Order, Product, Store } from '../types';
import { auth } from '../utils/firebase';
import {
  persistPublicProduct,
  type PublicProduct,
} from '../utils/publicProducts';
import { removePublicProduct } from '../utils/publicProductMutations';
import { ProductEditorModal } from './store/ProductEditorModal';
import { ProductInventoryWorkspace } from './store/ProductInventoryWorkspace';
import MercadoLivreE2ETestBridge from './store/MercadoLivreE2ETestBridge';
import StoreConnectionsWorkspace from './store/StoreConnectionsWorkspace';
import { StoreTeamWorkspace } from './store/StoreTeamWorkspace';

type GerencialModule =
  | 'produtos'
  | 'vendas'
  | 'financeiro'
  | 'rh'
  | 'integracoes'
  | 'vouchers';

type ToastType = 'success' | 'error' | 'info';

interface GerencialPanelProps {
  activeRetailerId: string;
  activeStore: Store;
  products: Product[];
  orders: Order[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setNewProductModal: (value: boolean) => void;
  triggerToast: (message: string, type?: ToastType) => void;
  setActiveSubTab: (
    tab: 'clientes' | 'caixa' | 'pedidos' | 'reservas' | 'ponto' | 'gerencial'
  ) => void;
}

type ModuleCardProps = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
};

function ModuleCard({
  title,
  description,
  icon: Icon,
  accent,
  badge,
  disabled = false,
  onClick,
}: ModuleCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
      className={`relative min-h-36 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-70'
          : 'cursor-pointer hover:border-orange-500/35 hover:bg-slate-900/90'
      }`}
    >
      {badge && (
        <span className="absolute right-4 top-4 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[8px] font-black uppercase tracking-wider text-slate-400">
          {badge}
        </span>
      )}
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-2xl border border-current/20 bg-slate-950 ${accent}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-xs font-black uppercase text-white">{title}</h3>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{description}</p>
    </button>
  );
}

function NativeMigrationNotice({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-orange-300">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
      <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">{description}</p>
      <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
        Nenhum dado comercial é inventado neste estado e nenhuma informação é persistida apenas para preencher a interface.
      </p>
    </section>
  );
}

function SalesPanel({ orders }: { orders: Order[] }) {
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const averageTicket = orders.length > 0 ? revenue / orders.length : 0;
  const delivered = orders.filter(order => order.status === 'delivered').length;
  const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  return (
    <section className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div>
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-blue-300">
          Vendas & Analytics
        </span>
        <h3 className="mt-1 text-base font-black text-white">Desempenho registrado pela loja</h3>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Os indicadores abaixo são calculados somente a partir dos pedidos disponíveis para esta loja neste estado do aplicativo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Faturamento</span>
          <strong className="mt-1 block text-xs text-white">{currency.format(revenue)}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Ticket médio</span>
          <strong className="mt-1 block text-xs text-white">{currency.format(averageTicket)}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Pedidos</span>
          <strong className="mt-1 block text-xs text-white">{orders.length}</strong>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-500">Concluídos</span>
          <strong className="mt-1 block text-xs text-emerald-300">{delivered}</strong>
        </div>
      </div>

      {orders.length > 0 ? (
        <div className="space-y-2">
          {orders.slice(0, 8).map(order => (
            <div
              key={order.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3"
            >
              <div className="min-w-0">
                <strong className="block truncate text-[10px] text-white">{order.buyerName || 'Cliente não informado'}</strong>
                <span className="mt-0.5 block font-mono text-[9px] uppercase text-slate-500">{order.status}</span>
              </div>
              <span className="shrink-0 text-[10px] font-black text-slate-300">{currency.format(order.total)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-6 text-center text-[10px] text-slate-500">
          Nenhum pedido associado a esta loja foi encontrado para compor os indicadores.
        </div>
      )}
    </section>
  );
}

export function GerencialPanel({
  activeRetailerId,
  activeStore,
  products,
  orders,
  setProducts,
  setNewProductModal,
  triggerToast,
  setActiveSubTab,
}: GerencialPanelProps) {
  const [activeModule, setActiveModule] = useState<GerencialModule | null>(null);
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [notice, setNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [busyProductId, setBusyProductId] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const activeRetailerProducts = useMemo(
    () =>
      products.filter(
        product =>
          product.supplierId === activeRetailerId &&
          product.wholesalePrice === undefined
      ),
    [activeRetailerId, products]
  );

  const storeOrders = useMemo(
    () => orders.filter(order => order.storeId === activeRetailerId),
    [activeRetailerId, orders]
  );

  const notify = (message: string, type: ToastType = 'info'): void => {
    setNotice({ message, type });
    triggerToast(message, type);
  };

  const handleCreateProduct = (): void => {
    if (activeStore.plan === 'free' && activeRetailerProducts.length >= 5) {
      triggerToast('O plano gratuito permite até 5 produtos ou serviços por loja.', 'error');
      return;
    }
    setNewProductModal(true);
  };

  const handleSaveProduct = async (product: Product): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== activeRetailerId) {
      throw new Error('Faça login novamente para atualizar o item.');
    }

    const previousProduct = products.find(item => item.id === product.id);
    const updatedProduct: PublicProduct = {
      ...product,
      storeId: currentUser.uid,
      supplierId: currentUser.uid,
      updatedAt: new Date().toISOString(),
    };

    setBusyProductId(product.id);
    setProducts(previous =>
      previous.map(item => item.id === product.id ? updatedProduct : item)
    );

    try {
      await persistPublicProduct(currentUser, updatedProduct);
      setEditingProduct(null);
      triggerToast(`“${updatedProduct.name}” foi atualizado.`, 'success');
    } catch (error) {
      if (previousProduct) {
        setProducts(previous =>
          previous.map(item => item.id === product.id ? previousProduct : item)
        );
      }
      console.error('Falha ao atualizar produto:', error);
      throw new Error('Não foi possível salvar as alterações do item.');
    } finally {
      setBusyProductId('');
    }
  };

  const handleConfirmDeleteProduct = async (): Promise<void> => {
    const product = deletingProduct;
    const currentUser = auth.currentUser;
    if (!product) return;
    if (!currentUser || currentUser.uid !== activeRetailerId) {
      triggerToast('Faça login novamente para excluir o item.', 'error');
      return;
    }

    setBusyProductId(product.id);
    setProducts(previous => previous.filter(item => item.id !== product.id));

    try {
      await removePublicProduct(currentUser, product.id);
      setDeletingProduct(null);
      triggerToast(`“${product.name}” foi excluído do catálogo.`, 'success');
    } catch (error) {
      setProducts(previous =>
        previous.some(item => item.id === product.id)
          ? previous
          : [product, ...previous]
      );
      console.error('Falha ao excluir produto:', error);
      triggerToast('Não foi possível excluir o item.', 'error');
    } finally {
      setBusyProductId('');
    }
  };

  const moduleTitle: Record<GerencialModule, string> = {
    produtos: 'Produtos & Estoque',
    vendas: 'Vendas & Analytics',
    financeiro: 'Financeiro Interno',
    rh: 'Recursos Humanos',
    integracoes: 'Integrações & Sandbox',
    vouchers: 'Cupons & Vouchers',
  };

  return (
    <div className="space-y-5" id="kyrub-gerencial-native-runtime" data-kyrub-gerencial-runtime="native">
      <header className="flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">Painel Gerencial</span>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[8px] font-black uppercase text-emerald-300">Runtime nativo</span>
          </div>
          <h2 className="mt-1 text-lg font-black text-white">
            {activeModule ? moduleTitle[activeModule] : 'Gestão da loja'}
          </h2>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Esta área é renderizada diretamente em React, sem depender do painel Gerencial legado ou de bridges de DOM.
          </p>
        </div>

        <div className="flex gap-2">
          {activeModule && (
            <button
              type="button"
              onClick={() => setActiveModule(null)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300"
            >
              <ArrowLeft className="h-4 w-4" />
              Menu Gerencial
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveSubTab('clientes')}
            className="min-h-10 rounded-xl bg-orange-500 px-3 text-[9px] font-black uppercase text-slate-950"
          >
            Voltar ao PDV
          </button>
        </div>
      </header>

      {!activeModule && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ModuleCard
            title="Produtos & Estoque"
            description="Catálogo, publicação, estoque e edição dos itens da loja."
            icon={Package}
            accent="text-orange-300"
            onClick={() => setActiveModule('produtos')}
          />
          <ModuleCard
            title="Vendas & Analytics"
            description="Indicadores calculados a partir dos pedidos reais associados à loja."
            icon={BarChart3}
            accent="text-blue-300"
            onClick={() => setActiveModule('vendas')}
          />
          <ModuleCard
            title="Financeiro Interno"
            description="Custos, entradas, obrigações e projeções financeiras da operação."
            icon={DollarSign}
            accent="text-emerald-300"
            badge="Migração nativa"
            onClick={() => setActiveModule('financeiro')}
          />
          <ModuleCard
            title="Recursos Humanos"
            description="Equipe, convites, papéis e acessos da loja usando o workspace canônico."
            icon={Users}
            accent="text-pink-300"
            onClick={() => setActiveModule('rh')}
          />
          <ModuleCard
            title="CRM"
            description="Relacionamento, segmentação, histórico e inteligência sobre clientes."
            icon={UserCheck}
            accent="text-cyan-300"
            badge="Em desenvolvimento"
            disabled
          />
          <ModuleCard
            title="Marketing"
            description="Aquisição, conversão, retenção, canais e inteligência de crescimento."
            icon={Zap}
            accent="text-violet-300"
            badge="Em desenvolvimento"
            disabled
          />
          <ModuleCard
            title="Integrações & Sandbox"
            description="Conexões externas, OAuth, sincronização e testes controlados dos canais."
            icon={Settings}
            accent="text-purple-300"
            onClick={() => setActiveModule('integracoes')}
          />
          <ModuleCard
            title="Cupons & Vouchers"
            description="Incentivos promocionais permanecem separados de CRM e Marketing."
            icon={Percent}
            accent="text-amber-300"
            badge="Migração nativa"
            onClick={() => setActiveModule('vouchers')}
          />
        </div>
      )}

      {activeModule === 'produtos' && (
        <ProductInventoryWorkspace
          products={activeRetailerProducts}
          keywords={activeStore.keywords ?? []}
          onCreateProduct={handleCreateProduct}
          onEditProduct={setEditingProduct}
          onDeleteProduct={setDeletingProduct}
          busyProductId={busyProductId}
        />
      )}

      {activeModule === 'vendas' && <SalesPanel orders={storeOrders} />}

      {activeModule === 'financeiro' && (
        <NativeMigrationNotice
          title="Financeiro Interno"
          description="O painel antigo mantinha lançamentos apenas na memória da sessão. Esse comportamento não será reintroduzido. O próximo corte deve ligar esta área às projeções financeiras e autoridades econômicas canônicas já existentes no Kyrub."
          icon={DollarSign}
        />
      )}

      {activeModule === 'rh' && (
        <StoreTeamWorkspace
          legacyStore={activeStore}
          legacyStoreId={activeRetailerId}
          notify={(message, type = 'info') =>
            triggerToast(message, type === 'warning' ? 'info' : type)
          }
        />
      )}

      {activeModule === 'integracoes' && (
        <div className="space-y-5">
          {notice && (
            <div
              className={`rounded-2xl border px-4 py-3 text-[10px] leading-relaxed ${
                notice.type === 'success'
                  ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
                  : notice.type === 'error'
                    ? 'border-red-500/25 bg-red-500/[0.06] text-red-100'
                    : 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100'
              }`}
              role="status"
            >
              {notice.message}
            </div>
          )}

          {user ? (
            <>
              <StoreConnectionsWorkspace
                user={user}
                storeId={user.uid}
                notify={notify}
              />
              <MercadoLivreE2ETestBridge
                user={user}
                storeId={user.uid}
                notify={notify}
              />
            </>
          ) : (
            <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-[10px] leading-relaxed text-amber-100">
              A sessão autenticada ainda não está disponível para carregar as conexões da loja.
            </div>
          )}

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-purple-300" />
              <h3 className="text-xs font-black uppercase text-white">Demais canais</h3>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Mercado Livre é o primeiro canal montado nativamente neste runtime. Os demais conectores permanecem separados até receberem a mesma migração direta, sem bridges de DOM.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {['99Food', 'iFood', 'Shopee', 'Amazon Brasil', 'Quita', 'Kyrub Marketplace Hub'].map(channel => (
                <div key={channel} className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3">
                  <strong className="block text-[10px] text-slate-300">{channel}</strong>
                  <span className="mt-1 block font-mono text-[8px] uppercase text-slate-600">Migração nativa pendente</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-orange-300" />
              <h3 className="text-xs font-black uppercase text-white">Sandbox</h3>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              O teste E2E do Mercado Livre aparece automaticamente acima quando existir uma conexão autorizada. Nenhum pedido externo real é criado apenas por abrir este módulo.
            </p>
          </section>
        </div>
      )}

      {activeModule === 'vouchers' && (
        <NativeMigrationNotice
          title="Cupons & Vouchers"
          description="Os cupons continuam como módulo independente. A implementação nativa será ligada ao mecanismo autoritativo de promoções, em vez de restaurar a lista local e temporária do painel legado."
          icon={Percent}
        />
      )}

      <ProductEditorModal
        product={editingProduct}
        products={activeRetailerProducts}
        keywords={activeStore.keywords ?? []}
        isSaving={Boolean(busyProductId)}
        onClose={() => !busyProductId && setEditingProduct(null)}
        onSave={handleSaveProduct}
      />

      {deletingProduct && (
        <div className="fixed inset-0 z-[136] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="w-full max-w-md rounded-t-3xl border border-red-500/25 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-red-300">Excluir item</span>
                  <h3 className="mt-1 text-lg font-black text-white">Remover “{deletingProduct.name}”?</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar confirmação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-4 text-[10px] leading-relaxed text-red-100">
              O item deixará de aparecer no estoque e na vitrine. Pedidos antigos continuam preservando os dados registrados no momento da venda.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                disabled={Boolean(busyProductId)}
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteProduct()}
                disabled={Boolean(busyProductId)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
                {busyProductId ? 'Excluindo...' : 'Excluir item'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
