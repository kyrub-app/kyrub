import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  KYRUB_LORA_FRAME_MAX_BYTES, KYRUB_LORA_MAX_TTL_SECONDS,
  inspectRadioEnvelopeShape,
} from '../shared/kyrubDeviceLinkContract';
import {
  KYRUB_LOCAL_DEVICE_LIMIT,
  loadLocalDeviceDrafts,
  normalizeDeviceLabel,
  parseLocalDeviceDrafts,
  saveLocalDeviceDrafts,
  type LocalKyrubDeviceDraft,
  loadLocalSmartphone, prepareLocalSmartphone, saveLocalSmartphone,
  removeLocalSmartphone, parseLocalSmartphone,
} from '../src/utils/kyrubDeviceDrafts';

const read = (path: string) => readFileSync(path, 'utf8');
const draft: LocalKyrubDeviceDraft = {
  id: 'test_device_00001',
  label: 'Meu chaveiro',
  kind: 'lora_link',
  createdAt: '2026-11-21T14:00:00.000Z',
};
const fakeStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('Central Pessoal renders Conquistas and Dispositivos side by side below finance cards', () => {
  const profile = read('src/components/modals/UserProfileModal.tsx');
  const cards = profile.slice(profile.indexOf('const financeCards = ['), profile.indexOf('] as const;', profile.indexOf('const financeCards = [')));
  const ids = [...cards.matchAll(/\{ id: '(\w+)'/g)].map(item => item[1]);
  assert.deepEqual(ids, ['movements', 'finance', 'xp', 'devices', 'challenges']);
  assert.match(cards, /id: 'xp', label: 'Conquistas'/);
  assert.match(cards, /id: 'devices', label: 'Dispositivos'/);
  assert.match(cards, /icon: KyrubCocarIcon/);
  assert.match(cards, /icon: RadioTower/);
  assert.match(profile, /card\.id === 'challenges' \? 'col-span-2' : ''/);
  assert.doesNotMatch(profile, /card\.id === 'xp' \? 'col-span-2'/);
  assert.match(profile, /personalPanel === 'xp' && <PitangaAccount mode="xp"/);
  assert.match(profile, /personalPanel === 'devices' && <KyrubDevicesPanel userId=\{currentUserId\}/);
  assert.match(profile, /PlatformChallengesPanel/);
});

test('offline drafts are per-account, bounded, validated and never hold NFC payloads or credentials', () => {
  const storage = fakeStorage();
  saveLocalDeviceDrafts(storage, 'first_user', [draft]);
  assert.deepEqual(loadLocalDeviceDrafts(storage, 'first_user'), [draft]);
  assert.deepEqual(loadLocalDeviceDrafts(storage, 'another_user'), []);
  assert.equal(storage.values.size, 1);
  assert.ok([...storage.values.keys()][0].endsWith('first_user'));
  assert.equal(normalizeDeviceLabel('  Chaveiro  do  usuário  '), 'Chaveiro do usuário');
  assert.deepEqual(parseLocalDeviceDrafts('invalid JSON'), []);
  assert.deepEqual(parseLocalDeviceDrafts('{}'), []);
  assert.deepEqual(parseLocalDeviceDrafts(JSON.stringify([draft, draft])), [draft]);
  assert.deepEqual(parseLocalDeviceDrafts(JSON.stringify([{ ...draft, kind: 'unknown' }])), []);
  assert.deepEqual(parseLocalDeviceDrafts(JSON.stringify([{ ...draft, id: '../../admin' }])), []);
  assert.deepEqual(parseLocalDeviceDrafts(JSON.stringify([{ ...draft, lastNfcReadAt: '2026-11-21T14:01:00Z' }])), []);
  assert.throws(() => saveLocalDeviceDrafts(storage, '../../admin', [draft]), /DEVICE_USER_REQUIRED/);
  assert.throws(() => saveLocalDeviceDrafts(storage, 'first_user', Array(KYRUB_LOCAL_DEVICE_LIMIT + 1).fill(draft)), /DEVICE_DRAFT_INVALID/);
  assert.doesNotMatch(storage.values.get('kyrub_device_preparations_v1_first_user')!, /token|secret|uid|serialNumber|gps|privateKey/);
});

test('NFC read stays browser-initiated, non-authoritative and has no hidden hardware pairing or grant', () => {
  const ui = read('src/components/KyrubDevicesPanel.tsx');
  assert.match(ui, /NDEFReader/);
  assert.match(ui, /reader\.scan\(\{ signal: controller\.signal \}\)/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /event\.message\?\.records\?\.length/);
  assert.match(ui, /sem vínculo oficial/);
  assert.match(ui, /Integração de hardware pendente; rádio não conectado/);
  assert.match(ui, /Leitura Web NFC indisponível/);
  assert.match(ui, /Nenhum registro local habilita SOS, localização, rádio, pagamentos ou acesso à conta/);
  assert.doesNotMatch(ui, /\.write\(|makeReadOnly\(|requestDevice\(|\.connect\(|\.set\(|fetch\(/);
  assert.doesNotMatch(read('src/utils/kyrubDeviceDrafts.ts'), /serialNumber|ndefData|deviceSecret|bluetoothKey/);
});

const validRadioEnvelope = {
  version: 1,
  eventId: 'evt_123456789012',
  originDeviceId: 'dev_123456789012',
  kind: 'heartbeat',
  emittedAt: '2026-11-21T14:00:00Z',
  ttlSeconds: 30,
  sequence: 1,
  payloadBase64url: '',
  signatureBase64url: 'A'.repeat(86),
};

test('LoRa transport contract blocks oversized, privileged and unsigned frames', () => {
  assert.deepEqual(inspectRadioEnvelopeShape(validRadioEnvelope), validRadioEnvelope);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, kind: 'payment' }), /RADIO_FRAME_INVALID/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, kind: 'xp_grant' }), /RADIO_FRAME_INVALID/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, signatureBase64url: '' }), /RADIO_FRAME_INVALID/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, ttlSeconds: KYRUB_LORA_MAX_TTL_SECONDS + 1 }), /RADIO_FRAME_INVALID/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, payloadBase64url: 'A'.repeat(Math.ceil(KYRUB_LORA_FRAME_MAX_BYTES * 4 / 3) + 1) }), /RADIO_FRAME_TOO_LARGE/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, userName: 'person' }), /RADIO_FRAME_INVALID/);
  assert.throws(() => inspectRadioEnvelopeShape({ ...validRadioEnvelope, originDeviceId: '../../users' }), /RADIO_FRAME_INVALID/);
});


