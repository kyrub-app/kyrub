import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {inMemoryPersistence,setPersistence,signInWithEmailAndPassword,onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../src/utils/firebase';
import {ProfileSocialHubNative} from '../../src/components/ProfileSocialHubNative';
import {useLiveAuthorIdentities} from '../../src/hooks/useLiveAuthorIdentities';
import {displayAuthorName,displayAuthorAvatar} from '../../src/utils/authorDisplayIdentity';
import {requestCommunityPostConnection} from '../../src/utils/communityPostConnections';
import '../../src/index.css';

if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||auth.app.options.projectId!=='demo-kyrub-welcome'||auth.emulatorConfig?.host!=='127.0.0.1'||auth.emulatorConfig?.port!==9099)throw Error('LOCAL_FIXTURE_ONLY');
await setPersistence(auth,inMemoryPersistence);
function Workspace(){
 const [connectionResult,setConnectionResult]=useState('');
 const identities=useLiveAuthorIdentities(['social-browser-00','social-browser-private']);
 return <main className="p-4"><button onClick={()=>window.dispatchEvent(new Event('kyrub:open-connections'))}>Abrir conectados na fixture</button>
 <output data-testid="visible-author">{displayAuthorName('social-browser-00','Autor histórico público',identities)}</output>
 <output data-testid="private-author">{displayAuthorName('social-browser-private','Autor histórico reservado',identities)}</output>
 <output data-testid="visible-author-avatar">{displayAuthorAvatar('social-browser-00','historical-public-avatar',identities)||'sem-foto'}</output>
 <output data-testid="private-author-avatar">{displayAuthorAvatar('social-browser-private','historical-private-avatar',identities)||'sem-foto'}</output>
 <button onClick={()=>void requestCommunityPostConnection('social-browser-02').then(()=>setConnectionResult('enviada')).catch(()=>setConnectionResult('falhou'))}>Solicitar conexão pela publicação fixture</button>
 <output data-testid="community-connection-result">{connectionResult}</output>
 <ProfileSocialHubNative/></main>;
}
function Fixture(){
 const [user,setUser]=useState<User|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 return user?<Workspace key={user.uid}/>:<form onSubmit={e=>{e.preventDefault();void signInWithEmailAndPassword(auth,email,password).catch(()=>setError('Login falhou'));}}>
 <label>Email de teste<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>Senha de teste<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button type="submit">Entrar na fixture</button><p>{error}</p></form>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
