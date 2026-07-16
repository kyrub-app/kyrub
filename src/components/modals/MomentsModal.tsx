import React, { useState } from 'react';
import { Store } from '../../types';

interface Moment {
  id: string;
  storeId: string;
  user: string;
  avatar: string;
  content: string;
  rating: number;
  mediaUrl?: string;
  createdAt: string;
  publishedToFeed: boolean;
}

interface MomentsModalProps {
  isOpen: boolean;
  selectedStoreForMoments: Store | null;
  onClose: () => void;
  momentos: Moment[];
  onPublishMoment: (newMomentData: {
    content: string;
    rating: number;
    mediaUrl: string;
    publishedToPraca: boolean;
  }) => void;
}

export const MomentsModal: React.FC<MomentsModalProps> = ({
  isOpen,
  selectedStoreForMoments,
  onClose,
  momentos,
  onPublishMoment
}) => {
  const [newMomentContent, setNewMomentContent] = useState('');
  const [newMomentRating, setNewMomentRating] = useState(5);
  const [newMomentPhoto, setNewMomentPhoto] = useState('');
  const [newMomentPublishToPraca, setNewMomentPublishToPraca] = useState(true);

  if (!isOpen || !selectedStoreForMoments) return null;

  const storeMoments = momentos.filter(m => m.storeId === selectedStoreForMoments.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMomentContent.trim()) return;

    onPublishMoment({
      content: newMomentContent,
      rating: newMomentRating,
      mediaUrl: newMomentPhoto,
      publishedToPraca: newMomentPublishToPraca
    });

    // Reset local states
    setNewMomentContent('');
    setNewMomentRating(5);
    setNewMomentPhoto('');
    setNewMomentPublishToPraca(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id="moments-modal">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-5 max-h-[85vh] overflow-y-auto animate-scale-up text-xs">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3.5">
            <img src={selectedStoreForMoments.logo} alt={selectedStoreForMoments.name} className="w-10 h-10 rounded-xl object-cover border border-slate-850" referrerPolicy="no-referrer" />
            <div>
              <span className="text-[9px] font-mono text-slate-500 uppercase font-black">Histórico de Visitas & Reviews</span>
              <h3 className="text-sm font-black text-white uppercase tracking-wide">{selectedStoreForMoments.name}</h3>
            </div>
          </div>
          <button 
            onClick={() => {
              onClose();
              setNewMomentContent('');
              setNewMomentRating(5);
              setNewMomentPhoto('');
            }}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* List Existing Moments */}
        <div className="space-y-3">
          <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">Momentos Compartilhados por Clientes</span>
          <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
            {storeMoments.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-900">
                Ainda não há avaliações de Momentos para esta loja. Publique o primeiro abaixo!
              </div>
            ) : (
              storeMoments.map(mom => (
                <div key={mom.id} className="bg-slate-950 border border-slate-850 p-3.5 rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">👤</span>
                      <div>
                        <h5 className="text-[11px] font-bold text-white uppercase">{mom.user}</h5>
                        <span className="text-[8px] font-mono text-slate-500">{mom.createdAt}</span>
                      </div>
                    </div>
                    {/* Stars */}
                    <div className="flex gap-0.5 text-[9px] text-amber-400 font-bold font-mono">
                      {'★'.repeat(mom.rating)}
                      {'☆'.repeat(5 - mom.rating)}
                    </div>
                  </div>

                  <p className="text-slate-300 text-xs leading-relaxed">{mom.content}</p>

                  {/* Optional Attached Moment Image */}
                  {mom.mediaUrl && (
                    <div className="relative rounded-xl overflow-hidden max-h-36 border border-slate-900 bg-slate-900/60">
                      <img src={mom.mediaUrl} alt="Oferta Relacionada" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}

                  {mom.publishedToFeed && (
                    <div className="flex items-center gap-1.5 text-[8px] font-mono text-orange-400 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                      <span>Sincronizado na Praça Local</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Write a New Moment Form */}
        <form onSubmit={handleSubmit} className="bg-slate-950 border border-slate-850 p-4 rounded-2xl space-y-4">
          <h4 className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">Publicar Meu Momento / Review</h4>

          <div className="space-y-3">
            {/* Text Content */}
            <div className="space-y-1">
              <label className="text-[9px] text-slate-500 font-mono uppercase">O que você achou das ofertas ou da visita?</label>
              <textarea
                value={newMomentContent}
                onChange={(e) => setNewMomentContent(e.target.value)}
                placeholder="Ex: Excelente atendimento! Comprei as ferramentas em oferta e ganhei desconto no PIX."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                rows={2.5}
                required
              />
            </div>

            {/* Rating (Stars Selector) */}
            <div className="flex items-center justify-between border-b border-slate-900 pb-2.5">
              <span className="text-[9px] text-slate-400 font-mono uppercase">Sua Nota de Avaliação:</span>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setNewMomentRating(star)}
                    className={`text-base cursor-pointer hover:scale-125 transition-transform ${
                      star <= newMomentRating ? 'text-amber-400' : 'text-slate-700'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            {/* Simulated Photo attachment selector */}
            <div className="space-y-1.5">
              <span className="text-[9px] text-slate-400 font-mono uppercase block">Vincular Foto da Vitrine da Loja:</span>
              <div className="grid grid-cols-4 gap-2">
                {selectedStoreForMoments.offerImages && selectedStoreForMoments.offerImages.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setNewMomentPhoto(newMomentPhoto === img ? '' : img)}
                    className={`relative rounded-lg overflow-hidden h-12 border-2 transition-all cursor-pointer ${
                      newMomentPhoto === img 
                        ? 'border-orange-500 scale-95 shadow-md shadow-orange-500/20' 
                        : 'border-transparent hover:border-slate-800'
                    }`}
                  >
                    <img src={img} alt="vitrine template" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            </div>

            {/* Cross-Post Switch Toggle */}
            <div className="flex items-center justify-between p-2.5 bg-slate-900/55 rounded-xl border border-slate-900/80 mt-2">
              <div className="space-y-0.5">
                <span className="text-[9px] font-mono text-slate-300 uppercase block">Compartilhar na Praça Social</span>
                <p className="text-[8px] text-slate-500">Publicará este momento automaticamente no feed geral da Praça.</p>
              </div>
              <button
                type="button"
                onClick={() => setNewMomentPublishToPraca(!newMomentPublishToPraca)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  newMomentPublishToPraca ? 'bg-orange-500' : 'bg-slate-850'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                    newMomentPublishToPraca ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Publish Button */}
          <button
            type="submit"
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
          >
            Publicar Momento
          </button>
        </form>
      </div>
    </div>
  );
};
