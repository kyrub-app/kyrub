import qrcode from 'qrcode-generator';

// ASCII BR Code, encoded as bytes. Never send payment data to a remote renderer.
export function cidPixQrMatrix(payload:string):{size:number;path:string}{
 if(!/^[\x20-\x7E]{1,300}$/.test(payload))throw Error('CID_PIX_QR_INVALID');
 const qr=qrcode(0,'M');
 qr.addData(payload,'Byte');
 qr.make();
 const n=qr.getModuleCount(),quiet=4;
 const commands:string[]=[];
 for(let row=0;row<n;row++){
  for(let col=0;col<n;col++){
   if(qr.isDark(row,col))commands.push(`M${col+quiet},${row+quiet}h1v1h-1z`);
  }
 }
 return {size:n+quiet*2,path:commands.join('')};
}
