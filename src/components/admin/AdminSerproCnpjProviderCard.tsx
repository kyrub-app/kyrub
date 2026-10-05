import { useEffect, useState } from 'react';
import { Building2, CircleAlert, CircleCheck, KeyRound, PlugZap } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  loadAdminSerproCnpjCredentialStatus,
  saveAdminSerproCnpjCredentials,
  testAdminSerproCnpjAuthentication,
  type AdminSerproCnpjCredentialStatus,
} from '../../utils/adminSerproCnpjProvider';

export default function AdminSerproCnpjProviderCard({
  authenticatedUser,
  profile,
  vaultReady,
}: {
  authenticatedUser: User;
  profile: AdminProfile;
  vaultReady: boolean;
}) {
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [status, setStatus] = useState<AdminSerproCnpjCredentialStatus | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>('load');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setBusy('load');
    void loadAdminSerproCnpjCredentialStatus(authenticatedUser, profile)
      .then(value => {
        if (active) setStatus(value);
      })
      .catch(error => {
        if (active) setMessage(error instanceof Error ? error.message : 'Não foi possível consultar a integração SERPRO.');
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => { active = false; };
  }, [authenticatedUser.uid, profile.role, profile.status]);

  const save = async (): Promise<void> => {
    if (!consumerKey.trim() || !consumerSecret.trim() || busy) return;
    setBusy('save');
    setMessage('');
    try {
      const next = await saveAdminSerproCnpjCredentials(authenticatedUser, profile, {
        consumerKey,
        consumerSecret,
      });
      setStatus(next);
      setConsumerKey('');
      setConsumerSecret('');
      setMessage('Credenciais SERPRO armazenadas no cofre. Teste a autenticação antes de habilitar consultas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar as credenciais SERPRO.');
    } finally {
      setBusy(null);
    }
  };

  const test = async (): Promise<void> => {
    if (!status?.configured || busy) return;
    setBusy('test');
    setMessage('');
    try {
      const result = await testAdminSerproCnpjAuthentication(authenticatedUser, profile);
      setStatus(result.credential);
      setMessage(
        result.ok
          ? 'Autenticação OAuth do SERPRO validada. Isso confirma as credenciais, não executa uma consulta CNPJ.'
          : `O SERPRO não validou a autenticação (${result.code || 'erro desconhecido'}).`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível testar a autenticação SERPRO.');
    } finally {
      setBusy(null);
    }
  };

  const validated = status?.status === 'validated';

  return <article className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Serviços empresariais · SERPRO</span>
        <h3 className="mt-1 flex items-center gap-2 text-sm font-black text-white"><Building2 className="h-4 w-4 text-cyan-300" />Consulta CNPJ</h3>
        <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">Credenciais institucionais da plataforma Kyrub para autenticação no gateway oficial do SERPRO. O botão de busca do ERP só será ligado quando a consulta cadastral estiver implementada e validada.</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[9px] font-black uppercase text-slate-300">
        {validated ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> : <CircleAlert className="h-3.5 w-3.5 text-amber-400" />}
        {busy === 'load' ? 'Consultando' : validated ? 'Autenticado' : status?.configured ? 'Configurado' : 'Não configurado'}
      </span>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-[10px] font-bold text-slate-400">Consumer Key
        <input type="password" autoComplete="off" value={consumerKey} onChange={event => setConsumerKey(event.target.value)} placeholder={status?.consumerKeyLast4 ? `Salva · ••••${status.consumerKeyLast4}` : 'Cole a Consumer Key do contrato SERPRO'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500" />
      </label>
      <label className="block text-[10px] font-bold text-slate-400">Consumer Secret
        <input type="password" autoComplete="new-password" value={consumerSecret} onChange={event => setConsumerSecret(event.target.value)} placeholder={status?.consumerSecretLast4 ? `Salva · ••••${status.consumerSecretLast4}` : 'Cole a Consumer Secret do contrato SERPRO'} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500" />
      </label>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={() => void save()} disabled={busy !== null || !vaultReady || !consumerKey.trim() || !consumerSecret.trim()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-950 disabled:opacity-40"><KeyRound className="h-3.5 w-3.5" />{busy === 'save' ? 'Salvando…' : 'Salvar no cofre'}</button>
      <button type="button" onClick={() => void test()} disabled={busy !== null || !status?.configured} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-200 disabled:opacity-40"><PlugZap className="h-3.5 w-3.5" />{busy === 'test' ? 'Testando…' : 'Testar autenticação'}</button>
    </div>

    {!vaultReady && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-amber-200">O Vault v1 não está disponível neste ambiente. As credenciais não podem ser gravadas enquanto o cofre estiver indisponível.</p>}
    {message && <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[10px] leading-relaxed text-slate-300" aria-live="polite">{message}</p>}
    <p className="mt-3 text-[9px] leading-relaxed text-slate-600">O Kyrub nunca exibe novamente a Consumer Secret completa. A autenticação confirma somente as credenciais OAuth; não confirma ainda o contrato funcional de consulta CNPJ.</p>
  </article>;
}
