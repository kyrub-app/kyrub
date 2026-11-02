import { adminDb } from '../server/firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../server/ai/consultantAuth.js';
import { assertKyrubRewardLedgerEntry, kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../shared/gamification.js';

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { setHeader(name: string, value: string): void; status(code: number): Res; json(body: unknown): void };
const first = (v: string | string[] | undefined): string => Array.isArray(v) ? v[0] ?? '' : v ?? '';

export default async function handler(request: Req, response: Res): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const token = /^Bearer\s+(.+)$/i.exec(first(request.headers.authorization ?? request.headers.Authorization))?.[1]?.trim();
  if (!token) {
    response.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  try {
    const actor = await verifyFirebaseIdToken(token);
    const snapshot = await adminDb.collection(`users/${actor.uid}/rewardLedger`).get();
    const entries: KyrubRewardLedgerEntry[] = snapshot.docs.map(doc => {
      const entry = doc.data() as KyrubRewardLedgerEntry;
      if (entry.userId !== actor.uid || doc.id !== entry.id) throw new Error('REWARD_LEDGER_SCOPE_INVALID');
      return assertKyrubRewardLedgerEntry(entry);
    });
    response.status(200).json({
      schemaVersion: 1,
      unit: 'selos_kairubi',
      balance: kyrubKCoinBalance(entries),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/AUTH|TOKEN|ID_TOKEN/i.test(message)) {
      response.status(401).json({ error: 'AUTH_INVALID' });
      return;
    }
    console.error('[selos-kairubi-balance]', message);
    response.status(503).json({ error: 'BALANCE_UNAVAILABLE' });
  }
}
