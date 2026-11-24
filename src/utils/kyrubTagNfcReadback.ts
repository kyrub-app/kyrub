/** Exact one-record NDEF URL check. A browser-supplied readback is not a chip authenticity proof. */
export function readOneNdefUrl(event:unknown):string|null{
 if(!event||typeof event!=='object')return null;
 const message=(event as {message?:{records?:unknown}}).message;
 if(!message||!Array.isArray(message.records)||message.records.length!==1)return null;
 const record=message.records[0] as {recordType?:unknown;data?:unknown};
 if(record.recordType!=='url'||!(record.data instanceof DataView))return null;
 try{
  return new TextDecoder('utf-8',{fatal:true}).decode(
   new Uint8Array(record.data.buffer,record.data.byteOffset,record.data.byteLength)
  );
 }catch{return null;}
}
