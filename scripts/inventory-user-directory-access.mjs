#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Discovery aid, not a release attestation. Include indirect references and
// subcollections for review; never infer runtime authorization from syntax.
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0')
 .filter(p=>/^(src|server|api|functions)\//.test(p)&&/\.(ts|tsx|js|mjs|cjs)$/.test(p))
 .filter(p=>!/(^|\/)(dist|lib|node_modules|generated)\//.test(p));
const reference=/(?:['"\x60]users(?:\/|['"\x60])|\/users\/|usersCollection|userCollection|userDocRef|userDirectory|directoryUsers)/i;
const operation=/\b(?:getDoc(?:s|FromServer|FromCache)?|onSnapshot|listenCollection|collectionGroup|collection|doc|query|where|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|\.get|\.set|\.update|\.delete)\b/i;
const candidates=[];
for(const path of paths){
 const lines=readFileSync(path,'utf8').split(/\r?\n/);
 const hits=[];
 for(let i=0;i<lines.length;i++){
  if(!reference.test(lines[i]))continue;
  const context=lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(' ');
  hits.push({line:i+1,source:lines[i].trim().slice(0,500),
   accessHint:operation.test(context)?'database-operation-nearby':'indirect-or-non-database'});
 }
 if(hits.length)candidates.push({path,hits});
}
console.log(JSON.stringify({schemaVersion:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 scannedFiles:paths.length,candidateFiles:candidates.length,candidates,
 limitations:['Includes false positives and subcollections; review ownership and use of returned fields.',
 'May miss aliases, dynamic paths, external functions and deployed revisions.',
 'No rule activation or migration is authorized by this inventory.']},null,2));
