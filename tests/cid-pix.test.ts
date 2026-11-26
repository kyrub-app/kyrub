import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizePromotionalPresentation,publicPromotionalPresentation} from '../shared/kyrubTagPromotional';
import {buildCidPixPayload,normalizeCidPix,cidPixCrc16} from '../shared/cidPix';
const base={keyType:'random',key:'123e4567-e12b-12d1-a456-426655440000',recipientName:'Fulano de Tal',recipientCity:'BRASILIA',publicConsent:true};
test('static payload matches BCB manual 2.6.3 byte for byte, without fixed amount',()=>{
 assert.equal(buildCidPixPayload(base),'00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
 assert.equal(cidPixCrc16('123456789'),'29B1');
});
test('consent and bounded fields are mandatory, without claiming bank verification',()=>{
 for(const bad of [{...base,publicConsent:false},{...base,publicConsent:undefined},{...base,key:'https://example.com'},{...base,recipientName:'A'.repeat(26)},{...base,recipientCity:'A'.repeat(16)},{...base,recipientName:'A\nB'},{...base,amount:100}])assert.throws(()=>buildCidPixPayload(bad),/CID_PIX_INVALID/);
 assert.equal(normalizeCidPix({...base,recipientCity:'São Paulo'}).recipientCity,'Sao Paulo');
});
test('supported key types are syntactically validated, without querying external services',()=>{
 for(const [keyType,key,expected] of [['cpf','529.982.247-25','52998224725'],['cnpj','04.252.011/0001-10','04252011000110'],['phone','+5511999999999','+5511999999999'],['email','TESTE@example.com','teste@example.com']])assert.equal(normalizeCidPix({...base,keyType,key}).key,expected);
 for(const [keyType,key] of [['cpf','00000000000'],['cnpj','11111111111111'],['phone','11999999999'],['email','abc@x'],['email','a'.repeat(70)+'@example.com']])assert.throws(()=>normalizeCidPix({...base,keyType,key}),/CID_PIX_INVALID/);
});

test('only expressly consented Pix is projected into the public presentation',()=>{
 const card={name:'Pessoa teste',occupation:'',about:''};
 assert.equal(publicPromotionalPresentation(normalizePromotionalPresentation(card)).pix,undefined);
 assert.equal(publicPromotionalPresentation(normalizePromotionalPresentation({...card,pix:null})).pix,undefined);
 assert.throws(()=>normalizePromotionalPresentation({...card,pix:{...base,publicConsent:false}}));
 assert.deepEqual(publicPromotionalPresentation(normalizePromotionalPresentation({...card,pix:base})).pix,base);
});
