import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareFirestoreReleaseSources } from './compare-firestore-release-sources.mjs';

const project='kyrub-b8d0e';
const releaseName='projects/'+project+'/releases/cloud.firestore';
const origin='https://firebaserules.googleapis.com/v1/';
const rulesetNamePattern=/^projects\/kyrub-b8d0e\/rulesets\/[A-Za-z0-9_-]{1,128}$/;
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const fail=()=>{throw Error('ACTIVE_RULES_READ_BLOCKED');};

// Only fixed Google API GETs, no document reads, mutations, key export,
// arbitrary host, project override, or output of the rules source.
export async function inspectActiveFirestoreRules({baseline,candidate,getJson}){
  const release=await getJson(releaseName);
  if(release?.name!==releaseName||!rulesetNamePattern.test(release.rulesetName??'')||!validTime(release.updateTime))fail();
  const ruleset=await getJson(release.rulesetName);
  const files=ruleset?.source?.files;
  if(ruleset?.name!==release.rulesetName||!Array.isArray(files)||files.length!==1||
     typeof files[0]?.content!=='string'||Buffer.byteLength(files[0].content)>262144)fail();
  const active=files[0].content;
  const confirmed=await getJson(releaseName);
  if(confirmed?.name!==releaseName||confirmed.rulesetName!==release.rulesetName||confirmed.updateTime!==release.updateTime)fail();
  return {project,releaseName,rulesetName:release.rulesetName,releaseUpdateTime:release.updateTime,
    observedAt:new Date().toISOString(),...compareFirestoreReleaseSources({baseline,active,candidate})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4||process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)fail();
    const [baseline,candidate]=process.argv.slice(2).map(path=>readFileSync(path,'utf8'));
    // Use the existing authorized workstation's ADC. Never log or export tokens.
    const {applicationDefault}=await import('firebase-admin/app');
    const credential=applicationDefault();
    const {access_token}=await credential.getAccessToken();
    if(typeof access_token!=='string'||!access_token)fail();
    const getJson=async name=>{
      if(name!==releaseName&&!rulesetNamePattern.test(name))fail();
      const res=await fetch(origin+name,{method:'GET',headers:{Authorization:'Bearer '+access_token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!res.ok)fail();
      return res.json();
    };
    const result=await inspectActiveFirestoreRules({baseline,candidate,getJson});
    console.log(JSON.stringify(result));
    if(result.status!=='source_match_review_required')process.exitCode=1;
  }catch{
    console.error('ACTIVE_RULES_READ_BLOCKED: obtain authorized read-only ADC and verify the project/release; no deployment performed.');
    process.exitCode=1;
  }
}
