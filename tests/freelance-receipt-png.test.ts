import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sanitizeReceiptPng,MAX_RECEIPT_BYTES} from '../server/freelance/freelanceReceiptPng.js';
import {receiptFixture} from './fixtures/freelance-receipt-fixture.js';
test('strict PNG receipt, strips metadata, deterministic canonical bytes and rejects invalid content',()=>{
 const original=receiptFixture(),clean=sanitizeReceiptPng(original);
 assert.equal(clean.width,1);assert.equal(clean.height,1);
 assert.ok(!clean.bytes.includes(Buffer.from('fixture metadata')));
 assert.equal(sanitizeReceiptPng(clean.bytes.toString('base64')).sha256,clean.sha256);
 const raw=Buffer.from(original,'base64'),corrupt=Buffer.from(raw);corrupt[20]^=1;
 for(const value of ['not base64','YWJjZA==',raw.subarray(0,raw.length-1).toString('base64'),corrupt.toString('base64'),Buffer.concat([raw,Buffer.from('trailing')]).toString('base64'),Buffer.alloc(MAX_RECEIPT_BYTES+1).toString('base64')])
  assert.throws(()=>sanitizeReceiptPng(value),/FREELANCE_RECEIPT_INVALID/);
});
