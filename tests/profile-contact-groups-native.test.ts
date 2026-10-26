import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const profile = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');

test('contact group picker belongs to the native profile without a DOM patch', () => {
  assert.doesNotMatch(main, /ProfileContactGroupsPolishBridge/);
  assert.match(profile, /const \[openGroupId, setOpenGroupId\] = useState/);
  assert.match(profile, /setOpenGroupId\(current =>/);
  assert.match(profile, /openGroupId === group\.id \|\| group\.memberIds\.includes\(friend\.id\)/);
  assert.match(profile, /Concluir inclusão no grupo/);
  assert.match(profile, /Adicionar pessoas ao grupo/);
  assert.match(profile, /Nenhuma pessoa adicionada/);
  assert.match(profile, /Todos os seus conectados já fazem parte deste grupo/);
  assert.match(profile, /toggleGroupMember\(group, friend\.id\)/);
  assert.match(profile, /deleteGroup\(group\)/);
});
