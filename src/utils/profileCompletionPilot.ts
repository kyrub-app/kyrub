import type { User } from 'firebase/auth';
import { auth } from './firebase';
import { notifyRewardRefresh } from './rewardRefresh';

/** A local test adapter only; never sends a reward request from a deployed app. */
export async function reconcileProfileCompletionPilot(user:User):Promise<void>{
 if(import.meta.env?.DEV!==true||import.meta.env?.VITE_KYRUB_PROFILE_COMPLETION_PILOT!=='true'||
    typeof window==='undefined'||window.location.hostname!=='127.0.0.1'||window.location.protocol!=='http:'||
    auth.app.options.projectId!=='demo-kyrub-welcome'||auth.currentUser!==user)return;
 try{
  const token=await user.getIdToken();
  if(auth.currentUser!==user)return;
  const response=await fetch('/api/profile-completion-pilot',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
  if(!response.ok||auth.currentUser!==user)return;
  const result=await response.json();
  if(auth.currentUser===user&&(result.status==='completed'||result.status==='already_completed'))
   notifyRewardRefresh(user,'profile_completion');
 }catch{
  // A reward check cannot turn an already persisted profile edit into a failure.
  // The next successful save or reservation can safely retry.
 }
}
