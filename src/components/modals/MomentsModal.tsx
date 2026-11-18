import React, { useEffect, useState } from 'react';
import { subscribeStoreReviews, subscribeStoreReviewLikeCounts, type CanonicalStoreReview } from '../../utils/storeReviews';
import { submitStoreReviewReport } from '../../utils/storeReviewReports';
import { auth } from '../../utils/firebase';
import type { SocialReportReason } from '../../utils/socialReports';
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
  }) => Promise<void>;
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
  const [reviews, setReviews] = useState<CanonicalStoreReview[]>([]);
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reportReviewId, setReportReviewId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<SocialReportReason>('spam');
  const [reportPending, setReportPending] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [reportError, setReportError] = useState('');
  const storeId = selectedStoreForMoments?.id ?? '';
  const reviewPostIds = reviews.filter(review => review.publishedToFeed).map(review => review.postId).join('|');

  useEffect(() => {
    if (!isOpen || !storeId) return;
    setReviews([]);
    setLikeCounts({});
    setLoadingReviews(true);
    setReviewError('');
    return subscribeStoreReviews(storeId,
      next => { setReviews(next); setLoadingReviews(false); },
      error => {
        console.warn('Falha ao carregar avaliações.', error);
        setReviewError('Não foi possível carregar as avaliações desta loja.');
        setLoadingReviews(false);
      },
    );
  }, [isOpen, storeId]);

  useEffect(() => {
    if (!isOpen || !reviewPostIds) { setLikeCounts({}); return; }
    return subscribeStoreReviewLikeCounts(reviewPostIds.split('|'), setLikeCounts,
      error => console.warn('Falha ao acompanhar curtidas das avaliações.', error));
  }, [isOpen, reviewPostIds]);

  if (!isOpen || !selectedStoreForMoments) return null;

  const legacyMoments = momentos.filter(m => m.storeId === storeId);
  const storeMoments = reviews.map(review => ({
    ...review, user: review.authorName,
    createdAt: review.createdAtIso ? new Date(review.createdAtIso).toLocaleString('pt-BR') : '',
  }));

  const handleReport = async (reviewId: string) => {
    if (reportPending) return;
    setReportPending(true);
    setReportError('');
    setReportMessage('');
    try {
      const outcome = await submitStoreReviewReport(storeId, reviewId, reportReason);
      setReportMessage(outcome === 'already_reported'
        ? 'Você já denunciou esta avaliação.'
        : 'Denúncia encaminhada à moderação do Kyrub.');
      setReportReviewId(null);
    } catch (error) {
      console.warn('Não foi possível encaminhar a denúncia de avaliação.', error);
      setReportError('A denúncia não foi enviada. Confira sua conexão e tente novamente.');
    } finally {
      setReportPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !newMomentContent.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onPublishMoment({
        content: newMomentContent, rating: newMomentRating,
        mediaUrl: newMomentPhoto, publishedToPraca: newMomentPublishToPraca,
      });
      setNewMomentContent('');
      setNewMomentRating(5);
      setNewMomentPhoto('');
      setNewMomentPublishToPraca(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível enviar sua avaliação.');
    } finally { setSubmitting(false); }
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
          <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">Avaliações sincronizadas de clientes</span>
          <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
            {loadingReviews && <p className="p-3 text-xs text-slate-400">Carregando avaliações...</p>}
            {reviewError && <p className="p-3 text-xs text-red-300" role="alert">{reviewError}</p>}
            {reportMessage && <p className="p-3 text-xs text-emerald-300" role="status">{reportMessage}</p>}
            {reportError && <p className="p-3 text-xs text-red-300" role="alert">{reportError}</p>}
            {!loadingReviews && storeMoments.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-900">
                Ainda não há avaliações sincronizadas para esta loja. Publique a primeira abaixo!
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

                  {mom.authorId !== auth.currentUser?.uid && (
                    <div className="border-t border-slate-800 pt-2">
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-amber-300 hover:text-amber-200"
                        onClick={() => {
                          setReportReviewId(current => current === mom.id ? null : mom.id);
                          setReportReason('spam');
                          setReportError('');
                          setReportMessage('');
                        }}
                        aria-expanded={reportReviewId === mom.id}
                        aria-label={`Denunciar avaliação de ${mom.user}`}
                      >
                        Denunciar avaliação
                      </button>
                      {reportReviewId === mom.id && (
                        <div className="mt-2 space-y-2 rounded-lg border border-amber-500/20 p-2" role="group" aria-label="Motivo da denúncia de avaliação">
                          <label htmlFor={`review-report-reason-${mom.id}`} className="block text-[10px] text-slate-300">Por qual motivo?</label>
                          <select
                            id={`review-report-reason-${mom.id}`}
                            value={reportReason}
                            onChange={event => setReportReason(event.target.value as SocialReportReason)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100"
                          >
                            <option value="spam">Spam ou propaganda abusiva</option>
                            <option value="abuse">Ofensa, ameaça ou assédio</option>
                            <option value="fraud">Fraude ou informação enganosa</option>
                            <option value="unsafe">Conteúdo perigoso ou inadequado</option>
                            <option value="other">Outro motivo</option>
                          </select>
                          <div className="flex gap-2">
                            <button type="button" disabled={reportPending}
                              className="rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-semibold text-slate-950 disabled:opacity-50"
                              onClick={() => void handleReport(mom.id)}>
                              {reportPending ? 'Enviando…' : 'Enviar denúncia'}
                            </button>
                            <button type="button" disabled={reportPending} className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] text-slate-300" onClick={() => setReportReviewId(null)}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {mom.publishedToFeed && (
                    <div className="flex items-center gap-1.5 text-[8px] font-mono text-orange-400 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                      <span>Compartilhado na Praça · {likeCounts[mom.postId] ?? 0} curtidas</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {legacyMoments.length > 0 && (
            <details className="rounded-xl border border-slate-700 p-3">
              <summary className="cursor-pointer text-[10px] font-semibold text-slate-300">
                Histórico antigo deste dispositivo ({legacyMoments.length})
              </summary>
              <p className="mt-2 text-[10px] text-amber-300">
                Estes registros foram salvos apenas neste navegador. Não estão publicados no banco de avaliações ou na Praça.
              </p>
              {legacyMoments.map(item => (
                <p className="mt-2 whitespace-pre-wrap text-[10px] text-slate-400" key={item.id}>
                  {item.user} · {item.rating}/5 · {item.content}
                </p>
              ))}
            </details>
          )}
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
          {submitError && <p className="text-xs text-red-300" role="alert">{submitError}</p>}
          <p className="text-[9px] text-slate-500">Uma avaliação por Kairubido e por loja. Não identificamos compra verificada neste formulário; nenhum XP ou Pitanga é concedido por esta ação.</p>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
          >
            {submitting ? 'Enviando avaliação...' : 'Publicar avaliação'}
          </button>
        </form>
      </div>
    </div>
  );
};
