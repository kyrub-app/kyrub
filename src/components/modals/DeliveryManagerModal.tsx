import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import {
  classifyKyrubDeliveryOrderCargo,
  updateKyrubDeliveryOpportunityStatus,
} from '../../utils/deliveryOpportunities';
import { IDENTITY_VERIFICATION_COLLECTION } from '../../utils/identityVerification';
import {
  assessDeliveryCargo,
  courierVehicleDocumentEligibility,
  type CourierCargoKind,
  type CourierVehicleType,
  type DeliveryCargo,
} from '../../../shared/deliveryVehicleCompatibility';
import { isAvailableCourierOffer, isAssignedCourierDelivery, isCanonicalCourierDelivery } from '../../utils/courierDeliveryView';
import { DeliveryJob } from '../../types';
import { openGoogleMapsDirections } from '../../utils/googleMapsDirections';

interface DeliveryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'employer' | 'employee';
  deliveries: DeliveryJob[];
  setDeliveries: React.Dispatch<React.SetStateAction<DeliveryJob[]>>;
  profileName: string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

type OperationalDeliveryJob = DeliveryJob & {
  source?: string;
  sourceOrderId?: string;
  orderStatus?: string;
  acceptedByName?: string;
};

const distanceLabel = (job: DeliveryJob): string =>
  job.distance > 0 ? `${job.distance.toFixed(1)} KM` : 'A calcular';

const paymentLabel = (job: DeliveryJob): string =>
  job.payment > 0 ? `R$ ${job.payment.toFixed(2)}` : 'A definir';

const VEHICLE_LABELS: Record<CourierVehicleType, string> = {
  bicycle: 'Bicicleta', motorcycle: 'Moto', car: 'Carro',
};

type SellerCargoOrder = {
  id: string;
  status: string;
  itemsCount: number;
  cargo: DeliveryCargo | null;
};

