import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bluetooth, CheckCircle2, CircleHelp, Nfc, RadioTower, ScanLine, Trash2, WifiOff } from 'lucide-react';
import type { KyrubDeviceKind } from '../../shared/kyrubDeviceLinkContract';
import {
  KYRUB_LOCAL_DEVICE_LIMIT, loadLocalDeviceDrafts, normalizeDeviceLabel,
  saveLocalDeviceDrafts, type LocalKyrubDeviceDraft,
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

const storageMessage = 'Não foi possível guardar a preparação neste aparelho. Verifique o armazenamento do navegador.';

export function KyrubDevicesPanel({ userId }: { userId: string }) {
  const [devices, setDevices] = useState<LocalKyrubDeviceDraft[]>([]);
  const devicesRef = useRef<LocalKyrubDeviceDraft[]>([]);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<KyrubDeviceKind>('nfc_tag');
  const [notice, setNotice] = useState('');
  const [readingId, setReadingId] = useState('');
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
      setNotice('');
    } catch {
      devicesRef.current = [];
      setDevices([]);
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

  const readNfc = async (id: string) => {
    const draft = devicesRef.current.find(item => item.id === id && item.kind === 'nfc_tag');
    if (!draft || !userId) return;
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
        if (!event.message?.records?.length) {
          setNotice('Uma tag foi detectada, mas não há registros NDEF legíveis. Ela não foi vinculada.');
          stopReading();
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
    <div id="personal-devices-panel" className="space-y-4 text-slate-200">
      <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-3">
        <h5 className="text-sm font-bold text-orange-200">Seu espaço de dispositivos</h5>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          Prepare tags NFC e chaveiros Kyrub Link para identificação e futuras comunicações offline.
          A preparação fica neste celular; ainda não representa pareamento ou autorização pela plataforma.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 p-3">
          <Nfc className="h-5 w-5 text-orange-300" aria-hidden="true" />
          <h5 className="mt-2 text-sm font-bold">Kyrub Tag · NFC</h5>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Identificação por aproximação. O Chrome para Android pode ler tags NDEF sem internet.
          </p>
          <p className="mt-2 text-xs font-semibold text-orange-200">
            {nfcSupported ? 'Leitura disponível neste navegador*' : 'Leitura NFC não disponível neste navegador'}
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
                <button type="button" onClick={() => void readNfc(device.id)} disabled={!nfcSupported || !!readingId}
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
  );
}
