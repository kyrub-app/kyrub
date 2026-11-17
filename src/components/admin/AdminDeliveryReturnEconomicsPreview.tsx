import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { DeliveryReturnEconomicPreview } from '../../../shared/deliveryReturnEconomicPolicy';
import { AdminDeliveryReturnLiabilityPanel } from './AdminDeliveryReturnLiabilityPanel';

const LABELS = {
  original_route: 'Entrega original',
  authorized_return: 'Retorno autorizado',
  additional_waiting: 'Espera adicional',
  buyer_refund: 'Reembolso do comprador — conta separada',
};
const STATUS_LABELS = {
  captured_pending_review: 'Fonte financeira localizada; sob revisão',
  captured_zero_requires_review: 'Valor zero na fonte; revisão necessária',
  authority_unavailable: 'Valor oficial ainda não comprovado',
  contract_terms_required: 'Aguardando distância e tarifa contratual',
  waiting_evidence_and_terms_required: 'Aguardando evidências e tarifa de espera',
  consumer_rights_review_required: 'Análise separada dos direitos do comprador',
  quoted_pending_independent_review: 'Prévia tarifária contratada — revisão independente obrigatória',
};
const money = (value: number | null) =>
  value === null ? 'Não apurado' : (value / 100).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
  });

export function AdminDeliveryReturnEconomicsPreview({
  user, deliveryId,
}: { user: User; deliveryId: string }) {
  const [data, setData] = useState<DeliveryReturnEconomicPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [routeBusy,setRouteBusy]=useState(false);
  const [routeMessage,setRouteMessage]=useState('');
  const inspect = async () => {
    if (busy) return;
    setBusy(true); setError(''); setData(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        '/api/delivery-opportunities/admin/returns/' + encodeURIComponent(deliveryId) + '/economic-preflight',
        { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' }
      );
      const json = await response.json() as DeliveryReturnEconomicPreview & {error?:string};
      if (!response.ok) throw new Error(json.error || 'Prévia financeira indisponível.');
      setData(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar esta devolução.');
    } finally { setBusy(false); }
  };
  const verifyRoute=async()=>{
    if(routeBusy||!data?.tariffQuote.policyId)return;
    if(!window.confirm('Verificar a rota de retorno usando Google Routes? A consulta exige política habilitada, equipe independente e pode gerar custo do provedor. Não libera remuneração.'))return;
    setRouteBusy(true);setRouteMessage('');
    try{
      const token=await user.getIdToken();
      const response=await fetch(
        '/api/delivery-opportunities/admin/returns/'+encodeURIComponent(deliveryId)+'/route-distance/verify',
        {method:'POST',headers:{authorization:'Bearer '+token},cache:'no-store'}
      );
      const body=await response.json().catch(()=>({})) as Record<string,unknown>;
      if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'Rota indisponível.');
      const meters=Number(body.distanceMeters);
      setRouteMessage('Planejamento certificado: '+(meters/1000).toLocaleString('pt-BR',{maximumFractionDigits:2})+' km. Revisão financeira ainda necessária.');
      await inspect();
    }catch(caught){setRouteMessage(caught instanceof Error?caught.message:'Não foi possível certificar a rota.');}
    finally{setRouteBusy(false);}
  };
  return (
    <div className="mt-2 rounded-xl border border-cyan-500/25 bg-slate-950 p-3">
      <p className="text-[10px] font-bold text-cyan-200">Conciliação econômica da devolução · v1.0</p>
      <p className="mt-1 text-[9px] text-slate-400">
        Prévia de leitura, sem pagamento, débito, reembolso ou reconhecimento automático.
      </p>
      <button type="button" onClick={() => void inspect()} disabled={busy}
        className="mt-2 rounded-lg border border-cyan-500/30 px-3 py-2 text-[10px] text-cyan-200 disabled:opacity-50">
        {busy ? 'Consultando fonte econômica…' : 'Consultar parcelas da devolução'}
      </button>
      {error && <p role="alert" className="mt-2 text-[10px] text-amber-200">{error}</p>}
      {data && (
        <div className="mt-3 space-y-2">
          <p className="text-[9px] text-slate-300">
            Pacote recebido: {data.receivedCondition === 'intact' ? 'íntegro'
              : data.receivedCondition === 'damaged' ? 'com avaria' : 'divergência'}.
            Responsabilidade pelo custo: em análise.
          </p>
          <p className="text-[9px] text-slate-400">
            Contrato aceito: {data.tariffQuote?.policyId
              ?data.tariffQuote.policyId+' v'+data.tariffQuote.policyVersion
              :'não comprovado'}.
            Prazo de cortesia: {data.contractGraceMinutes===null
              ?'não apurado':data.contractGraceMinutes+' min'}.
          </p>
          {data.tariffQuote?.policyId && data.tariffQuote.returnStatus==='distance_authority_required' && (
            <button type="button" disabled={busy||routeBusy} onClick={()=>void verifyRoute()}
              className="rounded-lg border border-teal-500/30 px-3 py-2 text-[10px] text-teal-200 disabled:opacity-50">
              {routeBusy?'Validando provedor…':'Certificar distância da rota — pode gerar custo Google'}
            </button>
          )}
          {routeMessage && <p role="status" className="text-[9px] text-amber-200">{routeMessage}</p>}
          {data.segments.map(part => (
            <div key={part.id} className="rounded-lg border border-slate-800 p-2">
              <div className="flex items-baseline justify-between gap-2 text-[10px]">
                <strong className="text-slate-200">{LABELS[part.kind]}</strong>
                <span className="shrink-0 text-white">{money(part.amountMinor)}</span>
              </div>
              <p className="mt-1 text-[9px] text-slate-500">{STATUS_LABELS[part.status]}</p>
            </div>
          ))}
          {data.duplicateOrIneligibleObligation && (
            <p className="text-[9px] text-red-200">
              Há obrigação elegível ou liquidada: bloquear novo reconhecimento e investigar duplicidade.
            </p>
          )}
          {data.pendingObligationIds.length > 0 && (
            <p className="text-[9px] text-amber-200">
              {data.pendingObligationIds.length} obrigação(ões) anteriores pendente(s) de conciliação.
            </p>
          )}
          <AdminDeliveryReturnLiabilityPanel user={user} deliveryId={deliveryId} />
          <p className="text-[9px] font-bold text-amber-200">
            Total final não apurado. Nenhuma parcela será liberada automaticamente.
            Prazo de cortesia, taxa de retorno e espera dependem de termos previamente aceitos.
          </p>
        </div>
      )}
    </div>
  );
}
