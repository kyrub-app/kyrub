import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {inMemoryPersistence,setPersistence,signInWithEmailAndPassword,onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../src/utils/firebase';
import {ProfilePublicIdentityEditor} from '../../src/components/ProfilePublicIdentityEditor';
import {PlatformChallengesPanel} from '../../src/components/PlatformChallengesPanel';
import {PitangaAccount} from '../../src/components/tabs/PitangaAccount';
import {usePlatformChallenges} from '../../src/hooks/usePlatformChallenges';
import '../../src/index.css';

if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||auth.app.options.projectId!=='demo-kyrub-welcome'||auth.emulatorConfig?.host!=='127.0.0.1'||auth.emulatorConfig?.port!==9099)throw Error('LOCAL_FIXTURE_ONLY');
await setPersistence(auth,inMemoryPersistence);
function Workspace({user}:{user:User}){
 const catalog=usePlatformChallenges(true,user.uid);
 return <main className="space-y-4 p-4"><ProfilePublicIdentityEditor user={user}/>
 <PlatformChallengesPanel {...catalog} onRetry={catalog.retry}/><PitangaAccount mode="pitangas"/></main>;
}
function Fixture(){
 const [user,setUser]=useState<User|null>(null);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 return user?<Workspace key={user.uid} user={user}/>:<form onSubmit={e=>{e.preventDefault();void signInWithEmailAndPassword(auth,email,password).catch(()=>setError('Login falhou'));}}>
 <label>Email de teste<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>Senha de teste<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button type="submit">Entrar na fixture</button><p>{error}</p></form>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
