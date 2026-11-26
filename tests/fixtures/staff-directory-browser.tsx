import {useEffect,useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {inMemoryPersistence,setPersistence,signInWithEmailAndPassword,onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../src/utils/firebase';
import {StoreTeamWorkspace} from '../../src/components/store/StoreTeamWorkspace';
import type {Store} from '../../src/types';
import '../../src/index.css';

if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||auth.app.options.projectId!=='demo-kyrub-welcome'||auth.emulatorConfig?.host!=='127.0.0.1'||auth.emulatorConfig?.port!==9099)throw Error('LOCAL_FIXTURE_ONLY');
await setPersistence(auth,inMemoryPersistence);
function Workspace({user}:{user:User}){
 const [message,setMessage]=useState('');
 const notify=useCallback((text:string)=>setMessage(text),[]);
 const legacyStore={name:'Loja de homologação',plan:'free'} as Store;
 return <main className="p-4"><p role="status">{message}</p><StoreTeamWorkspace legacyStore={legacyStore} legacyStoreId={user.uid} notify={notify}/></main>;
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
