import {deflateSync} from 'node:zlib';
import {pngCrc32} from '../../server/freelance/freelanceReceiptPng.js';
export function receiptFixture(){
 const chunk=(type:string,data:Buffer)=>{
  const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(pngCrc32(body),8+data.length);return out;
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('private\x00fixture metadata')),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
