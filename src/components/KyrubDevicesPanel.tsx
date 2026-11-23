import { OfficialKyrubTagPanel } from './OfficialKyrubTagPanel';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bluetooth, CheckCircle2, CircleHelp, Nfc, RadioTower, ScanLine, Smartphone, Trash2, WifiOff } from 'lucide-react';
import { KyrubBusinessCard } from './KyrubBusinessCard';
import type { KyrubDeviceKind } from '../../shared/kyrubDeviceLinkContract';
import {
  KYRUB_LOCAL_DEVICE_LIMIT, loadLocalDeviceDrafts, normalizeDeviceLabel,
  saveLocalDeviceDrafts, type LocalKyrubDeviceDraft,
  loadLocalSmartphone, prepareLocalSmartphone, saveLocalSmartphone, removeLocalSmartphone,
  type LocalSmartphonePreparation,
} from '../utils/kyrubDeviceDrafts';

type NfcReading = { message?: { records?: ReadonlyArray<unknown> } };
type BrowserNdefReader = {
  scan(options: { signal: AbortSignal }): Promise<void>;
  onreading: ((event: NfcReading) => void) | null;
  onreadingerror: (() => void) | null;
};
type NfcWindow = Window & { NDEFReader?: new () => BrowserNdefReader };

const kindLabel = (kind: KyrubDeviceKind) =>
  kind === 'nfc_tag' ? 'Kyrub Tag · NFC' : 'Kyrub Link · LoRa';

const SMARTPHONE_SCAN_ID = 'smartphone-local-reader';

const storageMessage = 'Não foi possível guardar a preparação neste aparelho. Verifique o armazenamento do navegador.';

