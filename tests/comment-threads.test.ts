import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCommentThreads, selectRecentComments } from '../src/utils/commentThreads';

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

test('collapsed community cards show precisely the three newest comments, including replies', () => {
  const comments = [
    {...item('first'),createdAt:'2026-11-20T11:00:00.000Z'},
    {...item('second'),createdAt:'2026-11-20T12:00:00.000Z'},
    {...item('third','first'),createdAt:'2026-11-20T13:00:00.000Z'},
    {...item('fourth'),createdAt:'2026-11-20T14:00:00.000Z'},
    {...item('other-post','', 'post-b'),createdAt:'2026-11-20T15:00:00.000Z'},
  ];
  const source=comments.filter(comment=>comment.postId==='post-a');
  const result=selectRecentComments(source,3);
  assert.deepEqual(result.map(comment=>comment.id),['fourth','third','second']);
  assert.equal(result[1].parentCommentId,'first');
  assert.deepEqual(source.map(comment=>comment.id),['first','second','third','fourth']);
  assert.deepEqual(selectRecentComments(source,0),[]);
  assert.equal(selectRecentComments(source,10).length,4);
});

test('recent comments order equal timestamps deterministically without mutating originals', () => {
  const comments=[item('a'),item('c'),item('b')];
  assert.deepEqual(selectRecentComments(comments,2).map(comment=>comment.id),['c','b']);
  assert.deepEqual(comments.map(comment=>comment.id),['a','c','b']);
});