type CargoDraft = {
  kind: CourierCargoKind;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

const EMPTY_CARGO: CargoDraft = {
  kind: 'parcel', weightKg: '', lengthCm: '', widthCm: '', heightCm: '',
};

export const DeliveryManagerModal: React.FC<DeliveryManagerModalProps> = ({
  isOpen,
  onClose,
  mode,
  deliveries,
  setDeliveries,
  profileName,
  triggerToast,
}) => {
  const [deliveryModalTab, setDeliveryModalTab] = useState<'classificar' | 'solicitar' | 'publicados' | 'historico'>('classificar');
  const [fazerEntregasModalTab, setFazerEntregasModalTab] = useState<'solicitacoes' | 'trajeto' | 'historico'>('solicitacoes');

  const [deliveryParcelDesc, setDeliveryParcelDesc] = useState('');
  const [deliveryPickupPoint, setDeliveryPickupPoint] = useState('');
  const [deliveryDeliveryPoint, setDeliveryDeliveryPoint] = useState('');
  const [deliveryPaymentOffer, setDeliveryPaymentOffer] = useState('');
  const [acceptingDeliveryId, setAcceptingDeliveryId] = useState<string | null>(null);
  const [selectedVehicleType, setSelectedVehicleType] = useState<CourierVehicleType>('bicycle');
  const [courierIdentity, setCourierIdentity] = useState<Record<string, unknown> | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [sellerCargoOrders, setSellerCargoOrders] = useState<SellerCargoOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [cargoDraft, setCargoDraft] = useState<CargoDraft>(EMPTY_CARGO);
  const [cargoSaving, setCargoSaving] = useState(false);

  // Only the signed-in store sees its own ERP orders. No buyer address is used.
  useEffect(() => {
    if (!isOpen || mode !== 'employer') return;
    let unsubscribeOrders = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeOrders();
      unsubscribeOrders = () => undefined;
      setSellerCargoOrders([]);
      if (!user) return;
      unsubscribeOrders = onSnapshot(
        collection(db, `artifacts/${user.uid}/public/data/customerOrders`),
        snapshot => {
          const orders = snapshot.docs.flatMap(snapshotOrder => {
            const data = snapshotOrder.data() as Record<string, unknown>;
            if (data.fulfillmentType !== 'delivery' || data.deliveryProvider !== 'kyrub'
              || !['preparing', 'ready', 'out_for_delivery'].includes(String(data.status))) return [];
            return [{
              id: snapshotOrder.id,
              status: String(data.status),
              itemsCount: Array.isArray(data.items) ? data.items.length : 0,
              cargo: assessDeliveryCargo(data.deliveryCargo).cargo,
            } satisfies SellerCargoOrder];
          });
          setSellerCargoOrders(orders);
        },
        error => {
          console.warn('Não foi possível consultar pedidos próprios para classificar carga.', error);
          setSellerCargoOrders([]);
        }
      );
    });
    return () => { unsubscribeAuth(); unsubscribeOrders(); };
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen || mode !== 'employee') return;
    let unsubscribeIdentity = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeIdentity();
      unsubscribeIdentity = () => undefined;
      setCourierIdentity(null);
      setIdentityLoaded(false);
      if (!user) { setIdentityLoaded(true); return; }
      unsubscribeIdentity = onSnapshot(
        doc(db, IDENTITY_VERIFICATION_COLLECTION, user.uid),
        snapshot => {
          setCourierIdentity(snapshot.exists()
            ? snapshot.data() as Record<string, unknown>
            : null);
          setIdentityLoaded(true);
        },
        () => { setCourierIdentity(null); setIdentityLoaded(true); }
      );
    });
    return () => { unsubscribeAuth(); unsubscribeIdentity(); };
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'employer') {
      setDeliveryModalTab('classificar');
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
    triggerToast('Rascunho criado nesta tela, sem publicação. Pedidos reais são publicados pelo ERP.', 'info');
  };

  const handleDeleteDeliveryJob = (id: string) => {
    const job = deliveries.find(delivery => delivery.id === id);
    if (!job) return;
    if (isCanonicalCourierDelivery(job)) {
      triggerToast('Pedidos reais devem ser cancelados pelo fluxo oficial do ERP.', 'warning');
      return;
    }
    setDeliveries(prev => prev.filter(delivery => delivery.id !== id));
    triggerToast('Rascunho local removido.', 'info');
  };

  const selectCargoOrder = (order: SellerCargoOrder) => {
    setSelectedOrderId(order.id);
    const cargo = order.cargo;
    setCargoDraft(cargo
      ? {
          kind: cargo.kind,
          weightKg: String(cargo.weightKg),
          lengthCm: String(cargo.lengthCm),
          widthCm: String(cargo.widthCm),
          heightCm: String(cargo.heightCm),
        }
      : EMPTY_CARGO);
  };

  const handleClassifyCargo = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user || !selectedOrderId || cargoSaving) return;
    const cargo: DeliveryCargo = {
      kind: cargoDraft.kind,
      weightKg: Number(cargoDraft.weightKg),
      lengthCm: Number(cargoDraft.lengthCm),
      widthCm: Number(cargoDraft.widthCm),
      heightCm: Number(cargoDraft.heightCm),
      requiresSpecialHandling: false,
    };
    const assessed = assessDeliveryCargo(cargo);
    if (!assessed.ready) {
      triggerToast(assessed.reason, 'warning');
      return;
    }
    setCargoSaving(true);
    try {
      const result = await classifyKyrubDeliveryOrderCargo(selectedOrderId, cargo, user);
      triggerToast(`Carga classificada. Modalidades compatíveis: ${result.allowedVehicles.map(vehicle => VEHICLE_LABELS[vehicle]).join(', ')}.`, 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Falha ao classificar carga.', 'error');
    } finally {
      setCargoSaving(false);
    }
  };

  const handleAcceptDelivery = async (job: DeliveryJob): Promise<void> => {
    if (!isAvailableCourierOffer(job) || acceptingDeliveryId) return;
    const user = auth.currentUser;
    if (!user) {
      triggerToast('Faça login para aceitar uma entrega.', 'warning');
      return;
    }
    const vehicleEligibility = courierVehicleDocumentEligibility(courierIdentity ?? undefined, selectedVehicleType);
    const cargoAssessment = assessDeliveryCargo(job.cargo);
    if (!vehicleEligibility.eligible) {
      triggerToast(vehicleEligibility.reason, 'warning');
      return;
    }
    if (!cargoAssessment.ready || job.cargoReady !== true || !cargoAssessment.allowedVehicles.includes(selectedVehicleType)) {
      triggerToast('A carga ainda não está classificada ou não cabe no veículo escolhido.', 'warning');
      return;
    }
    if (job.payment <= 0) {
      triggerToast('A remuneração precisa estar definida antes do aceite.', 'warning');
      return;
    }
    setAcceptingDeliveryId(job.id);
    try {
      // Server rechecks cargo and approved documents atomically; this UI is only a preview.
      await updateKyrubDeliveryOpportunityStatus(job.id, 'accepted', user, selectedVehicleType);
      setFazerEntregasModalTab('trajeto');
      triggerToast('Aceite confirmado pelo servidor. Ative o GPS para acompanhar.', 'success');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível confirmar o aceite.', 'error');
    } finally {
      setAcceptingDeliveryId(null);
    }
  };

  const handleStartPickup = (job: DeliveryJob): void => {
    try {
      openGoogleMapsDirections({
        destination: job.from,
        travelMode: (job.vehicleType ?? selectedVehicleType) === 'bicycle' ? 'bicycling' : 'driving',
      });
      triggerToast('Google Maps aberto com a rota para o ponto de coleta.', 'info');
    } catch (error) {
      triggerToast(
        error instanceof Error ? error.message : 'Não foi possível abrir a rota para a coleta.',
        'error'
      );
    }
  };

  const handleAdvanceDelivery = (jobId: string, nextStatus: 'delivering' | 'done') => {
    const job = deliveries.find(delivery => delivery.id === jobId);
    if (job && isCanonicalCourierDelivery(job)) {
      triggerToast('Entregas do ERP são concluídas após registrar a chegada e obter confirmação do comprador.', 'warning');
      return;
    }
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
          triggerToast(
            d.payment > 0
              ? `Pacote entregue. O valor de R$ ${d.payment.toFixed(2)} permanece pendente de liquidação real.`
              : 'Pacote entregue. O valor desta corrida ainda depende da cotação real.',
            'success'
          );
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
              <button type="button" onClick={() => setDeliveryModalTab('publicados')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'publicados' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Meus registros</button>
              <button type="button" onClick={() => setDeliveryModalTab('historico')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Histórico</button>
              <button type="button" onClick={() => setDeliveryModalTab('classificar')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${deliveryModalTab === 'classificar' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Pedidos ERP</button>
            </div>

            {deliveryModalTab === 'classificar' && (
              <section className="space-y-3 text-xs">
                <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] text-cyan-100">
                  Classifique os pedidos reais da sua loja antes de oferecer a entrega. A autorização do veículo é verificada no servidor; cargas especiais e transportes de passageiros não são atendidos.
                </p>
                {sellerCargoOrders.length === 0 ? (
                  <p className="rounded-xl bg-slate-950 p-4 text-[10px] text-slate-400">
                    Nenhum pedido do ERP aguardando logística Kyrub nesta conta.
                  </p>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {sellerCargoOrders.map(order => (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => selectCargoOrder(order)}
                        className={`w-full rounded-xl border p-2 text-left text-[9px] ${selectedOrderId === order.id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-700 bg-slate-950'}`}
                      >
                        Pedido {order.id.slice(0, 16)} · {order.itemsCount} item(ns) · {
                          order.cargo ? 'Carga informada' : 'Pendente de classificação'
                        }
                      </button>
                    ))}
                  </div>
                )}
                {selectedOrderId && (
                  <form onSubmit={event => void handleClassifyCargo(event)} className="space-y-3 rounded-xl bg-slate-950 p-3">
                    <label className="block text-[10px] text-slate-300">
                      Tipo de carga
                      <select
                        value={cargoDraft.kind}
                        onChange={event => setCargoDraft(previous => ({...previous, kind: event.target.value as CourierCargoKind}))}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-2"
                      >
                        <option value="food">Comida / alimento</option>
                        <option value="parcel">Objeto / encomenda</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['weightKg','lengthCm','widthCm','heightCm'] as const).map(field => (
                        <label key={field} className="text-[9px] text-slate-300">
                          {{weightKg:'Peso (kg)',lengthCm:'Comprimento (cm)',widthCm:'Largura (cm)',heightCm:'Altura (cm)'}[field]}
                          <input
                            type="number"
                            required
                            min="0.01"
                            step="0.01"
                            value={cargoDraft[field]}
                            onChange={event => setCargoDraft(previous => ({ ...previous, [field]: event.target.value }))}
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-white"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-[9px] text-slate-500">
                      Informe peso e medidas do pacote embalado. Limites são operacionais do piloto, não certificação legal do veículo.
                    </p>
                    <button type="submit" disabled={cargoSaving} className="w-full rounded-xl bg-teal-500 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50">
                      {cargoSaving ? 'Classificando...' : 'Salvar classificação no ERP'}
                    </button>
                  </form>
                )}
              </section>
            )}

            {deliveryModalTab === 'solicitar' && (
              <form onSubmit={handleCreateDelivery} className="space-y-4 text-xs">
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[10px] leading-relaxed text-cyan-100">
                  Este formulário salva apenas um rascunho neste dispositivo, não publica ofertas para entregadores. Os pedidos reais entram na logística pelo ERP quando a loja escolhe “Entregador Kyrub”.
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
                  <button type="submit" className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all uppercase tracking-wider cursor-pointer">Salvar rascunho</button>
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
                        {job.status === 'available' && <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-bold">{isCanonicalCourierDelivery(job) ? 'Aguardando entregador' : 'Rascunho local · não publicado'}</span>}
                        {job.status === 'accepted' && <span className="text-teal-400 bg-teal-400/5 border border-teal-400/20 px-2 py-0.5 rounded-full font-bold">Aceita por {(job as OperationalDeliveryJob).acceptedByName || job.acceptedBy || 'Entregador'}</span>}
                        {job.status === 'delivering' && <span className="text-sky-400 bg-sky-400/5 border border-sky-400/20 px-2 py-0.5 rounded-full font-bold">Em trajeto ({(job as OperationalDeliveryJob).acceptedByName || job.acceptedBy})</span>}
                      </div>
                      {job.status === 'available' && !isCanonicalCourierDelivery(job) ? (
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
            <p className="text-[11px] text-slate-400 leading-relaxed">Consulte as ofertas, escolha seu veículo habilitado e aceite apenas cargas compatíveis. O servidor confirma a autorização antes de atribuir o pedido.</p>
            <label className="block space-y-1 text-[10px] text-slate-300">
              Veículo utilizado nesta entrega
              <select
                value={selectedVehicleType}
                onChange={event => setSelectedVehicleType(event.target.value as CourierVehicleType)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="bicycle">Bicicleta</option>
                <option value="motorcycle">Moto</option>
                <option value="car">Carro</option>
              </select>
            </label>
            <p className="text-[9px] text-slate-500">
              {identityLoaded
                ? courierVehicleDocumentEligibility(courierIdentity ?? undefined, selectedVehicleType).eligible
                  ? 'Modalidade documental aprovada; o pedido ainda depende da capacidade do veículo.'
                  : courierVehicleDocumentEligibility(courierIdentity ?? undefined, selectedVehicleType).reason
                : 'Consultando sua habilitação privada...'}
            </p>

            <div className="flex border-b border-slate-800 text-[10px] font-bold font-mono">
              <button type="button" onClick={() => setFazerEntregasModalTab('solicitacoes')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'solicitacoes' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Solicitações</button>
              <button type="button" onClick={() => setFazerEntregasModalTab('trajeto')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'trajeto' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Em Trajeto</button>
              <button type="button" onClick={() => setFazerEntregasModalTab('historico')} className={`flex-1 pb-2 border-b-2 transition-all uppercase tracking-wider ${fazerEntregasModalTab === 'historico' ? 'border-orange-500 text-orange-500' : 'border-transparent text-slate-500 hover:text-slate-400'}`}>Histórico</button>
            </div>

            {fazerEntregasModalTab === 'solicitacoes' && (
              <div className="space-y-3 text-xs">
                {deliveries.filter(isAvailableCourierOffer).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Nenhuma oferta de entrega disponível no momento.</div>
                ) : deliveries.filter(isAvailableCourierOffer).map(job => {
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
                          {job.cargoReady && job.cargo ? (
                            <p className="text-[9px] text-slate-400">
                              {job.cargo.kind === 'food' ? 'Alimento' : 'Objeto'} · {job.cargo.weightKg} kg · {job.cargo.lengthCm} × {job.cargo.widthCm} × {job.cargo.heightCm} cm
                            </p>
                          ) : (
                            <p className="text-[9px] text-amber-300">Aguardando classificação da carga pelo lojista.</p>
                          )}
                          {job.cargoReady && (
                            <p className="text-[9px] text-cyan-300">
                              Compatível com: {(job.allowedVehicles ?? []).map(vehicle => VEHICLE_LABELS[vehicle]).join(', ') || 'Nenhum veículo'}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-orange-400 font-mono block">{paymentLabel(job)}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{distanceLabel(job)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-900/80 pt-3">
                        <span className="text-orange-400 bg-orange-400/5 border border-orange-400/20 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold">Disponível</span>
                        <button type="button" onClick={() => void handleAcceptDelivery(job)} disabled={acceptingDeliveryId !== null || !identityLoaded || !courierVehicleDocumentEligibility(courierIdentity ?? undefined, selectedVehicleType).eligible || job.cargoReady !== true || !(job.allowedVehicles ?? []).includes(selectedVehicleType) || job.payment <= 0} className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono disabled:cursor-wait disabled:opacity-60">{acceptingDeliveryId === job.id ? 'Confirmando...' : 'Aceitar Entrega'}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {fazerEntregasModalTab === 'trajeto' && (
              <div className="space-y-3 text-xs">
                {deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && isAssignedCourierDelivery(d, auth.currentUser?.uid)).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Você não possui entregas em andamento.</div>
                ) : deliveries.filter(d => (d.status === 'accepted' || d.status === 'delivering') && isAssignedCourierDelivery(d, auth.currentUser?.uid)).map(job => {
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
                            operational.source === 'kyrub-order' ? (
                              <button type="button" onClick={() => handleStartPickup(job)} className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono">Iniciar coleta</button>
                            ) : (
                              <button type="button" onClick={() => handleAdvanceDelivery(job.id, 'delivering')} disabled={waitingForKitchen} className="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer font-mono">{waitingForKitchen ? 'Aguardar pronto' : 'Coletar Pacote'}</button>
                            )
                          ) : isCanonicalCourierDelivery(job) ? (
                            <span className="max-w-[12rem] text-right text-[9px] leading-relaxed text-cyan-300">Confirme a chegada no painel de rastreio. A entrega só termina após confirmação do cliente.</span>
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
                {deliveries.filter(d => d.status === 'done' && isAssignedCourierDelivery(d, auth.currentUser?.uid)).length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs italic bg-slate-950 rounded-2xl border border-slate-850">Você ainda não concluiu nenhuma entrega.</div>
                ) : deliveries.filter(d => d.status === 'done' && isAssignedCourierDelivery(d, auth.currentUser?.uid)).map(job => (
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
