import React, { useState } from 'react';
import { Store as StoreIcon } from 'lucide-react';

interface StoreConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  configStoreName: string;
  setConfigStoreName: (val: string) => void;
  configStoreBio: string;
  setConfigStoreBio: (val: string) => void;
  configStoreAddress: string;
  setConfigStoreAddress: (val: string) => void;
  configStoreContact: string;
  setConfigStoreContact: (val: string) => void;
  configStoreKeywords: string;
  setConfigStoreKeywords: (val: string) => void;
  newAtendimentoSpace: string;
  setNewAtendimentoSpace: (val: string) => void;
  handleAddAtendimentoSpace: () => void;
  atendimentoSpaces: string[];
  handleRemoveAtendimentoSpace: (space: string) => void;
  newProducaoSpace: string;
  setNewProducaoSpace: (val: string) => void;
  handleAddProducaoSpace: () => void;
  producaoSpaces: string[];
  handleRemoveProducaoSpace: (space: string) => void;
  handleSaveStoreProfile: () => void;
}

export const StoreConfigModal: React.FC<StoreConfigModalProps> = ({
  isOpen,
  onClose,
  configStoreName,
  setConfigStoreName,
  configStoreBio,
  setConfigStoreBio,
  configStoreAddress,
  setConfigStoreAddress,
  configStoreContact,
  setConfigStoreContact,
  configStoreKeywords,
  setConfigStoreKeywords,
  newAtendimentoSpace,
  setNewAtendimentoSpace,
  handleAddAtendimentoSpace,
  atendimentoSpaces,
  handleRemoveAtendimentoSpace,
  newProducaoSpace,
  setNewProducaoSpace,
  handleAddProducaoSpace,
  producaoSpaces,
  handleRemoveProducaoSpace,
  handleSaveStoreProfile
}) => {
  const [configActiveTab, setConfigActiveTab] = useState<'perfil' | 'ambiente'>('perfil');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans animate-fade-in my-8">
        {/* Header */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-850 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-orange-500 flex items-center justify-center">
              <StoreIcon className="w-3.5 h-3.5 text-slate-950" />
            </div>
            <h3 className="text-xs font-black text-white uppercase tracking-wider">Configurações da Loja</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white font-bold bg-slate-900 border border-slate-800 w-6 h-6 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Tabs Selector */}
        <div className="flex border-b border-slate-850 bg-slate-950/50">
          <button
            onClick={() => setConfigActiveTab('perfil')}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              configActiveTab === 'perfil'
                ? 'border-orange-500 text-white bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Perfil
          </button>
          <button
            onClick={() => setConfigActiveTab('ambiente')}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
              configActiveTab === 'ambiente'
                ? 'border-orange-500 text-white bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            Ambiente
          </button>
        </div>

        {/* Content Container */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-5">
          {configActiveTab === 'perfil' ? (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Nome da Loja</label>
                <input
                  type="text"
                  value={configStoreName}
                  onChange={(e) => setConfigStoreName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                  placeholder="Nome Fantasia..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Biografia (Descrição)</label>
                <textarea
                  value={configStoreBio}
                  onChange={(e) => setConfigStoreBio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750 h-20 resize-none"
                  placeholder="Fale brevemente sobre o seu negócio..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Endereço</label>
                <input
                  type="text"
                  value={configStoreAddress}
                  onChange={(e) => setConfigStoreAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                  placeholder="Rua, número, bairro..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Contato</label>
                <input
                  type="text"
                  value={configStoreContact}
                  onChange={(e) => setConfigStoreContact(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                  placeholder="(DD) 99999-9999..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-black">Palavras-chave de SEO Local (Separadas por vírgula)</label>
                <input
                  type="text"
                  value={configStoreKeywords}
                  onChange={(e) => setConfigStoreKeywords(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-750"
                  placeholder="pizza, bar, lanches, entrega rapida..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-fade-in">
              {/* Atendimento Spaces */}
              <div className="space-y-3 bg-slate-950/40 border border-slate-850 p-4 rounded-2xl">
                <h4 className="text-[10px] font-mono text-orange-400 uppercase font-black">Espaços de Atendimento</h4>
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newAtendimentoSpace}
                    onChange={(e) => setNewAtendimentoSpace(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAtendimentoSpace()}
                    className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none uppercase"
                    placeholder="Novo espaço (ex: MESA 5)..."
                  />
                  <button
                    onClick={handleAddAtendimentoSpace}
                    className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs uppercase cursor-pointer"
                  >
                    + Adicionar
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2">
                  {atendimentoSpaces.map(space => (
                    <span key={space} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-[10px] text-slate-300 px-2.5 py-1 rounded-full font-bold">
                      {space}
                      <button
                        onClick={() => handleRemoveAtendimentoSpace(space)}
                        className="text-red-400 hover:text-red-300 ml-1 font-bold font-mono focus:outline-none text-xs"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Producao Spaces */}
              <div className="space-y-3 bg-slate-950/40 border border-slate-850 p-4 rounded-2xl">
                <h4 className="text-[10px] font-mono text-teal-400 uppercase font-black">Espaços de Produção</h4>
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProducaoSpace}
                    onChange={(e) => setNewProducaoSpace(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddProducaoSpace()}
                    className="flex-1 bg-slate-950 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none uppercase"
                    placeholder="Novo espaço (ex: SALADAS)..."
                  />
                  <button
                    onClick={handleAddProducaoSpace}
                    className="bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs uppercase cursor-pointer"
                  >
                    + Adicionar
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2">
                  {producaoSpaces.map(space => (
                    <span key={space} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-[10px] text-slate-300 px-2.5 py-1 rounded-full font-bold">
                      {space}
                      <button
                        onClick={() => handleRemoveProducaoSpace(space)}
                        className="text-red-400 hover:text-red-300 ml-1 font-bold font-mono focus:outline-none text-xs"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 px-6 py-4 border-t border-slate-850 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-850 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs uppercase cursor-pointer"
          >
            Fechar
          </button>
          {configActiveTab === 'perfil' && (
            <button
              onClick={handleSaveStoreProfile}
              className="bg-orange-500 hover:bg-orange-600 text-slate-950 font-black px-5 py-2 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
            >
              Salvar Alterações
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
