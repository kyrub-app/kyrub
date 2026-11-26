import {useState} from 'react';
import {MultifunctionCardEditor} from './MultifunctionCardEditor';
export function CardRegistrationPage({userId}:{userId:string}){
 const [selected,setSelected]=useState<{name:string;url:string}|null>(null);
 return <main className="min-h-screen bg-[#121A17] p-4 text-[#F5F5F3]"><div className="mx-auto max-w-md space-y-4 py-4">
  <header className="flex items-center justify-between"><img src="/kyrub-logo.svg" alt="Kyrub" className="h-10 w-10"/><a href="/?app=1" className="text-sm font-bold text-[#F47825]">Kairub-se!</a></header>
  <h1 className="text-xl font-bold">Cadastrar meu cartão</h1>
  <p className="text-sm text-slate-300">Confirme suas informações antes de publicar. Seu cartão é gratuito e independente de qualquer dispositivo físico.</p>
  <MultifunctionCardEditor key={userId} userId={userId} locked={false} onSelect={setSelected}/>
  {selected&&<a href={selected.url} className="block break-all text-sm text-[#F47825] underline">Abrir meu cartão publicado</a>}
  <a href="/?app=1" className="block rounded-xl border border-[#34443B] p-3 text-center text-sm">Continuar para o Kyrub</a>
 </div></main>;
}
