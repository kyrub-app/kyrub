export const CID_SPECIALIST_FINDINGS={
 'insufficient-information':'Informações insuficientes',
 'no-further-action':'Sem encaminhamento adicional',
 'legal-review-required':'Encaminhar para análise jurídica'
} as const;
export type CidSpecialistFinding=keyof typeof CID_SPECIALIST_FINDINGS;
export type CidSpecialistInput={id:string;expectedRevision:number;finding:CidSpecialistFinding;reason:string};
export type CidSpecialistReceipt={id:string;revision:number;finding:CidSpecialistFinding;simulation:true;authorizesRetention:false;authorizesDisclosure:false};
export type CidSpecialistAdapter={review:(input:CidSpecialistInput)=>Promise<CidSpecialistReceipt>};
