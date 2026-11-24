import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const inputs=JSON.parse(readFileSync('docs/social-tag-integration-inputs.json','utf8'));
function git(args,allowed=[0]){
 const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
 if(result.error||!allowed.includes(result.status))throw Error('Git audit failed: '+args[0]+' ('+result.status+')');
 return result;
}
const [left,right]=[inputs.tribe.sha,inputs.tag.sha];
for(const sha of [left,right,inputs.mergeBase,inputs.tag.baseSha]){
 assert.match(sha,/^[0-9a-f]{40}$/);
 assert.equal(git(['cat-file','-t',sha]).stdout.trim(),'commit');
}
assert.equal(git(['merge-base',left,right]).stdout.trim(),inputs.mergeBase);
git(['merge-base','--is-ancestor',inputs.tag.baseSha,right]);
const files=sha=>new Set(git(['diff','--name-only',inputs.mergeBase,sha]).stdout.trim().split('\n').filter(Boolean));
const a=files(left),b=files(right);
const overlap=[...a].filter(path=>b.has(path)).sort();
assert.equal(a.size,inputs.changedFromBase.tribe);
assert.equal(b.size,inputs.changedFromBase.tag);
assert.deepEqual(overlap,[...inputs.shared].sort());
console.log('Pinned input commits verified. Shared changes:',overlap.length);
for(const file of overlap)console.log('Shared:',file);
// Git writes an unreferenced tree object locally; no checkout, push or merge
// of either source branch. No credentials, Firebase or Vercel operations.
const before=git(['rev-parse','HEAD']).stdout.trim();
const statusBefore=git(['status','--porcelain']).stdout;
const merge=git(['merge-tree','--write-tree','--name-only','--no-messages',left,right],[0,1]);
const lines=merge.stdout.trim().split('\n');
assert.match(lines[0],/^[0-9a-f]{40}$/);
console.log('Candidate tree:',lines[0]);
for(const path of lines.slice(1).filter(Boolean))console.log('Conflict:',path);
console.log(merge.status===0?'Mechanical merge has no text conflicts; semantic review still required.':'Mechanical conflicts require manual resolution; NOT approved for merge or deployment.');
assert.equal(git(['rev-parse','HEAD']).stdout.trim(),before);
assert.equal(git(['status','--porcelain']).stdout,statusBefore);
// A conflict is a valid audit result, not approval of an integration.