test('smartphone preparation is local, idempotent, account-scoped, and separate from accessories', () => {
  const storage = fakeStorage();
  const now = '2026-11-21T14:00:00.000Z';
  const phone = prepareLocalSmartphone(storage, 'first_user', 'phone_local_0001', now);
  assert.deepEqual(prepareLocalSmartphone(storage, 'first_user', 'phone_local_0002', now), phone);
  assert.equal(loadLocalSmartphone(storage, 'another_user'), null);
  saveLocalDeviceDrafts(storage, 'first_user', [draft]);
  saveLocalSmartphone(storage, 'first_user', { ...phone, lastNfcReadAt: now });
  assert.equal(loadLocalSmartphone(storage, 'first_user')?.lastNfcReadAt, now);
  assert.deepEqual(loadLocalDeviceDrafts(storage, 'first_user'), [draft]);
  assert.equal(parseLocalSmartphone('invalid JSON'), null);
  assert.equal(parseLocalSmartphone(JSON.stringify({ ...phone, lastNfcReadAt: 'not a date' })), null);
  assert.throws(() => prepareLocalSmartphone(storage, '../../admin', 'phone_local_0003', now), /DEVICE_USER_REQUIRED/);
  assert.deepEqual(parseLocalSmartphone(JSON.stringify({ ...phone, secret: 'never read' })), phone);
  removeLocalSmartphone(storage, 'first_user');
  assert.equal(loadLocalSmartphone(storage, 'first_user'), null);
  assert.deepEqual(loadLocalDeviceDrafts(storage, 'first_user'), [draft]);
});

test('smartphone NFC phase zero is a user-initiated reader test, never HCE emulation or hardware registration', () => {
  const ui = read('src/components/KyrubDevicesPanel.tsx');
  const profile = read('src/components/modals/UserProfileModal.tsx');
  assert.match(ui, /id="personal-smartphone-device"/);
  assert.match(ui, /Primeiro dispositivo Kairub · Fase zero/);
  assert.match(ui, /onClick=\{preparePhone\}/);
  assert.match(ui, /onClick=\{\(\) => void readNfc\(SMARTPHONE_SCAN_ID\)\}/);
  assert.match(ui, /API disponível; hardware a confirmar/);
  assert.match(ui, /Requer integração nativa Android \(HCE\)/);
  assert.match(ui, /reader\.onreading = event => \{/);
  assert.match(ui, /if \(isPhoneTest\) \{[\s\S]*?saveLocalSmartphone\(window\.localStorage, userId, next\)/);
  assert.match(ui, /Leitor NFC iniciado\. Aproxime uma tag para confirmar/);
  assert.match(profile, /<KyrubDevicesPanel userId=\{currentUserId\} key=\{currentUserId\}/);
  assert.ok(ui.indexOf('id="personal-smartphone-device"') < ui.indexOf('Kyrub Tag · NFC</h5>'));
});
