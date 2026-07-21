import React from 'react';
import { Plus } from 'lucide-react';

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  handleCreateProduct: (e: React.FormEvent) => void;
  newProdName: string;
  setNewProdName: (val: string) => void;
  newProdPrice: string;
  setNewProdPrice: (val: string) => void;
  newProdCategory: string;
  setNewProdCategory: (val: string) => void;
  newProdStock: string;
  setNewProdStock: (val: string) => void;
  newProdDesc: string;
  setNewProdDesc: (val: string) => void;
  newProdIsService: boolean;
  setNewProdIsService: (val: boolean) => void;
}

export const NewProductModal: React.FC<NewProductModalProps> = ({
  isOpen,
  onClose,
  handleCreateProduct,
  newProdName,
  setNewProdName,
  newProdPrice,
  setNewProdPrice,
  newProdCategory,
  setNewProdCategory,
  newProdStock,
  setNewProdStock,
  newProdDesc,
  setNewProdDesc,
  newProdIsService,
  setNewProdIsService
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-teal-400" />
            <span>Cadastrar Novo Item no Kyrub</span>
          </h3>
          <button 
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreateProduct} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Nome do Item</label>
              <input 
                type="text" 
                value={newProdName}
                onChange={(e) => setNewProdName(e.target.value)}
                placeholder="ex: Smart Watch G2"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-teal-500" 
                required
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Preço de Venda (B2C)</label>
              <input 
                type="number" 
                step="0.01"
                value={newProdPrice}
                onChange={(e) => setNewProdPrice(e.target.value)}
                placeholder="R$ 150.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none" 
                required
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Categoria</label>
              <select 
                value={newProdCategory}
                onChange={(e) => setNewProdCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
              >
                <option value="Eletrônicos">Eletrônicos</option>
                <option value="Moda">Moda</option>
                <option value="Serviços">Serviços</option>
                <option value="Alimentação">Alimentação</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Estoque Inicial</label>
              <input 
                type="number" 
                value={newProdStock}
                onChange={(e) => setNewProdStock(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none" 
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase mb-1.5">Descrição Curta</label>
            <textarea 
              value={newProdDesc}
              onChange={(e) => setNewProdDesc(e.target.value)}
              rows={2}
              placeholder="Descreva detalhes ou termos do produto/serviço..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none" 
            />
          </div>

          <div className="flex items-center gap-2.5 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <input 
              type="checkbox" 
              id="isService" 
              checked={newProdIsService}
              onChange={(e) => setNewProdIsService(e.target.checked)}
              className="accent-teal-500" 
            />
            <label htmlFor="isService" className="text-xs text-slate-300 cursor-pointer">Este item é um Serviço (agendável/digital)</label>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
            >
              Confirmar Cadastro
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
