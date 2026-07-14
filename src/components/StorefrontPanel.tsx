import React from 'react';
import { ShoppingCart, ShoppingBag, Heart } from 'lucide-react';
import { Store, Product } from '../types';

interface StorefrontPanelProps {
  activeConsumerStore: Store | undefined;
  products: Product[];
  cart: any[];
  setIsCartOpen: (val: boolean) => void;
  handleAddToCart: (product: Product) => void;
  stores: Store[];
  setActiveConsumerStore: (store: Store) => void;
}

export const StorefrontPanel: React.FC<StorefrontPanelProps> = ({
  activeConsumerStore,
  products,
  cart,
  setIsCartOpen,
  handleAddToCart,
  stores,
  setActiveConsumerStore
}) => {
  if (!activeConsumerStore) {
    return (
      <div className="text-center py-20 bg-slate-900 rounded-3xl border border-slate-800" id="storefront-selection-needed">
        <h3 className="text-xl font-bold text-white mb-2">Qual vitrine do Kyrub você deseja visitar?</h3>
        <p className="text-slate-400 text-sm mb-6">Selecione uma loja varejista ativa abaixo para simular o fluxo de compra B2C:</p>
        <div className="flex flex-wrap justify-center gap-4">
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => setActiveConsumerStore(store)}
              className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-white font-bold px-5 py-3 rounded-2xl transition-all flex items-center gap-2"
              id={`select-store-btn-${store.id}`}
            >
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: store.primaryColor }} />
              <span>{store.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Consumer products published by the selected retailer store
  // Since we mapped the products with supplierId of the retailer t-3 or local additions, let's select appropriate ones
  const isBella = activeConsumerStore.slug.includes('bella');
  const storeOwnerTenantId = isBella ? 't-4' : 't-3';
  const storefrontProducts = products.filter(p => p.supplierId === storeOwnerTenantId && !p.wholesalePrice);

  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="space-y-8 animate-fade-in" id="storefront-panel-container">
      
      {/* Storefront Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden border border-slate-800/80 shadow-2xl bg-slate-950 p-8 md:p-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-6" id="storefront-banner">
        <div className="absolute inset-0 bg-cover bg-center opacity-10" style={{ backgroundImage: `url(${activeConsumerStore.banner})` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950 to-transparent" />
        
        <div className="relative z-10 space-y-3 max-w-xl">
          <div className="flex items-center gap-3">
            <img src={activeConsumerStore.logo} alt={activeConsumerStore.name} className="w-12 h-12 object-cover rounded-xl border border-slate-800" />
            <h2 className="text-2xl md:text-3.5xl font-black text-white tracking-tight">{activeConsumerStore.name}</h2>
          </div>
          <p className="text-slate-300 text-sm md:text-base leading-relaxed">{activeConsumerStore.description}</p>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-400 pt-1">
            <span className="flex items-center gap-1.5"><Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" /> 98.4% Recomendado</span>
            <span>•</span>
            <span className="text-emerald-400 font-bold">Entrega Kyrub Express</span>
          </div>
        </div>

        {/* Floating Cart Button */}
        <div className="relative z-10 shrink-0 self-end md:self-center">
          <button
            onClick={() => setIsCartOpen(true)}
            className="flex items-center gap-3 text-white font-bold px-6 py-4 rounded-2xl shadow-xl transition-all cursor-pointer hover:scale-[1.02]"
            style={{ backgroundColor: activeConsumerStore.primaryColor }}
            id="storefront-view-cart-btn"
          >
            <ShoppingCart className="w-5 h-5" />
            <span>Ver Carrinho ({cartItemsCount})</span>
          </button>
        </div>
      </div>

      {/* Switch storefront option */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <h3 className="text-lg font-black text-white flex items-center gap-2">
          <ShoppingBag className="w-5 h-5" style={{ color: activeConsumerStore.primaryColor }} />
          <span>Vitrine de Ofertas</span>
        </h3>
        
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Mudar de loja:</span>
          {stores.map(store => (
            <button
              key={store.id}
              onClick={() => {
                setActiveConsumerStore(store);
                // Clear cart on store switch
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                activeConsumerStore.id === store.id 
                  ? 'bg-slate-800 text-white' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {store.name}
            </button>
          ))}
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {storefrontProducts.map(prod => (
          <div
            key={prod.id}
            className="bg-slate-900 border border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all flex flex-col justify-between"
            id={`storefront-prod-${prod.id}`}
          >
            <div className="relative aspect-square overflow-hidden bg-slate-950">
              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover transition-transform hover:scale-105 duration-500" />
              <span className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-sm border border-slate-800 text-slate-300 font-mono text-[10px] px-2 py-0.5 rounded-md">
                {prod.category}
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between gap-4">
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-slate-200 truncate">{prod.name}</h4>
                <p className="text-slate-400 text-xs line-clamp-2 leading-relaxed">{prod.description}</p>
              </div>

              <div className="space-y-3.5 pt-3 border-t border-slate-800/50">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-slate-500 uppercase font-mono">Preço À Vista</span>
                  <span className="font-mono text-base font-black text-white">R$ {prod.price.toFixed(2)}</span>
                </div>

                <button
                  onClick={() => handleAddToCart(prod)}
                  className="w-full text-white font-black py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-md uppercase tracking-wider cursor-pointer"
                  style={{ backgroundColor: activeConsumerStore.primaryColor }}
                  id={`add-to-cart-btn-${prod.id}`}
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>Adicionar</span>
                </button>
              </div>
            </div>
          </div>
        ))}

        {storefrontProducts.length === 0 && (
          <div className="col-span-full py-16 text-center text-slate-500 text-xs">
            Nenhum produto publicado nesta loja varejista ainda.
          </div>
        )}
      </div>

    </div>
  );
};
