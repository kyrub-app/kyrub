import {useEffect,useState} from 'react';
import '../../src/index.css';
import {createRoot} from 'react-dom/client';
import {initializeApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,inMemoryPersistence,setPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,type User} from 'firebase/auth';
import AdminGamificationSupervisionWorkspace from '../../src/components/admin/AdminGamificationSupervisionWorkspace';

if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('LOCAL_FIXTURE_ONLY');
const app=initializeApp({projectId:'demo-kyrub-welcome',apiKey:'fake-emulator-key',authDomain:'demo-kyrub-welcome.firebaseapp.com'});
const auth=getAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
await setPersistence(auth,inMemoryPersistence);

function Fixture(){
 const [user,setUser]=useState<User|null>(null);
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 // Fixture intentionally lets ordinary users reach the panel to test the
 // server's denial. This is not the production Control Plane role gate.
 return <main><h1>Gamificação · fixture isolada</h1>{user?
  <><button type="button" onClick={()=>void signOut(auth)}>Sair da fixture</button>
  <AdminGamificationSupervisionWorkspace key={user.uid} pilotSession={user} caseWrites referralWrites isCurrent={()=>auth.currentUser===user}/></>:
  <form onSubmit={e=>{e.preventDefault();setError('');void signInWithEmailAndPassword(auth,email,password).catch(()=>setError('Login falhou'));}}>
   <label>Email de teste<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label>Senha de teste<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <button type="submit">Entrar na fixture</button><p>{error}</p>
  </form>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
