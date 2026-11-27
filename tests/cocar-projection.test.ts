import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceCocarProjection, rebuildCocarProjection, validCocarProjection } from '../shared/cocarProjection.js';
import { kyrubXpTotal, type KyrubXpEntry } from '../shared/gamification.js';

const uid = 'user_fixture', epoch = 'epoch_fixture';
const row = (id: string, deltaXp: number, key = id) => ({
  documentId: id,
  entry: { id, userId: uid, economy: 'kyrub_xp', deltaXp, sourceType: 'admin_adjustment' as KyrubXpEntry['sourceType'], sourceId: 'source', correlationId: id, idempotencyKey: key, occurredAt: '2026-11-27T12:00:00.000Z' },
});
const rebuild = (rows: ReturnType<typeof row>[]) => rebuildCocarProjection(uid, epoch, rows);
test('projection matches canonical ledger for 10,000 entries with no history cap', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => row('xp_' + String(i).padStart(5,'0'), i % 7 === 0 ? -3 : 2));
  const p = rebuild(rows);
  assert.equal(p.total, kyrubXpTotal(rows.map(r => r.entry)));
  assert.equal(p.entryCount, rows.length);
  assert.ok(validCocarProjection(p,uid,epoch));
});
test('positive insertion out of order is exact and signed appends preserve the floor', () => {
  const p = rebuild([row('b', 5),row('d', 3)]);
  const a = row('a', 4);
  const next = advanceCocarProjection(p,uid,epoch,a.documentId,a.entry)!;
  assert.deepEqual(next,rebuild([a,row('b',5),row('d',3)]));
  const z = row('z',-50);
  const signed = advanceCocarProjection(next,uid,epoch,z.documentId,z.entry)!;
  assert.equal(signed.total,0);
  const zz = row('zz', 7);
  assert.equal(advanceCocarProjection(signed,uid,epoch,zz.documentId,zz.entry)?.total,7);
  assert.equal(advanceCocarProjection(signed,uid,epoch,'c',row('c',1).entry),null);
  assert.equal(advanceCocarProjection(next,uid,epoch,'c',row('c',-1).entry),null);
});
test('rebuild rejects duplicates, disorder, wrong owner and invalid magnitude', () => {
  assert.throws(()=>rebuild([row('a',1,'same'),row('b',1,'same')]));
  assert.throws(()=>rebuild([row('b',1),row('a',1)]));
  const bad = row('a',1); bad.entry.userId = 'another';
  assert.throws(()=>rebuild([bad]));
  assert.throws(()=>rebuild([row('a',Number.MAX_SAFE_INTEGER),row('b',1)]));
  const p = rebuild([row('a',Number.MAX_SAFE_INTEGER)]);
  assert.equal(advanceCocarProjection(p,uid,epoch,'b',row('b',1).entry),null);
});
test('projection is scoped to certified epoch and does not accept forged shape', () => {
  const p = rebuild([]);
  assert.equal(p.total,0);
  assert.equal(validCocarProjection(p,uid,'another_epoch'),false);
  assert.equal(validCocarProjection({...p,total:2},uid,epoch),false);
  assert.equal(validCocarProjection({...p,unexpected:true},uid,epoch),false);
  assert.equal(advanceCocarProjection(null,uid,epoch,'a',row('a',1).entry),null);
});
