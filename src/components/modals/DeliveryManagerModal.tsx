import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { db } from '../../utils/firebase';
import { deleteDoc, doc } from 'firebase/firestore';
import { DeliveryJob } from '../../types';

interface DeliveryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'employer' | 'employee';
  deliveries: DeliveryJob[];
  setDeliveries: React.Dispatch<React.SetStateAction<DeliveryJob[]>>;
  profileName: string;
  walletBalance: number;
  setWalletBalance: React.Dispatch<React.SetStateAction<number>>;
  walletHistory: any[];
  setWalletHistory: React.Dispatch<React.SetStateAction<any[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

type OperationalDeliveryJob = DeliveryJob & {
  source?: string;
  sourceOrderId?: string;
  orderStatus?: string;
};

const distanceLabel = (job: DeliveryJob): string =>
  job.distance > 0 ? `${job.distance.toFixed(1)} KM` : 'A calcular';

const paymentLabel = (job: DeliveryJob): string =>
  job.payment > 0 ? `R$ ${job.payment.toFixed(2)}` : 'A definir';

export const DeliveryManagerModal: React.FC<DeliveryManagerModalProps> = ({
  isOpen,
  onClose,
  mode,
  deliveries,
  setDeliveries,
  profileName,
  walletBalance,
  setWalletBalance,
  walletHistory,
  setWalletHistory,
  triggerToast,
}) => {
  const [deliveryModalTab, setDeliveryModalTab] = useState<'solicitar' | 'publicados' | 'historico'>('solicitar');
  const [fazerEntregasModalTab, setFazerEntregasModalTab] = useState<'solicitacoes' | 'trajeto' | 'historico'>('solicitacoes');

  const [deliveryParcelDesc, setDeliveryParcelDesc] = useState('');
  const [deliveryPickupPoint, setDeliveryPickupPoint] = useState('');
  const [deliveryDeliveryPoint, setDeliveryDeliveryPoint] = useState('');
  const [deliveryPaymentOffer, setDeliveryPaymentOffer] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'employer') {
      setDeliveryModalTab('solicitar');
      setDeliveryPaymentOffer('');
    } else {
      setFazerEntregasModalTab('solicitacoes');
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const paymentOffer = Number.parseFloat(deliveryPaymentOffer);
  const validPaymentOffer = Number.isFinite(paymentOffer) && paymentOffer > 0;

  const handleCreateDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryParcelDesc.trim() || !deliveryPickupPoint.trim() || !deliveryDeliveryPoint.trim()) {
      triggerToast('Preencha descrição, origem e destino da entrega.', 'error');
      return;
    }
    if (!validPaymentOffer) {
      triggerToast('Informe o valor real que deseja oferecer ao entregador.', 'error');
      return;
    }

    const newJob: OperationalDeliveryJob = {
      id: `del-${Date.now()}`,
      from: deliveryPickupPoint.trim(),
      to: `${deliveryDeliveryPoint.trim()} (${deliveryParcelDesc.trim()})`,
      distance: 0,
      payment: paymentOffer,
      status: 'available',
      requestedBy: profileName || 'Usuário',
      source: 'manual',
    };

    setDeliveries(previous => [newJob, ...previous]);
    setDeliveryParcelDesc('');
    setDeliveryPickupPoint('');
    setDeliveryDeliveryPoint('');
    setDeliveryPaymentOffer('');
    setDeliveryModalTab('publicados');
    triggerToast('Solicitação de entrega criada sem dados estimados fictícios.', 'success');
  };

  const handleDeleteDeliveryJob = async (id: string) => {
    setDeliveries(prev => prev.filter(job => job.id !== id));
    try {
      await deleteDoc(doc(db, 'delivery_jobs', id));
      triggerToast('Entrega excluída com sucesso!', 'success');
    } catch (e) {
      console.error('Error deleting delivery job:', e);
      triggerToast('Removido localmente.', 'info');
    }
  };

  const handleAcceptDelivery = (jobId: string) => {
    setDeliveries(prev =>
      prev.map(d => {
        if (d.id !== jobId) return d;
        triggerToast(`Entrega de ${d.from} aceita. Você já pode se deslocar até a coleta.`, 'success');
        return { ...d, status: 'accepted', acceptedBy: profileName || 'Você', updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleAdvanceDelivery = (jobId: string, nextStatus: 'delivering' | 'done') => {
    setDeliveries(prev =>
      prev.map(d => {
        if (d.id !== jobId) return d;
        const operational = d as OperationalDeliveryJob;
        if (
          nextStatus === 'delivering' &&
          operational.source === 'kyrub-order' &&
          operational.orderStatus === 'preparing'
        ) {
          triggerToast('O pedido ainda está em preparo. Aguarde a loja marcar como pronto para coletar.', 'warning');
          return d;
        }
        if (nextStatus === 'done') {
          if (d.payment > 0) {
            setWalletBalance(curr => curr + d.payment);
            setWalletHistory(currHistory => [
              { id: `tx-del-${Date.now()}`, type: 'Logística', desc: `Faturamento de entrega ID ${d.id}`, val: d.payment, date: new Date().toLocaleString('pt-BR') },
              ...currHistory
            ]);
            triggerToast(`Pacote entregue! R$ ${d.payment.toFixed(2)} adicionados à sua carteira.`, 'success');
          } else {
            triggerToast('Pacote entregue. O valor desta corrida ainda depende da cotação real.', 'success');
          }
        } else {
          triggerToast('Pacote coletado. A caminho do destino final!', 'info');
        }
        return { ...d, status: nextStatus, updatedAt: new Date().toISOString() };
      })
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" id={mode === 'employer' ? 'modal-solicitar-entrega' : 'modal-fazer-entregas'}>
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg p-6 rounded-3xl shadow-2xl relative space-y-4 max-h-[85vh] overflow-y-auto animate-scale-up text-white">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-orange-500" />
            <span>{mode === 'employer' ? 'Logística & Entregas Kyrub' : 'Painel de Entregas Kyrub'}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 w-7 h-7 rounded-full flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        {mode === 'employer' ? (
          <>
            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button type="button" onClick={() => setDeliveryModalTab('solicitar')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'solicitar' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Solicitar</button>
              <button type="button" onClick={() => setDeliveryModalTab('publicados')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'publicados' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Publicados</button>
              <button type="button" onClick={() => setDeliveryModalTab('historico')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Histórico</button>
            </div>

            {deliveryModalTab === 'solicitar' && (
              <form onSubmit={handleCreateDelivery} className="space-y-4 text-xs">
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100">
                  Este formulário é para entregas avulsas. Pedidos feitos no Kyrub Shop entram automaticamente na logística pelo KDS quando a loja escolher “Entregador Kyrub”.
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Descrição da Encomenda</label>
                    <input type="text" value={deliveryParcelDesc} onChange={e => setDeliveryParcelDesc(e.target.value)} placeholder="Descreva o que será coletado" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Ponto de Coleta (Origem)</label>
                    <input type="text" value={deliveryPickupPoint} onChange={e => setDeliveryPickupPoint(e.target.value)} placeholder="Informe o endereço de coleta" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Ponto de Entrega (Destino)</label>
                    <input type="text" value={deliveryDeliveryPoint} onChange={e => setDeliveryDeliveryPoint(e.target.value)} placeholder="Informe o endereço de entrega" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Valor oferecido ao entregador (R$)</label>
                    <input type="number" min="0.01" step="0.01" value={deliveryPaymentOffer} onChange={e => setDeliveryPaymentOffer(e.target.value)} placeholder="Informe o valor real da corrida" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500" required />
                  </div>

                  <div className="bg-slate-950 border border-slate-800 p-3 rounded-2xl space-y-2 font-mono text-[10px]">
                    <span className="text-[9px] font-bold text-slate-500 uppercase block border-b border-slate-900 pb-1">Dados da rota</span>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">Distância:</span>
                      <span className="text-slate-300 font-bold text-right">A calcular por geolocalização</span>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-900 pt-1.5 text-xs font-black">
                      <span className="text-slate-300 uppercase">Oferta ao entregador:</span>
                      <span className="text-orange-500">{validPaymentOffer ? `R$ ${paymentOffer.toFixed(2)}` : 'Informe o valor'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-800/80">
                  <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer">Fechar</button>
                  <button type="submit" className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer">Publicar Entrega</button>
                </div>
              </form>
            )}

            {deliveryModalTab === 'publicados' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status !== 'done').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Nenhuma entrega publicada ativa no momento.</div>
                ) : deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status !== 'done').map(job => (
                  <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1 min-w-0">
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">ID: {job.id}</span>
                        <h4 className="text-xs font-black text-white mt-1.5 truncate">{job.to}</h4>
                        <p className="text-[10px] text-slate-400 pt-1 font-mono">Retirada: {job.from}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-black text-orange-500 font-mono block">{paymentLabel(job)}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{distanceLabel(job)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                      <div className="text-[9px] font-mono">
                        {job.status === 'available' && <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-bold">Aguardando Entregador</span>}
                        {job.status === 'accepted' && <span className="text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold">Aceita por {job.acceptedBy || 'Entregador'}</span>}
                        {job.status === 'delivering' && <span className="text-sky-400 bg-sky-400/5 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">Em Trajeto ({job.acceptedBy})</span>}
                      </div>
                      {job.status === 'available' ? (
                        <button type="button" onClick={() => handleDeleteDeliveryJob(job.id)} className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[9px] uppercase tracking-wider transition-all cursor-pointer font-mono">Cancelar</button>
                      ) : <span className="text-[9px] text-slate-500 font-mono">Não Cancelável</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {deliveryModalTab === 'historico' && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 text-xs">
                {deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status === 'done').length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Nenhuma entrega concluída no seu histórico.</div>
                ) : deliveries.filter(d => d.requestedBy === (profileName || 'Usuário') && d.status === 'done').map(job => (
                  <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">ID: {job.id}</span>
                        <h4 className="text-xs font-black text-slate-300 uppercase truncate mt-1">{job.to}</h4>
                        <p className="text-[10px] text-slate-500 pt-1 font-mono">Retirada: {job.from}</p>
                        {job.acceptedBy && <p className="text-[9px] text-slate-400 pt-1 font-mono">Entregue por: {job.acceptedBy}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold text-slate-400 font-mono block">{paymentLabel(job)}</span>
                        <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-bold inline-block">Concluída</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-[11px] text-slate-400 leading-relaxed">Aceite oportunidades reais de entrega, desloque-se até a coleta e acompanhe o momento em que o pedido estiver pronto.</p>

            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button type="button" onClick={() => setFazerEntregasModalTab('solicitacoes')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'solicitacoes' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Solicitações</button>
              <button type="button" onClick={() => setFazerEntregasModalTab('trajeto')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'trajeto' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Em Trajeto</button>
              <button type="button" onClick={() => setFazerEntregasModalTab('historico')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Histórico</button>
            </div>

            {fazerEntregasModalTab === 'solicitacoes' && (
              <div className="space-y-3 text-xs">
                {deliveries.filter(d => d.status === 'available' && d.requestedBy !== (profileName || 'Usuário')).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Nenhuma oferta de entrega disponível no momento.</div>
                ) : deliveries.filter(d => d.status === 'available' && d.requestedBy !== (profileName || 'Usuário')).map(job => {
                  const operational = job as OperationalDeliveryJob;
                  return (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">ID: {job.id}</span>
                          <div className="text-xs text-slate-300 font-bold mt-1">De: <span className="text-white">{job.from}</span></div>
                          <div className="text-xs text-slate-300">Para: <span className="text-slate-400">{job.to}</span></div>
                          {operational.source === 'kyrub-order' && (
                            <p className="text-[9px] font-mono text-cyan-300">{operational.orderStatus === 'preparing' ? 'Pedido em preparo · você pode aceitar e se deslocar' : 'Pedido pronto para coleta'}</p>
                          )}
                          {job.requestedBy && <p className="text-[9px] text-slate-500 pt-1 font-mono">Solicitante: {job.requestedBy}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-orange-400 font-mono block">{paymentLabel(job)}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{distanceLabel(job)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                        <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold">Disponível</span>
                        <button type="button" onClick={() => handleAcceptDelivery(job.id)} className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono">Aceitar Entrega</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {fazerEntregasModalTab === 'trajeto' && (
              <div className="space-y-3 text-xs">
                {deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && d.acceptedBy === (profileName || 'Você')).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Você não possui entregas em andamento.</div>
                ) : deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && d.acceptedBy === (profileName || 'Você')).map(job => {
                  const operational = job as OperationalDeliveryJob;
                  const waitingForKitchen = job.status === 'accepted' && operational.source === 'kyrub-order' && operational.orderStatus === 'preparing';
                  return (
                    <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 hover:border-slate-800 transition-colors space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1 min-w-0">
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">ID: {job.id}</span>
                          <div className="text-xs text-slate-300 font-bold mt-1">De: <span className="text-white">{job.from}</span></div>
                          <div className="text-xs text-slate-300">Para: <span className="text-slate-400">{job.to}</span></div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-orange-400 font-mono block">{paymentLabel(job)}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{distanceLabel(job)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-slate-900/80 pt-3">
                        <div className="text-[9px] font-mono">
                          {job.status === 'accepted' ? (
                            <span className={`${waitingForKitchen ? 'text-amber-300 bg-amber-400/5 border-amber-400/20' : 'text-teal-400 bg-teal-400/5 border-teal-400/20'} border px-2 py-0.5 rounded-full font-bold`}>
                              {waitingForKitchen ? 'Pedido em preparo' : 'Pronto para coleta'}
                            </span>
                          ) : <span className="text-sky-400 bg-sky-400/5 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">A caminho do destino</span>}
                        </div>
                        <div>
                          {job.status === 'accepted' ? (
                            <button type="button" onClick={() => handleAdvanceDelivery(job.id, 'delivering')} disabled={waitingForKitchen} className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono">{waitingForKitchen ? 'Aguardar pronto' : 'Coletar Pacote'}</button>
                          ) : (
                            <button type="button" onClick={() => handleAdvanceDelivery(job.id, 'done')} className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono">Concluir Entrega</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {fazerEntregasModalTab === 'historico' && (
              <div className="space-y-3 text-xs">
                {deliveries.filter(d => d.status === 'done' && d.acceptedBy === (profileName || 'Você')).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Você ainda não concluiu nenhuma entrega.</div>
                ) : deliveries.filter(d => d.status === 'done' && d.acceptedBy === (profileName || 'Você')).map(job => (
                  <div key={job.id} className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-2">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-900 border border-slate-800 text-slate-500 rounded font-mono uppercase font-semibold">ID: {job.id}</span>
                        <h4 className="text-xs font-black text-slate-300 uppercase truncate mt-1">{job.to}</h4>
                        <p className="text-[10px] text-slate-500 pt-1 font-mono font-semibold">Retirada: {job.from}</p>
                        {job.requestedBy && <p className="text-[9px] text-slate-400 pt-1 font-mono font-semibold">Solicitante: {job.requestedBy}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold text-slate-400 font-mono block">{paymentLabel(job)}</span>
                        <span className="text-[9px] px-1.5 py-0.5 mt-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded font-mono uppercase font-bold inline-block">Concluída</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80">
              <button type="button" onClick={onClose} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-[11px] transition-all uppercase tracking-wider cursor-pointer">Voltar ao Painel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
