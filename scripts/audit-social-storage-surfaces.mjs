import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
// Inspect tracked source, never secrets, env files, build artifacts or data.
const files=execFileSync('git',['ls-files','-z','--','src','server','api','public','scripts'],{encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(path=>/\.(?:tsx?|jsx?|mjs|cjs|html)$/.test(path)&&!path.endsWith('audit-social-storage-surfaces.mjs')&&!path.endsWith('.min.js'));
const patterns=[
 ['social-data',/\b(?:social_chats|connections|contact_favorites|contact_groups|community_direct_forward_receipts|reserved_tribe_vaults|social_contact_blocks)\b/],
 ['local-persistence',/\b(?:localStorage|sessionStorage|indexedDB|persistentLocalCache|persistentMultipleTabManager|enableIndexedDbPersistence|clearIndexedDbPersistence|waitForPendingWrites|memoryLocalCache)\b/],
 ['offline-browser',/\b(?:serviceWorker|registerSW|CacheStorage|caches\.|workbox|navigator\.onLine)\b/],
 ['social-consumer',/\b(?:useSocialDirectoryV2|useChatMessages|subscribeCommunityPostConnections|resolvePostAuthorConnection|ChatModal|ConnectedContactsPanel|sendCommunityPostToConnectedUser)\b/]
];
let count=0;
for(const path of files){
 const rows=readFileSync(path,'utf8').split(/\r?\n/);
 for(let i=0;i<rows.length;i++){
  const categories=patterns.filter(([,pattern])=>pattern.test(rows[i])).map(([name])=>name);
  if(categories.length){console.log(path+':'+(i+1)+' '+categories.join(','));count++;}
 }
}
console.log('Candidate lines: '+count+'; source files: '+files.length+'. Manual review required.');
