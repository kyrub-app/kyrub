import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { Store, CartItem } from '../../types';

interface B2CCartDrawerProps {
  isOpen: boolean;
  visitingStore: Store | null;
  onClose: () => void;
  cart: CartItem[];
  updateCartQty: (productId: string, quantity: number) => void;
  checkoutCart: (e: React.FormEvent) => void;
  buyerName: string;
  setBuyerName: (val: string) => void;
  buyerEmail: string;
  setBuyerEmail: (val: string) => void;
  buyerAddress: string;
  setBuyerAddress: (val: string) => void;
}

export const B2CCartDrawer: React.FC<B2CCartDrawerProps> = ({
  isOpen,
  visitingStore,
  onClose,
  cart,
  updateCartQty,
  checkoutCart,
  buyerName,
  setBuyerName,
  buyerEmail,
  setBuyerEmail,
  buyerAddress,
  setBuyerAddress
}) => {
  if (!isOpen || !visitingStore) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" style={{ color: visitingStore.primaryColor }} />
              <span>Seu Carrinho</span>
            </h3>
            <button 
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 font-bold text-sm"
            >
              Fechar ✕
            </button>
          </div>

          <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
            {cart.map(item => (
              <div key={item.product.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800/60 flex gap-3">
                <img src={item.product.image} alt={item.product.name} className="w-12 h-12 object-cover rounded-lg shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <h4 className="font-bold text-xs text-slate-200 truncate">{item.product.name}</h4>
                  <p className="font-mono text-xs text-white">R$ {item.product.price.toFixed(2)}</p>
                  
                  <div className="flex items-center gap-2 pt-1">
                    <button 
                      onClick={() => updateCartQty(item.product.id, item.quantity - 1)}
                      className="bg-slate-900 text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-xs"
                      type="button"
                    >
                      -
                    </button>
                    <span className="text-xs font-bold text-slate-300 font-mono">{item.quantity}</span>
                    <button 
                      onClick={() => updateCartQty(item.product.id, item.quantity + 1)}
                      className="bg-slate-900 text-slate-400 hover:text-white px-1.5 py-0.5 rounded text-xs"
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {cart.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-xs">
                Seu carrinho está vazio. Adicione produtos na vitrine.
              </div>
            )}
          </div>
        </div>

        {/* Checkout Form */}
        {cart.length > 0 && (
          <form onSubmit={checkoutCart} className="border-t border-slate-800/80 pt-6 space-y-4">
            <div className="space-y-2.5">
              <h4 className="text-xs font-mono uppercase text-slate-400">Dados do Destinatário</h4>
              
              <input 
                type="text" 
                placeholder="Seu Nome Completo" 
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                required
              />

              <input 
                type="email" 
                placeholder="Seu Email" 
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                required
              />

              <input 
                type="text" 
                placeholder="Endereço de Entrega" 
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none" 
                required
              />
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Subtotal:</span>
                <span className="font-mono text-slate-200">R$ {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Frete Simulador:</span>
                <span className="text-emerald-400 uppercase font-mono text-[10px] font-bold">Grátis</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-white border-t border-slate-900 pt-2">
                <span>Total Compra:</span>
                <span className="font-mono" style={{ color: visitingStore.primaryColor }}>
                  R$ {subtotal.toFixed(2)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full text-white font-black py-3 rounded-xl text-xs transition-all shadow-md uppercase tracking-wider cursor-pointer"
              style={{ backgroundColor: visitingStore.primaryColor }}
            >
              Confirmar Pedido B2C
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
