// Pure static Pix BR Code foundation. No network, DICT lookup, or payment execution.
// Reference: Banco Central, Manual de Padrões para Iniciação do Pix, §2.6.3.
// The user must separately consent to public disclosure; a QR exposes its key.
export type CidPixKeyType='random'|'email'|'phone'|'cpf'|'cnpj';
export type CidPixConfig={keyType:CidPixKeyType;key:string;recipientName:string;recipientCity:string;publicConsent:true};
const fail=():never=>{throw Error('CID_PIX_INVALID');};
function textField(value:unknown,max:number):string{
 if(typeof value!=='string'||value.length>200) return fail();
 const clean=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/ +/g,' ');
 if(!/^[A-Za-z0-9 .,'&-]+$/.test(clean)||clean.length>max)return fail();
 return clean;
}
function digitsValid(value:string,weights:number[]):number{
 const sum=weights.reduce((total,w,i)=>total+Number(value[i])*w,0);
 const remainder=sum%11;return remainder<2?0:11-remainder;
}
function cpfValid(value:string):boolean{
 return /^\d{11}$/.test(value)&&!/^([0-9])\1+$/.test(value)&&
 digitsValid(value,[10,9,8,7,6,5,4,3,2])===Number(value[9])&&digitsValid(value,[11,10,9,8,7,6,5,4,3,2])===Number(value[10]);
}
function cnpjValid(value:string):boolean{
 return /^\d{14}$/.test(value)&&!/^([0-9])\1+$/.test(value)&&
 digitsValid(value,[5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[12])&&digitsValid(value,[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(value[13]);
}
export function normalizeCidPix(input:unknown):CidPixConfig{
 if(!input||typeof input!=='object'||Array.isArray(input))return fail();
 const p=input as Record<string,unknown>;
 if(Object.keys(p).some(k=>!['keyType','key','recipientName','recipientCity','publicConsent'].includes(k))||p.publicConsent!==true||typeof p.key!=='string'||p.key.length>100)return fail();
 const keyType=p.keyType;
 let key=p.key.trim();
 switch(keyType){
  case 'random':key=key.toLowerCase();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key))return fail();break;
  case 'email':key=key.toLowerCase();if(key.length>77||!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(key))return fail();break;
  case 'phone':if(!/^\+55[1-9][0-9]{9,10}$/.test(key))return fail();break;
  case 'cpf':if(!/^[0-9.-]+$/.test(key))return fail();key=key.replace(/[.-]/g,'');if(!cpfValid(key))return fail();break;
  case 'cnpj':if(!/^[0-9./-]+$/.test(key))return fail();key=key.replace(/[./-]/g,'');if(!cnpjValid(key))return fail();break;
  default:return fail();
 }
 return {keyType,key,recipientName:textField(p.recipientName,25),recipientCity:textField(p.recipientCity,15),publicConsent:true};
}
function tlv(id:string,value:string):string{
 const length=new TextEncoder().encode(value).length;
 if(length>99)return fail();
 return id+String(length).padStart(2,'0')+value;
}
export function cidPixCrc16(text:string):string{
 let crc=0xffff;
 for(const byte of new TextEncoder().encode(text)){
  crc^=byte<<8;
  for(let i=0;i<8;i++)crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;
 }
 return crc.toString(16).toUpperCase().padStart(4,'0');
}
export function buildCidPixPayload(input:unknown):string{
 const p=normalizeCidPix(input);
 const code=tlv('00','01')+tlv('26',tlv('00','br.gov.bcb.pix')+tlv('01',p.key))+
 tlv('52','0000')+tlv('53','986')+tlv('58','BR')+tlv('59',p.recipientName)+tlv('60',p.recipientCity)+tlv('62',tlv('05','***'))+'6304';
 return code+cidPixCrc16(code);
}
