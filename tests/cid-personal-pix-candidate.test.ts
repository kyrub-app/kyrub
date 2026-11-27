import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeCidPersonalPixCandidate,projectCidPersonalPixCandidate} from '../shared/cidPersonalPixCandidate.js';
const cid={keyType:'random',key:'123e4567-e12b-12d1-a456-426655440000',recipientName:'Pessoa Teste',recipientCity:'BRASILIA',publicConsent:true};
test('personal candidate reuses syntax from existing CID with no implied financial consent or ownership',()=>{
 for(const [keyType,key,expected] of [['random',cid.key,cid.key],['cpf','529.982.247-25','52998224725'],['phone','+5511999999999','+5511999999999'],['email','TESTE@example.invalid','teste@example.invalid']]){
  const input={...cid,keyType,key};
  const before=structuredClone(input);
  assert.deepEqual(normalizeCidPersonalPixCandidate(input),{keyType,key:expected});
  assert.deepEqual(projectCidPersonalPixCandidate(input),{keyType,maskedKey:'••••'+expected.slice(-4),ownershipVerified:false});
  assert.deepEqual(input,before);
 }
});
test('refuses corporate keys, missing consent, invalid data and spoofed authority',()=>{
 assert.throws(()=>normalizeCidPersonalPixCandidate({...cid,keyType:'cnpj',key:'04.252.011/0001-10'}),/CID_PERSONAL_PIX_UNSUPPORTED/);
 for(const input of [null,{...cid,publicConsent:false},{...cid,key:'invalid'},{...cid,ownershipVerified:true},{...cid,linkedAccountId:'forged'}])assert.throws(()=>normalizeCidPersonalPixCandidate(input),/CID_PIX_INVALID/);
});
