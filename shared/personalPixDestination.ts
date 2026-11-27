/** Private receiving destination, separate from the public CID and from provider capability. */
export type PersonalPixKeyType='cpf'|'email'|'phone'|'random';
export type PersonalPixDestination={schemaVersion:1;userId:string;revision:number;status:'declared'|'revoked';keyType?:PersonalPixKeyType;key?:string;updatedAt:string};
export function normalizePersonalPixKey(input:unknown):{keyType:PersonalPixKeyType;key:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PERSONAL_PIX_INVALID');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['keyType','key'].includes(k))||typeof v.key!=='string'||v.key.length>254)throw Error('PERSONAL_PIX_INVALID');
 const k=v.key.trim();
 if(v.keyType==='cpf'&&/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(k)){
  const key=k.replace(/\D/g,'');
  const digit=(length:number)=>{let sum=0;for(let i=0;i<length;i++)sum+=Number(key[i])*(length+1-i);return (sum*10%11)%10;};
  if(!/^(\d)\1{10}$/.test(key)&&digit(9)===Number(key[9])&&digit(10)===Number(key[10]))return {keyType:'cpf',key};
 }
 if(v.keyType==='email'&&k.length<=77&&/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(k))return {keyType:'email',key:k.toLowerCase()};
 if(v.keyType==='phone'&&/^\+55[1-9]\d\d{8,9}$/.test(k))return {keyType:'phone',key:k};
 if(v.keyType==='random'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k))return {keyType:'random',key:k.toLowerCase()};
 throw Error('PERSONAL_PIX_INVALID');
}
export function projectPersonalPixDestination(record:PersonalPixDestination|undefined){
 if(!record)return {revision:0,status:'not_configured' as const,ownershipVerified:false as const};
 if(record.status==='revoked')return {revision:record.revision,status:'revoked' as const,ownershipVerified:false as const};
 if(record.status!=='declared'||!record.key||!record.keyType)throw Error('PERSONAL_PIX_CONFLICT');
 return {revision:record.revision,status:'declared' as const,keyType:record.keyType,maskedKey:'••••'+record.key.slice(-4),ownershipVerified:false as const};
}
