export const SOCIAL_PREVIEW_HOST='kyrub-git-feat-kyrub-social-tag-898822-kyrubapp-6434s-projects.vercel.app';
export const SOCIAL_PREVIEW_PROJECT='kyrub-tags';
export const SOCIAL_PREVIEW_BRANCH='feat/kyrub-social-tag-integration';
export function isSocialPreviewDiagnostic(location:Pick<Location,'protocol'|'hostname'|'port'|'pathname'|'search'>,enabled:boolean,project:unknown){
 return enabled&&project===SOCIAL_PREVIEW_PROJECT&&location.protocol==='https:'&&location.hostname===SOCIAL_PREVIEW_HOST&&!location.port&&location.pathname==='/'&&location.search==='?diagnostico=isolamento-social';
}
export type PreflightResult={status:number;verified:boolean};
export async function runSocialPreviewDiagnostic(deps:{allowed:()=>boolean;current:()=>{getIdToken:()=>Promise<string>}|null;request:typeof fetch},signal:AbortSignal):Promise<PreflightResult>{
 const user=deps.current();
 const check=()=>{if(!deps.allowed()||!user||deps.current()!==user||signal.aborted)throw Error('DIAGNOSTIC_UNAVAILABLE');};
 check();
 if(!user)throw Error('DIAGNOSTIC_UNAVAILABLE');
 const token=await user.getIdToken();check();
 const response=await deps.request('/api/health?transport=social-preview-preflight',{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin',redirect:'error',signal});
 check();
 if(response.status!==200)return {status:response.status,verified:false};
 const value=await response.json();check();
 return {status:200,verified:value?.configuration==='isolated-preview'&&value.project===SOCIAL_PREVIEW_PROJECT&&value.branch===SOCIAL_PREVIEW_BRANCH&&value.identityVerified===true&&value.reservedPilotEnabled===false&&value.firestoreRulesVerified===false&&value.clientCacheVerified===false&&value.releaseApproved===false};
}
