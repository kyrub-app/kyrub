import {inflateSync,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const MAX_RECEIPT_BYTES=256*1024;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const invalid=():never=>{throw Error('FREELANCE_RECEIPT_INVALID');};
export function pngCrc32(b:Buffer){
 let crc=0xffffffff;
 for(const value of b){crc^=value;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function chunk(type:string,data:Buffer){
 const body=Buffer.concat([Buffer.from(type,'ascii'),data]),out=Buffer.alloc(12+data.length);
 out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(pngCrc32(body),8+data.length);return out;
}
/** Restricted static PNG profile: 8-bit RGB/RGBA, no interlace, bounded decode.
 * Reconstruct image stream from pixels/filters, strip metadata and reject unknown
 * critical chunks. This is format validation, not a malware scan or proof of payment.
 */
export function sanitizeReceiptPng(value:unknown){
 if(typeof value!=='string'||value.length>Math.ceil(MAX_RECEIPT_BYTES/3)*4||!value.length||
 !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return invalid();
 const raw=Buffer.from(value,'base64');
 if(raw.toString('base64')!==value||raw.length>MAX_RECEIPT_BYTES||!raw.subarray(0,8).equals(signature))return invalid();
 let offset=8,header:Buffer|undefined,ended=false,afterData=false,width=0,height=0,channels=0;
 const blocks:Buffer[]=[];
 while(offset<raw.length){
  if(raw.length-offset<12)return invalid();
  const size=raw.readUInt32BE(offset);
  if(size>raw.length-offset-12)return invalid();
  const body=raw.subarray(offset+4,offset+8+size),type=body.subarray(0,4).toString('ascii'),data=body.subarray(4);
  if(!/^[A-Za-z]{4}$/.test(type)||pngCrc32(body)!==raw.readUInt32BE(offset+8+size))return invalid();
  offset+=size+12;
  if(!header&&type!=='IHDR')return invalid();
  if(type==='IHDR'){
   if(header||size!==13)return invalid();
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;
   if(!width||!height||width>2048||height>4096||width*height>4_000_000||data[8]!==8||!channels||data[10]||data[11]||data[12])return invalid();
   header=Buffer.from(data);
  }else if(type==='IDAT'){
   if(afterData||!size)return invalid();blocks.push(data);
  }else if(type==='IEND'){
   if(size||!blocks.length||offset!==raw.length)return invalid();ended=true;break;
  }else{
   if(!/^[a-z]/.test(type)||['acTL','fcTL','fdAT','tRNS'].includes(type))return invalid();
   if(blocks.length)afterData=true;
  }
 }
 if(!header||!ended)return invalid();
 const stride=width*channels+1,expected=stride*height;
 let decoded:Buffer;
 try{decoded=inflateSync(Buffer.concat(blocks),{maxOutputLength:expected});}catch{return invalid();}
 if(decoded.length!==expected)return invalid();
 for(let i=0;i<decoded.length;i+=stride)if(decoded[i]>4)return invalid();
 const bytes=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(decoded)),chunk('IEND',Buffer.alloc(0))]);
 if(bytes.length>MAX_RECEIPT_BYTES)return invalid();
 return {bytes,width,height,sha256:createHash('sha256').update(bytes).digest('hex')};
}