export function KyrubDevicesPanel({ userId }: { userId: string }) {
  const [phone, setPhone] = useState<LocalSmartphonePreparation | null>(null);
  const phoneRef = useRef<LocalSmartphonePreparation | null>(null);
  const [devices, setDevices] = useState<LocalKyrubDeviceDraft[]>([]);
  const devicesRef = useRef<LocalKyrubDeviceDraft[]>([]);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<KyrubDeviceKind>('nfc_tag');
  const [notice, setNotice] = useState('');
  const [readingId, setReadingId] = useState('');
  const [cardWriting, setCardWriting] = useState(false);
  const scanner = useRef<AbortController | null>(null);

  const nfcSupported = typeof window !== 'undefined' && window.isSecureContext &&
    typeof (window as NfcWindow).NDEFReader === 'function';
  const bleBrowserSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  useEffect(() => {
    scanner.current?.abort();
    scanner.current = null;
    setReadingId('');
    try {
      const loaded = userId ? loadLocalDeviceDrafts(window.localStorage, userId) : [];
      devicesRef.current = loaded;
      setDevices(loaded);
      const prepared = userId ? loadLocalSmartphone(window.localStorage, userId) : null;
      phoneRef.current = prepared;
      setPhone(prepared);
      setNotice('');
    } catch {
      devicesRef.current = [];
      setDevices([]);
      phoneRef.current = null;
      setPhone(null);
      setNotice('O armazenamento offline deste navegador está indisponível.');
    }
    return () => {
      scanner.current?.abort();
      scanner.current = null;
    };
  }, [userId]);

  const persist = useCallback((next: LocalKyrubDeviceDraft[]): boolean => {
    try {
      saveLocalDeviceDrafts(window.localStorage, userId, next);
      devicesRef.current = next;
      setDevices(next);
      return true;
    } catch {
      setNotice(storageMessage);
      return false;
    }
  }, [userId]);

  const createDevice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) {
      setNotice('Entre na conta Kyrub para preparar dispositivos.');
      return;
    }
    const name = normalizeDeviceLabel(label);
    if (!name || devicesRef.current.length >= KYRUB_LOCAL_DEVICE_LIMIT) return;
    const next: LocalKyrubDeviceDraft = {
      id: crypto.randomUUID(),
      label: name,
      kind,
      createdAt: new Date().toISOString(),
    };
    if (persist([...devicesRef.current, next])) {
      setLabel('');
      setNotice('Preparação salva somente neste aparelho. O dispositivo ainda não está vinculado à sua conta.');
    }
  };

  const removeDevice = (id: string) => {
    if (readingId === id) {
      scanner.current?.abort();
      scanner.current = null;
      setReadingId('');
    }
    if (persist(devicesRef.current.filter(device => device.id !== id))) {
      setNotice('Preparação local excluída. Nenhum dispositivo remoto foi modificado.');
    }
  };

  const stopReading = () => {
    scanner.current?.abort();
    scanner.current = null;
    setReadingId('');
    setNotice('Leitura NFC encerrada.');
  };

  const preparePhone = () => {
    if (!userId) return;
    try {
      const record = prepareLocalSmartphone(window.localStorage, userId, crypto.randomUUID(), new Date().toISOString());
      phoneRef.current = record;
      setPhone(record);
      setNotice('Smartphone preparado neste navegador. O NFC ainda precisa ser testado.');
    } catch { setNotice(storageMessage); }
  };

  const removePhone = () => {
    if (!userId) return;
    if (readingId === SMARTPHONE_SCAN_ID) stopReading();
    try {
      removeLocalSmartphone(window.localStorage, userId);
      phoneRef.current = null;
      setPhone(null);
      setNotice('Preparação do smartphone removida deste navegador. O NFC do aparelho não foi alterado.');
    } catch { setNotice(storageMessage); }
  };

  const readNfc = async (id: string) => {
    const isPhoneTest = id === SMARTPHONE_SCAN_ID;
    const draft = devicesRef.current.find(item => item.id === id && item.kind === 'nfc_tag');
    if (cardWriting || !userId || (isPhoneTest ? !phoneRef.current : !draft)) return;
    if (!nfcSupported) {
      setNotice('Leitura Web NFC indisponível: use Chrome no Android, em HTTPS, num aparelho com NFC.');
      return;
    }
    stopReading();
    const controller = new AbortController();
    scanner.current = controller;
    setReadingId(id);
    setNotice('Aproxime sua tag NFC do celular. Leitura somente; nenhuma gravação será feita.');
    try {
      const Reader = (window as NfcWindow).NDEFReader!;
      const reader = new Reader();
      reader.onreading = event => {
        if (controller.signal.aborted || scanner.current !== controller) return;
        // A real read event confirms proximity, even for a blank NDEF tag.
        // It does not prove ownership of the tag or authenticate the phone.
        if (isPhoneTest) {
          const current = phoneRef.current;
          if (current) {
            try {
              const next = { ...current, lastNfcReadAt: new Date().toISOString() };
              saveLocalSmartphone(window.localStorage, userId, next);
              phoneRef.current = next;
              setPhone(next);
              setNotice('Teste NFC confirmado por aproximação. Nenhum conteúdo da tag foi salvo.');
            } catch { setNotice(storageMessage); }
          }
          controller.abort();
          scanner.current = null;
          setReadingId('');
          return;
        }
        if (!event.message?.records?.length) {
          controller.abort();
          scanner.current = null;
          setReadingId('');
          setNotice('Uma tag foi detectada, mas não há registros NDEF legíveis. Ela não foi vinculada.');
          return;
        }
        const readAt = new Date().toISOString();
        const next = devicesRef.current.map(item =>
          item.id === id ? { ...item, lastNfcReadAt: readAt } : item);
        if (persist(next)) {
          setNotice('Tag NFC lida neste aparelho. A identidade e a propriedade ainda não foram verificadas pelo Kyrub.');
        }
        controller.abort();
        scanner.current = null;
        setReadingId('');
      };
      reader.onreadingerror = () => {
        if (controller.signal.aborted) return;
        setNotice('Falha na leitura NDEF. Reaproxime a tag ou encerre a leitura.');
      };
      await reader.scan({ signal: controller.signal });
      if (isPhoneTest && !controller.signal.aborted && scanner.current === controller) {
        setNotice('Leitor NFC iniciado. Aproxime uma tag para confirmar o funcionamento.');
      }
    } catch {
      if (!controller.signal.aborted) {
        setNotice('Não foi possível iniciar a leitura NFC. Verifique permissões, NFC ativo e compatibilidade.');
      }
      if (scanner.current === controller) {
        scanner.current = null;
        setReadingId('');
      }
    }
  };

  return (
    <div id="personal-devices-panel" className="space-y-3 text-slate-200">
      <header className="space-y-1 pb-1">
        <h4 className="text-lg font-bold text-white">Meus dispositivos</h4>
        <p className="text-sm text-slate-300">Personalize seus acessórios oficiais ou compartilhe seu cartão digital.</p>
      </header>
      <OfficialKyrubTagPanel key={'official-'+userId} userId={userId} />

      <details className="rounded-xl border border-[#34443B] bg-[#121A17] p-3">
        <summary className="cursor-pointer text-base font-bold text-white">Meu cartão digital e vitrines</summary>
        <p className="mt-2 text-sm text-slate-300">Compartilhe perfil, lojas e comunidades sem precisar de uma tag física.</p>
        <div className="mt-3">
          <KyrubBusinessCard key={userId} userId={userId} nfcSupported={nfcSupported} busy={!!readingId} onWriting={setCardWriting} />
        </div>
      </details>

      <details className="rounded-xl border border-[#34443B] bg-[#121A17] p-3">
        <summary className="cursor-pointer text-base font-bold text-white">Meu smartphone · {phone?.lastNfcReadAt?'NFC testado':'Configurar NFC'}</summary>
        <div className="mt-3">
      <section id="personal-smartphone-device" className="min-w-0 space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Smartphone className="h-7 w-7 shrink-0 text-orange-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h5 className="text-sm font-bold text-white">Meu smartphone</h5>
            <p className="mt-1 text-xs text-orange-200">Primeiro dispositivo Kairub · Fase zero</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">
          Use o NFC do próprio aparelho para ler tags por aproximação. Ative o NFC nas configurações do Android, se necessário.
        </p>
        <div className="space-y-2 border-t border-slate-800 pt-3 text-sm">
          <p className="text-slate-300">Preparação: <strong className="text-orange-200">{phone ? 'Salva neste navegador' : 'Ainda não preparada'}</strong></p>
          <p className="text-slate-300">Leitor NFC: <strong className={nfcSupported && phone?.lastNfcReadAt ? 'text-emerald-300' : 'text-orange-200'}>
            {nfcSupported
              ? (phone?.lastNfcReadAt ? 'Funcionamento confirmado no último teste' : 'API disponível; hardware a confirmar')
              : 'API Web NFC indisponível neste navegador'}
          </strong></p>
          {phone?.lastNfcReadAt && <p className="break-words text-emerald-300">
            Último teste por aproximação: {new Date(phone.lastNfcReadAt).toLocaleString('pt-BR')}
          </p>}
          <p className="text-slate-300">Identidade NFC digital: <strong className="text-amber-200">Requer integração nativa Android (HCE)</strong></p>
          <p className="text-xs leading-relaxed text-slate-400">
            A preparação é local e não identifica fisicamente o telefone, não habilita NFC automaticamente e não cria vínculo oficial com a conta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!phone ? <button type="button" disabled={!userId} onClick={preparePhone}
            className="min-h-11 rounded-xl border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-sm font-bold text-orange-200 disabled:opacity-50">
            Preparar meu smartphone
          </button> : <>
            {readingId === SMARTPHONE_SCAN_ID ? <button type="button" onClick={stopReading}
              className="min-h-11 rounded-xl border border-amber-500/50 px-3 py-2 text-sm font-bold text-amber-200">
              Cancelar teste NFC
            </button> : <button type="button" disabled={!nfcSupported || !!readingId || cardWriting}
              onClick={() => void readNfc(SMARTPHONE_SCAN_ID)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-orange-500/50 px-3 py-2 text-sm font-bold text-orange-200 disabled:opacity-50">
              <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" /> Testar NFC
            </button>}
            <button type="button" onClick={removePhone}
              className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300">
              Remover preparação
            </button>
          </>}
        </div>
        {!nfcSupported && <p className="text-xs leading-relaxed text-slate-400">
          Para testar, abra o Kyrub no Chrome para Android, em HTTPS, num aparelho com NFC.
        </p>}
        {readingId === SMARTPHONE_SCAN_ID && <p role="status" className="text-sm text-orange-200">Aproxime uma tag NFC do smartphone.</p>}
        {notice && (readingId === SMARTPHONE_SCAN_ID || phone) && <p className="break-words text-xs text-slate-300">{notice}</p>}
      </section>
        </div>
      </details>

      <details className="rounded-xl border border-[#34443B] bg-[#121A17] p-3">
        <summary className="cursor-pointer text-base font-bold text-white">Tecnologias e ferramentas avançadas</summary>
        <p className="mt-2 text-sm text-slate-300">Testes locais, NFC e pesquisas LoRa. Registros preparados neste navegador não são tags oficiais vinculadas.</p>
        <div className="mt-3 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 p-3">
          <Nfc className="h-5 w-5 text-orange-300" aria-hidden="true" />
          <h5 className="mt-2 text-sm font-bold">Kyrub Tag · NFC</h5>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Identificação por aproximação. O Chrome para Android pode ler tags NDEF sem internet.
          </p>
          <p className="mt-2 text-xs font-semibold text-orange-200">
            {nfcSupported ? 'API Web NFC disponível; teste o aparelho*' : 'Leitura NFC não disponível neste navegador'}
          </p>
        </section>
        <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 p-3">
          <RadioTower className="h-5 w-5 text-orange-300" aria-hidden="true" />
          <h5 className="mt-2 text-sm font-bold">Kyrub Link · LoRa</h5>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            O rádio de longo alcance fica no chaveiro e em outros nós ou gateways compatíveis.
          </p>
          <p className="mt-2 text-xs font-semibold text-amber-200">
            Integração de hardware pendente; rádio não conectado
          </p>
        </section>
      </div>

      <div className="rounded-xl border border-slate-700 p-3">
        <h5 className="text-sm font-bold">Preparar um dispositivo</h5>
        <p className="mt-1 text-sm text-slate-400">Organize seus dispositivos no próprio aparelho, inclusive offline.</p>
        <form onSubmit={createDevice} className="mt-3 space-y-3">
          <label className="block text-sm text-slate-300">
            Nome para identificar
            <input type="text" value={label} onChange={event => setLabel(event.target.value)}
              maxLength={48} placeholder="Ex.: Chaveiro pessoal"
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-950 px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-orange-400" />
          </label>
          <label className="block text-sm text-slate-300">
            Tipo
            <select value={kind} onChange={event => setKind(event.target.value as KyrubDeviceKind)}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-950 px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-orange-400">
              <option value="nfc_tag">Tag NFC</option>
              <option value="lora_link">Chaveiro Kyrub Link (LoRa)</option>
            </select>
          </label>
          <button type="submit" disabled={!userId || !label.trim() || devices.length >= KYRUB_LOCAL_DEVICE_LIMIT}
            className="min-h-11 rounded-xl border border-orange-500/50 bg-orange-500/10 px-4 text-sm font-bold text-orange-200 disabled:opacity-50">
            Salvar preparação local
          </button>
        </form>
      </div>

      <div aria-live="polite" role="status" className="text-sm leading-relaxed text-slate-300">{notice}</div>

      <section aria-label="Dispositivos preparados" className="space-y-2">
        <h5 className="text-sm font-bold text-white">Dispositivos preparados neste aparelho ({devices.length})</h5>
        {!devices.length && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          Nenhum dispositivo preparado ainda. Crie um registro local acima para começar.
        </p>}
        {devices.map(device => (
          <div key={device.id} className="rounded-xl border border-slate-700 bg-slate-950 p-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <strong className="block break-words text-sm text-white">{device.label}</strong>
                <span className="block text-xs text-slate-400">{kindLabel(device.kind)}</span>
                <span className="mt-1 block text-xs text-amber-200">Preparação local · sem vínculo oficial</span>
                {device.lastNfcReadAt && <span className="mt-1 block text-xs text-emerald-300">
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  Leitura NFC: {new Date(device.lastNfcReadAt).toLocaleString('pt-BR')}
                </span>}
              </div>
              <button type="button" onClick={() => removeDevice(device.id)}
                aria-label={`Excluir preparação de ${device.label}`}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:text-red-300">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {device.kind === 'nfc_tag' && <div className="mt-3">
              {readingId === device.id ?
                <button type="button" onClick={stopReading}
                  className="min-h-10 rounded-lg border border-amber-500/50 px-3 text-sm font-bold text-amber-200">
                  Cancelar leitura NFC
                </button> :
                <button type="button" onClick={() => void readNfc(device.id)} disabled={!nfcSupported || !!readingId || cardWriting}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-orange-500/40 px-3 text-sm font-bold text-orange-200 disabled:opacity-50">
                  <ScanLine className="h-4 w-4" aria-hidden="true" /> Ler NFC
                </button>}
            </div>}
            {device.kind === 'lora_link' && <p className="mt-2 text-xs leading-relaxed text-slate-400">
              O cadastro de rádio e a comunicação dependerão do firmware, do pareamento seguro e de um rádio/ponte compatível.
            </p>}
          </div>
        ))}
      </section>

      <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm leading-relaxed text-slate-300">
        <p className="flex items-start gap-2">
          <Bluetooth className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
          Bluetooth LE no navegador: {bleBrowserSupported ? 'API disponível; aguardando protocolo do chaveiro' : 'API não disponível aqui'}.
        </p>
        <p className="flex items-start gap-2">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
          A lista preparada pode ser consultada offline neste aparelho. Não há sincronização entre aparelhos nesta etapa.
        </p>
        <p className="flex items-start gap-2">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
          Nenhum registro local habilita SOS, localização, rádio, pagamentos ou acesso à conta.
        </p>
        <p className="text-xs text-slate-400">
          *Web NFC exige navegador compatível, HTTPS, NFC ativo e sua permissão. O conteúdo e o número serial da tag nunca são salvos aqui.
        </p>
      </div>
        </div>
      </details>
    </div>
  );
}
