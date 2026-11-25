import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {inMemoryPersistence,setPersistence,signInWithEmailAndPassword} from 'firebase/auth';
import {auth} from '../../src/utils/firebase';
import AdminControlPlaneRoot from '../../src/components/admin/AdminControlPlaneRoot';
import '../../src/index.css';

if(location.hostname!=='127.0.0.1'||location.protocol!=='http:'||auth.app.options.projectId!=='demo-kyrub-welcome'||auth.emulatorConfig?.host!=='127.0.0.1'||auth.emulatorConfig?.port!==9099)throw Error('LOCAL_FIXTURE_ONLY');
await setPersistence(auth,inMemoryPersistence);
// Only the login driver is a fixture. The real root, profile subscription,
// accordion, role checks and gamification children run unchanged.
function Fixture(){
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 return <><form onSubmit={e=>{e.preventDefault();setError('');void signInWithEmailAndPassword(auth,email,password).catch(()=>setError('Login falhou'));}}>
 <label>Email de teste<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>Senha de teste<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button type="submit">Entrar na fixture</button><p>{error}</p>
 </form><AdminControlPlaneRoot/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
