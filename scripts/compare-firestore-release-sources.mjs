import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const valid = value => typeof value === 'string' && value.length > 0 &&
  /rules_version\s*=/.test(value) && /service\s+cloud\.firestore\s*\{/.test(value);

// Offline only. The caller must independently establish the provenance of the
// live export; a matching file is not a credential, an approval, or an API attestation.
export function compareFirestoreReleaseSources({ baseline, active, candidate }) {
  if (![baseline,active,candidate].every(valid)) {
    return { status:'blocked_invalid_source' };
  }
  const baselineSha256=digest(baseline), activeSha256=digest(active), candidateSha256=digest(candidate);
  const status=activeSha256!==baselineSha256?'blocked_active_drift':
    candidateSha256===baselineSha256?'blocked_no_change':'source_match_review_required';
  return {status,baselineSha256,activeSha256,candidateSha256};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==5)throw Error('Provide baseline.rules active-export.rules candidate.rules');
    const [baseline,active,candidate]=process.argv.slice(2).map(path=>readFileSync(path,'utf8'));
    const result=compareFirestoreReleaseSources({baseline,active,candidate});
    console.log(JSON.stringify(result));
    if(result.status!=='source_match_review_required')process.exitCode=1;
  }catch{
    console.error('Firestore release source comparison unavailable; stop release.');
    process.exitCode=1;
  }
}
