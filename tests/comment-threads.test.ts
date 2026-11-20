import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCommentThreads } from '../src/utils/commentThreads';

const item = (id: string, parentCommentId = '', postId = 'post-a') => ({
  id, postId, parentCommentId, createdAt: '2026-11-20T12:00:00.000Z',
});

test('ordinary comments remain top level, with replies to replies grouped under the root', () => {
  const ordered = orderCommentThreads([
    item('grandchild', 'child'), item('other-root'),
    item('child', 'root'), item('root'),
  ]);
  assert.deepEqual(ordered.map(value => [value.comment.id, value.depth, value.rootId]), [
    ['other-root', 0, 'other-root'],
    ['root', 0, 'root'],
    ['child', 1, 'root'],
    ['grandchild', 2, 'root'],
  ]);
  assert.equal(ordered.at(-1)?.parent?.id, 'child');
});

test('deleting a parent never hides the remaining answers', () => {
  const ordered = orderCommentThreads([item('grandchild', 'child'), item('child', 'deleted')]);
  assert.deepEqual(ordered.map(value => value.comment.id), ['child', 'grandchild']);
  assert.equal(ordered[0].depth, 0);
});

test('malformed cycles and foreign-post references do not hang the discussion', () => {
  const ordered = orderCommentThreads([
    item('a', 'b'), item('b', 'a'), item('c', 'z'), item('z', '', 'post-b'),
  ]);
  assert.equal(ordered.length, 4);
  assert.deepEqual(new Set(ordered.map(value => value.comment.id)), new Set(['a','b','c','z']));
  assert.equal(ordered.find(value => value.comment.id === 'c')?.depth, 0);
});
