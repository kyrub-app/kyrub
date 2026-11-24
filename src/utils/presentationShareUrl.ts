import {parsePublicDestinationPath} from '../../shared/publicDestinationRoutes';
import {isTagId} from '../../shared/kyrubTagContract';

/** Encode only clean public URLs on the current deployment, never auth or recovery links. */
export function presentationShareUrl(value:string,origin:string):string|null{
 try{
  const url=new URL(value),base=new URL(origin);
  if(url.origin!==base.origin||url.username||url.password||url.search||url.hash)return null;
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return null;
  if(!parsePublicDestinationPath(url.pathname)&&!(url.pathname.startsWith('/tag/')&&isTagId(url.pathname.slice(5))))return null;
  return url.href;
 }catch{return null;}
}
