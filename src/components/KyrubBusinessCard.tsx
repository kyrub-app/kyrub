import { MultifunctionCardEditor } from './MultifunctionCardEditor';
import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Nfc, Share2, Smartphone } from 'lucide-react';
import { confirmedPublicCard, publicBusinessCardUrl, publicStoreCardMessage, type PublicCardInfo } from '../utils/publicBusinessCard';
import { parsePublicDestinationUrl } from '../../shared/publicDestinationRoutes';
type Writer = { write(message: ReturnType<typeof publicStoreCardMessage>, options: { overwrite: false; signal: AbortSignal }): Promise<void> };
type WriteWindow = Window & { NDEFReader?: new () => Writer };
export function KyrubBusinessCard({ userId, nfcSupported, busy, onWriting }: {
  userId: string; nfcSupported: boolean; busy: boolean; onWriting: (active: boolean) => void;
}) {
  const [input, setInput] = useState('');
  const [card, setCard] = useState<PublicCardInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');
  const check = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; check.current?.abort(); writer.current?.abort(); };
  }, []);
  const verify = async () => {
    const url = publicBusinessCardUrl(input);
    if (!url || !userId) { setNotice('Informe o @ da loja ou seu endereço público kyrub.com/@loja.'); return; }
    check.current?.abort();
    const controller = new AbortController();
    check.current = controller;
    setCard(null); setChecking(true); setNotice('');
    try {
      const slug = url.slice('https://kyrub.com/@'.length);
      const response = await fetch(`/api/marketplace-discovery/public/${encodeURIComponent(slug)}`, {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw Error('PUBLIC_STORE_UNAVAILABLE');
      const verified = confirmedPublicCard(url, await response.json());
      if (!verified) throw Error('PUBLIC_STORE_UNAVAILABLE');
      if (!controller.signal.aborted && active.current) {
        setCard(verified); setNotice('Vitrine pública encontrada. Confira o nome antes de compartilhar.');
      }
    } catch {
      if (!controller.signal.aborted && active.current) setNotice('Não foi possível confirmar a vitrine publicada. Verifique o endereço e a conexão.');
    } finally {
      if (check.current === controller && active.current) { check.current = null; setChecking(false); }
    }
  };
  const copy = async () => {
    if (!card) return;
    try { await navigator.clipboard.writeText(card.url); setNotice('Link copiado.'); }
    catch { setNotice('Selecione e copie o endereço exibido.'); }
  };
  const share = async () => {
    if (!card || !navigator.share) return;
    try { await navigator.share({ title: card.name, url: card.url }); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('Compartilhamento indisponível. Use Copiar link.'); }
  };
  const write = async () => {
    if (!card || !userId || !nfcSupported || busy || writer.current) return;
    const selected = card;
    const controller = new AbortController();
    writer.current = controller; setWriting(true); onWriting(true);
    setNotice('Aproxime uma tag NFC vazia e gravável. Nenhum conteúdo existente será sobrescrito.');
    try {
      const Reader = (window as WriteWindow).NDEFReader;
      if (!Reader) throw Error('NFC_UNAVAILABLE');
      await new Reader().write(parsePublicDestinationUrl(selected.url)?.kind === 'card' ? {records:[{recordType:'url',data:selected.url}]} : publicStoreCardMessage(selected.url), { overwrite: false, signal: controller.signal });
      if (!controller.signal.aborted && active.current) setNotice('Gravação NFC concluída. Aproxime um celular para confirmar a abertura do destino.');
    } catch {
      if (!controller.signal.aborted && active.current) setNotice('Não foi possível gravar. Use uma tag NDEF vazia, gravável e compatível; confira NFC e permissões.');
    } finally {
      if (writer.current === controller) { writer.current = null; if (active.current) { setWriting(false); onWriting(false); } }
    }
  };
  const cancel = () => {
    writer.current?.abort();
    writer.current = null; setWriting(false); onWriting(false);
    setNotice('Gravação cancelada. Se já aproximou a tag, confira o conteúdo antes de repetir.');
  };
  const locked = busy || writing;
  const button = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200 disabled:opacity-50';
  return <section id="personal-business-card" className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
    <h5 className="flex items-center gap-2 text-sm font-bold text-white"><Nfc className="h-5 w-5 shrink-0 text-orange-300" aria-hidden="true" /> Cartão de visita digital</h5>
    <p className="text-sm leading-relaxed text-slate-300">Compartilhe uma vitrine pública do Kyrub por link ou grave seu endereço em uma tag NFC física. Não é preciso vincular a tag à conta para divulgar uma loja.</p>
    <MultifunctionCardEditor userId={userId} locked={locked || checking} onSelect={setCard} />
    <h6 className="text-sm font-bold text-white">Compartilhar vitrine diretamente</h6>
    <label className="block text-sm text-slate-300">Endereço da loja
      <input value={input} maxLength={160} disabled={locked} placeholder="@minha-loja"
        onChange={e => { check.current?.abort(); check.current = null; setChecking(false); setInput(e.target.value); setCard(null); setNotice(''); }}
        className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 px-3 text-sm text-white" />
    </label>
    <button type="button" className={button} disabled={!userId || !input.trim() || checking || locked} onClick={() => void verify()}>{checking ? 'Consultando…' : 'Confirmar vitrine'}</button>
    {card && <div className="space-y-3 rounded-xl border border-slate-700 p-3">
      <strong className="block break-words text-sm text-white">{card.name}</strong>
      <a href={card.url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-orange-300 underline">{card.url} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden="true" /></a>
      <p className="text-xs text-slate-400">{parsePublicDestinationUrl(card.url)?.kind==='card'?'Cartão permanente selecionado.':'Endereço público verificado; isso não comprova propriedade da loja.'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={locked} onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden="true" /> Copiar link</button>
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && <button type="button" className={button} disabled={locked} onClick={() => void share()}><Share2 className="h-4 w-4" aria-hidden="true" /> Compartilhar</button>}
        {writing ? <button type="button" className={button} onClick={cancel}>Cancelar gravação</button> :
          <button type="button" className={button} disabled={!nfcSupported || locked} onClick={() => void write()}><Nfc className="h-4 w-4" aria-hidden="true" /> Gravar na tag NFC</button>}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">Somente tags vazias. Não use tags de pagamento, acesso ou de terceiros. O destinatário precisa de internet para carregar a loja atualizada.</p>
    </div>}
    <div role="status" aria-live="polite" className="text-sm leading-relaxed text-slate-300">{notice}</div>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" /> Celular como cartão NFC: depende de aplicativo Android nativo HCE e validação entre aparelhos. Esta versão web não transmite por aproximação entre celulares.</p>
  </section>;
}
