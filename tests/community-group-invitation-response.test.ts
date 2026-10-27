import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const service = readFileSync('server/notifications/communityGroupInvitationResponseService.ts', 'utf8');
const router = readFileSync('server/notifications/userNotificationRouter.ts', 'utf8');
const client = readFileSync('src/utils/userNotifications.ts', 'utf8');

test('invite response identity is obtained exclusively from verified bearer token', () => {
  assert.match(router, /await requireIdentity\(request\.get\('authorization'\)/);
  assert.match(router, /recipientUserId: identity\.uid/);
  assert.doesNotMatch(router, /recipientUserId: request\.body/);
  assert.doesNotMatch(client, /recipientUserId/);
});

test('invitation acceptance uses transaction and checks recipient and pending status', () => {
  assert.match(service, /adminDb\.runTransaction/);
  assert.match(service, /collection\('invitations'\)\.doc\(recipientUserId\)/);
  assert.match(service, /invite\.inviteeId !== recipientUserId/);
  assert.match(service, /invite\.status !== 'pending'/);
  assert.match(service, /invite\.invitedBy !== group\.creatorId/);
});

test('group admission checks community membership and capacity before write', () => {
  assert.match(service, /membershipSnap\.data\(\)\?\.status !== 'active'/);
  assert.match(service, /membershipSnap\.data\(\)\?\.userId !== recipientUserId/);
  assert.match(service, /decision === 'accepted' && group\.memberIds\.length >= 50/);
  assert.match(service, /decision === 'accepted'/);
  assert.match(service, /transaction\.update\(groupRef/);
  assert.match(service, /transaction\.update\(inviteRef, \{ status: decision \}\)/);
});

const invitationIssue = readFileSync('server/notifications/communityGroupInvitationIssueService.ts', 'utf8');
const square = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
const communities = readFileSync('src/components/ProfileCommunitiesCloudBridge.tsx', 'utf8');

test('Praça provides an explicit communities mount independent of search placeholder', () => {
  assert.match(square, /id="praca-communities-host"/);
  assert.match(communities, /querySelector<HTMLElement>\('#praca-communities-host'\)/);
});

test('declined invitations cannot be silently reused as pending', () => {
  assert.match(invitationIssue, /inviteSnap\.data\(\)\?\.status === 'pending'/);
  assert.match(invitationIssue, /COMMUNITY_GROUP_INVITATION_NOT_PENDING/);
  assert.match(service, /invite\.status !== 'pending'/);
});
