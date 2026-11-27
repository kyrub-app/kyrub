import type { User } from 'firebase/auth';
import type { DeliveryJob } from '../types';

export const KYRUB_DELIVERIES_COLLECTION_PATH = 'hub/renda/deliveries';

export type KyrubDeliveryOperationalStatus = Extract<
  DeliveryJob['status'],
  'accepted' | 'delivering' | 'done'
>;

export const getKyrubDeliveryDocumentPath = (deliveryId: string): string =>
  `${KYRUB_DELIVERIES_COLLECTION_PATH}/${deliveryId.trim()}`;

export const updateKyrubDeliveryOpportunityStatus = async (
  deliveryId: string,
  status: KyrubDeliveryOperationalStatus,
  user: Pick<User, 'getIdToken'>
): Promise<void> => {
  const normalizedId = deliveryId.trim();
  if (!normalizedId) throw new Error('A entrega não foi identificada.');

  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/${encodeURIComponent(normalizedId)}/status`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status }),
    }
  );

  if (response.ok) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível atualizar esta entrega.'
  );
};

/** Explicit user intent only; reject a generic HTTP success or HTML fallback. */
export async function confirmKyrubDeliveryAcceptance(deliveryId:string,user:Pick<User,'uid'|'getIdToken'>):Promise<void>{
 if(!/^order-[a-f0-9]{64}$/.test(deliveryId))throw Error('Entrega inválida.');
 const token=await user.getIdToken();
 const response=await fetch('/api/delivery-opportunities/'+encodeURIComponent(deliveryId)+'/accept',{
  method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({confirmed:true})
 });
 if(!response.ok)throw Error('Aceite não confirmado.');
 const receipt=await response.json();
 if(receipt?.accepted!==true||receipt.deliveryId!==deliveryId||receipt.courierId!==user.uid||receipt.status!=='accepted')throw Error('Aceite não confirmado.');
}
