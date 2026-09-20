import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  disableStoreOwnedPixConnection,
  loadStoreOwnedPixConnectionStatus,
  saveStoreOwnedPixConnection,
  type StoreOwnedPixConnectionStatus,
} from '../../utils/storeOwnedPixConnection';
import type { StoreOwnedPixKeyType } from '../../../shared/storeOwnedPix';

const KEY_TYPES: Array<{ value: StoreOwnedPixKeyType; label: string }> = [
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'evp', label: 'Chave aleatória' },
];

function StoreOwnedPixPanel({ user }: { user: User }) {
  const [status, setStatus] = useState<StoreOwnedPixConnectionStatus | null>(null);
  const [keyType, setKeyType] = useState<StoreOwnedPixKeyType>('email');
  const [key, setKey] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientCity, setRecipientCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async (): Promise<void> => {
    try {
      const next = await loadStoreOwnedPixConnectionStatus(user);
      setStatus(next);
      if (next.keyType) setKeyType(next.keyType);
      if (next.recipientName) setRecipientName(next.recipientName);
      if (next.recipientCity) setRecipientCity(next.recipientCity);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível consultar o Pix próprio.');
    }
  };

  useEffect(() => { void refresh(); }, [user.uid]);

  const save = async (): Promise<void> => {
    try {
      setBusy(true);
      setMessage('');
      const next = await saveStoreOwnedPixConnection(user, {
        keyType,
        key,
        recipientName,
        recipientCity,
      });
      setStatus(next);
      setKey('');
      setMessage('Pix próprio configurado para esta loja.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar o Pix próprio.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (): Promise<void> => {
    try {
      setBusy(true);
      setMessage('');
      await disableStoreOwnedPixConnection(user);
      await refresh();
      setMessage('Pix próprio desativado para novas cobranças.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível desativar o Pix próprio.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="store-owned-pix-receivables-card" className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">Recebimentos</span>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">Pix próprio</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
            Cadastre a chave da própria loja para o Kyrub gerar QR Code e Pix copia e cola com o valor calculado no servidor. A chave completa fica protegida no servidor e não é devolvida ao navegador após o cadastro.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 font-mono text-[8px] font-black uppercase ${status?.enabled ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-400'}`}>
          {status?.enabled ? 'Ativo' : status?.configured ? 'Desativado' : 'Não configurado'}
        </span>
      </div>

      {status?.configured && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-300">
          Chave cadastrada: <strong>{status.maskedKey || 'protegida'}</strong>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
          Tipo de chave
          <select
            value={keyType}
            onChange={event => setKeyType(event.target.value as StoreOwnedPixKeyType)}
            disabled={busy}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] normal-case text-white outline-none"
          >
            {KEY_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
          Chave Pix
          <input
            value={key}
            onChange={event => setKey(event.target.value)}
            disabled={busy}
            autoComplete="off"
            placeholder={status?.configured ? 'Informe novamente para atualizar' : 'Informe a chave'}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] normal-case text-white outline-none"
          />
        </label>
        <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
          Nome do recebedor
          <input
            value={recipientName}
            onChange={event => setRecipientName(event.target.value)}
            disabled={busy}
            maxLength={25}
            placeholder="Nome que aparecerá no Pix"
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] normal-case text-white outline-none"
          />
        </label>
        <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
          Cidade
          <input
            value={recipientCity}
            onChange={event => setRecipientCity(event.target.value)}
            disabled={busy}
            maxLength={15}
            placeholder="Cidade do recebedor"
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] normal-case text-white outline-none"
          />
        </label>
      </div>

      {message && <p className="mt-3 text-[10px] leading-relaxed text-slate-300" role="status">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !key.trim() || !recipientName.trim() || !recipientCity.trim()}
          onClick={() => void save()}
          className="min-h-11 rounded-xl bg-emerald-400 px-4 text-[10px] font-black uppercase text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status?.configured ? 'Salvar nova configuração' : 'Ativar Pix próprio'}
        </button>
        {status?.enabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void disable()}
            className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
          >
            Desativar novas cobranças
          </button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[9px] leading-relaxed text-amber-100/80">
        No Pix próprio, gerar o QR Code não confirma pagamento. Na primeira versão, o Kyrub só marcará como recebido quando um operador autorizado declarar que conferiu o crédito na conta ou aplicativo da instituição recebedora. Essa confirmação fica auditada e não é apresentada como verificação bancária.
      </div>
    </section>
  );
}

export function StoreOwnedPixReceivablesBridge() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let created: HTMLDivElement | null = null;
    const sync = (): void => {
      if (cancelled) return;
      if (created && !created.isConnected) { created = null; setHost(null); }
      const anchor = document.getElementById('mercado-pago-receivables-card');
      if (!created && anchor?.parentElement) {
        created = document.createElement('div');
        created.id = 'kyrub-store-owned-pix-integrations-host';
        anchor.insertAdjacentElement('afterend', created);
        setHost(created);
      }
      timer = window.setTimeout(sync, 120);
    };
    sync();
    return () => { cancelled = true; window.clearTimeout(timer); created?.remove(); setHost(null); };
  }, []);

  return host && user ? createPortal(<StoreOwnedPixPanel user={user} />, host) : null;
}
