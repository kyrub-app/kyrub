import {useEffect,useState} from 'react';
import {onAuthStateChanged,signInWithEmailAndPassword,signOut,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {freelanceCloudPreviewEnabled} from '../utils/freelanceHiringCloud';
import {FreelaManagerModal} from './modals/FreelaManagerModal';
import {UserNotificationCenterBridge} from './UserNotificationCenterBridge';

/** Isolated browser harness: mounts the actual hiring modal and bell, never LegacyApp. */
export function FreelanceEmulatorEntry(){
 const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 const [mode,setMode]=useState<'employer'|'employee'|null>(null);
 useEffect(()=>onAuthStateChanged(auth,current=>{setUser(current);setReady(true);setMode(null);setError('');setPassword('');}),[]);
 if(!freelanceCloudPreviewEnabled()||import.meta.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW!=='true')throw Error('FREELANCE_BROWSER_REQUIRES_ISOLATION');
 return <main className="min-h-screen bg-slate-950 text-slate-100 p-3">
   <header id="app-header" className="flex items-center gap-2"><h1 className="text-base font-bold">Homologação Freelas</h1></header>
   {!ready?<p>Restaurando sessão…</p>:user?<>
    <UserNotificationCenterBridge/>
    <div className="space-y-3 mt-4">
     <p>Sessão de teste: {user.email}</p>
     <button type="button" onClick={()=>setMode('employer')} className="block border p-2 rounded-xl">Solicitar Freela</button>
     <button type="button" onClick={()=>setMode('employee')} className="block border p-2 rounded-xl">Fazer Freelas</button>
     <button type="button" onClick={()=>void signOut(auth)} className="block border p-2 rounded-xl">Sair</button>
    </div>
    <FreelaManagerModal isOpen={mode!==null} mode={mode??'employee'} onClose={()=>setMode(null)} freelanceJobs={[]} setFreelanceJobs={()=>{}} profileName={user.displayName??''} triggerToast={setError}/>
   </>:<form className="space-y-3 mt-4" onSubmit={e=>{e.preventDefault();void signInWithEmailAndPassword(auth,email,password).catch(()=>setError('Login de teste indisponível.'));}}>
    <label className="block">E-mail<input type="email" className="block w-full bg-slate-900 p-2" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label className="block">Senha<input type="password" className="block w-full bg-slate-900 p-2" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    <button type="submit" className="border p-2 rounded-xl">Entrar</button>
   </form>}
   {error&&<p role="alert">{error}</p>}
 </main>;
}
