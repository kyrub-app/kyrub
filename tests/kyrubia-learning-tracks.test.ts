import assert from 'node:assert/strict';
import test from 'node:test';
import { KYRUBIA_LEARNING_TRACKS } from '../src/ai/kyrubiaLearningTracks';

test('Kyrubia learning goals are distinct and remain editable requests, not vendor course promises', () => {
  assert.deepEqual(KYRUBIA_LEARNING_TRACKS.map(track => track.id), ['earn', 'entrepreneurship', 'kyrub']);
  assert.equal(new Set(KYRUBIA_LEARNING_TRACKS.map(track => track.title)).size, 3);
  for (const track of KYRUBIA_LEARNING_TRACKS) {
    assert.ok(track.title.trim().length > 5);
    assert.ok(track.description.trim().length > 20);
    assert.ok(track.starterPrompt.trim().length > 30);
    assert.ok(track.starterPrompt.length <= 4000);
    assert.match(track.starterPrompt, /Kyrub|renda|empreender/i);
  }
});
