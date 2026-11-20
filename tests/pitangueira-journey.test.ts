import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOSQUES_PER_XP, SEEDS_PER_BOSQUE, SEEDS_PER_PITANGUEIRA,
  calculatePitangueiraJourney, planPostSemeadura, sumVerifiedPersonalSeeds,
} from '../shared/pitangueiraJourney';
import { PITANGAS_PER_XP } from '../shared/pitangaXpConversion';

test('one tree earns exactly one Pitanga equivalent and 100 trees form one bosque', () => {
  assert.equal(SEEDS_PER_PITANGUEIRA, 1000);
  assert.equal(SEEDS_PER_BOSQUE, 100_000);
  assert.equal(BOSQUES_PER_XP, 10);
  assert.equal(PITANGAS_PER_XP, 1000);
  assert.deepEqual(
    (({ remainingSeeds, brotos, mudas, pitangueirasInCurrentBosque }) => ({
      remainingSeeds, brotos, mudas, pitangueirasInCurrentBosque,
    }))(calculatePitangueiraJourney(99_999)),
    { remainingSeeds: 9, brotos: 9, mudas: 9, pitangueirasInCurrentBosque: 99 },
  );
  const first = calculatePitangueiraJourney(1000);
  assert.equal(first.pitangueiras, 1);
  assert.equal(first.pitangasEquivalent, 1);
  assert.equal(first.bosques, 0);
  const full = calculatePitangueiraJourney(100_000);
  assert.equal(full.pitangueiras, 100);
  assert.equal(full.pitangasEquivalent, 100);
  assert.equal(full.bosques, 1);
  assert.equal(full.xpEquivalent, 0);
});

test('ten bosques across several publications equal 1000 Pitangas / 1 XP, not one post', () => {
  const posts = Array.from({ length: 10 }, (_, i) => ({
    postId: `post-${i}`, seeds: 100_000,
  }));
  const total = sumVerifiedPersonalSeeds(posts);
  assert.equal(total.totalSeeds, 1_000_000);
  assert.equal(total.bosques, 10);
  assert.equal(total.pitangasEquivalent, PITANGAS_PER_XP);
  assert.equal(total.xpEquivalent, 1);
  assert.throws(() => sumVerifiedPersonalSeeds([...posts, posts[0]!]), /SEMEADURA_DUPLICATE_POST/);
  assert.throws(() => sumVerifiedPersonalSeeds([{ postId: 'one', seeds: 100_001 }]), /EXCEEDS_CAP/);
});

test('a post stops accepting seeds after the FIRST bosque, even on later requests', () => {
  const last = planPostSemeadura({ acceptedSeeds: 99_999, closed: false, alreadySeeded: false, isAuthor: false });
  assert.deepEqual(last, { status: 'accepted', count: 100_000, nowClosed: true });
  assert.deepEqual(planPostSemeadura({ acceptedSeeds: 100_000, closed: true, alreadySeeded: false, isAuthor: false }),
    { status: 'closed', count: 100_000, nowClosed: true });
  assert.deepEqual(planPostSemeadura({ acceptedSeeds: 100_000, closed: true, alreadySeeded: true, isAuthor: false }),
    { status: 'already_seeded', count: 100_000, nowClosed: true });
  assert.throws(() => planPostSemeadura({ acceptedSeeds: 100_001, closed: true, alreadySeeded: false, isAuthor: false }),
    /EXCEEDS_CAP/);
});

test('self-recognition is rejected, duplicate seed receipts do not increment, invalid counts fail', () => {
  assert.throws(() => planPostSemeadura({ acceptedSeeds: 4, closed: false, alreadySeeded: false, isAuthor: true }),
    /SELF_RECOGNITION_DENIED/);
  assert.deepEqual(planPostSemeadura({ acceptedSeeds: 4, closed: false, alreadySeeded: true, isAuthor: false }),
    { status: 'already_seeded', count: 4, nowClosed: false });
  for (const seeds of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculatePitangueiraJourney(seeds), /SEMEADURA_COUNT_INVALID/);
  }
});

test('community progress can display bosques, but only personal author may earn Pitangas', () => {
  const communityPublicProgress = calculatePitangueiraJourney(100_000);
  const authorA = sumVerifiedPersonalSeeds([{ postId: 'a', seeds: 75_000 }]);
  const authorB = sumVerifiedPersonalSeeds([{ postId: 'b', seeds: 25_000 }]);
  assert.equal(communityPublicProgress.bosques, 1);
  assert.equal(authorA.pitangasEquivalent, 75);
  assert.equal(authorB.pitangasEquivalent, 25);
  // No function in this module writes a wallet or XP ledger. Credit happens
  // only through trusted verified earning and voluntary conversion paths.
});
