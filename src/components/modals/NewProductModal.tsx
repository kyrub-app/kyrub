import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import { auth } from '../../utils/firebase';
import {
  buildPublicProduct,
  PUBLIC_PRODUCT_CREATE_EVENT,
  type PublicProductCreateRequest,
} from '../../utils/publicProducts';

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
  setNewProdIsService,
}) => {
  const [imageUrl, setImageUrl] = useState('');
  const [formError, setFormError] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setNewProdName('');
      setNewProdPrice('');
      setNewProdCategory('');
      setNewProdStock('');
      setNewProdDesc('');
      setNewProdIsService(false);
      setImageUrl('');
      setFormError('');
    }

    wasOpen.current = isOpen;
  }, [
    isOpen,
    setNewProdCategory,
    setNewProdDesc,
    setNewProdIsService,
    setNewProdName,
    setNewProdPrice,
    setNewProdStock,
  ]);

  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setFormError('');

    const user = auth.currentUser;
    if (!user) {
      setFormError('Faça login novamente para cadastrar o item.');
      return;
    }

    try {
      const product = buildPublicProduct(user, {
        name: newProdName,
        description: newProdDesc,
        price: newProdPrice,
        stock: newProdStock,
        category: newProdCategory,
        image: imageUrl,
        isService: newProdIsService,
      });

      const request: PublicProductCreateRequest = {
        product,
        accepted: false,
      };

      window.dispatchEvent(
        new CustomEvent<PublicProductCreateRequest>(PUBLIC_PRODUCT_CREATE_EVENT, {
          detail: request,
        })
      );

      if (!request.accepted) {
        setFormError(
          request.reason ?? 'Não foi possível cadastrar o item nesta loja.'
        );
        return;
      }

      setNewProdName('');
      setNewProdPrice('');
      setNewProdCategory('');
      setNewProdStock('');
      setNewProdDesc('');
      setNewProdIsService(false);
      setImageUrl('');
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Revise os dados informados.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-black text-white">
            <Plus className="h-5 w-5 text-teal-400" />
            <span>Cadastrar produto ou serviço</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="font-bold text-slate-500 hover:text-slate-300"
            aria-label="Fechar cadastro"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
              Nome do item
            </label>
            <input
              type="text"
              value={newProdName}
              onChange={event => setNewProdName(event.target.value)}
              placeholder="Digite o nome"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Preço de venda
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newProdPrice}
                onChange={event => setNewProdPrice(event.target.value)}
                placeholder="0,00"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Categoria
              </label>
              <input
                type="text"
                value={newProdCategory}
                onChange={event => setNewProdCategory(event.target.value)}
                placeholder="Digite a categoria"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Estoque inicial
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={newProdIsService ? '' : newProdStock}
                onChange={event => setNewProdStock(event.target.value)}
                placeholder={newProdIsService ? 'Não se aplica' : '0'}
                disabled={newProdIsService}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
                Imagem por URL
              </label>
              <div className="relative">
                <ImagePlus className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  type="url"
                  value={imageUrl}
                  onChange={event => setImageUrl(event.target.value)}
                  placeholder="Cole uma URL, ou deixe vazio"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-10 pr-3.5 text-sm text-white focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-xs uppercase text-slate-400">
              Descrição
            </label>
            <textarea
              value={newProdDesc}
              onChange={event => setNewProdDesc(event.target.value)}
              rows={3}
              placeholder="Descreva o item com suas próprias informações"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-teal-500 focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <input
              type="checkbox"
              checked={newProdIsService}
              onChange={event => {
                setNewProdIsService(event.target.checked);
                if (event.target.checked) setNewProdStock('');
              }}
              className="accent-teal-500"
            />
            <span className="text-xs text-slate-300">
              Este item é um serviço
            </span>
          </label>

          {formError && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="flex gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-300 transition-all hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-bold text-white transition-all hover:bg-orange-500"
            >
              Cadastrar item
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
