export const CID_SOS_RESOLUTION_LABELS={safe:'Estou bem',misuse:'Acionamento indevido',recovered:'Objeto recuperado'} as const;
export type CidSosResolution=keyof typeof CID_SOS_RESOLUTION_LABELS;
export function normalizeCidSosResolution(input:unknown):CidSosResolution{
 if(typeof input!=='string'||!Object.hasOwn(CID_SOS_RESOLUTION_LABELS,input))throw Error('CID_SOS_RESOLUTION_INVALID');
 return input as CidSosResolution;
}
export function cidSosResolutionNotice(reason:CidSosResolution){
 return 'Ocorrência encerrada pelo titular: '+CID_SOS_RESOLUTION_LABELS[reason]+'. Declaração do titular, não verificação independente da situação.';
}
