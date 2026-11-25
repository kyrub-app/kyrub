import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';

export const SEMEADURA_RELEASE_CONTROL_PATH='systemControl/semeaduraReleasePilot';
const project='demo-kyrub-welcome',epoch='welcome-emulator-only';

/** Isolated acceptance contract only. Never opens production, even with a
 * copied Firestore record or environment flag. No API for changing the gate.
 * All required reads precede the accepted-seed writes in the same transaction. */
export async function assertSemeaduraReleaseOpenInTransaction(db:Firestore,tx:Transaction,now:Date){
 if(!semeaduraEconomicPilotEnabled(db)||process.env.KYRUB_SEMEADURA_RELEASE_CONTROL_PILOT!=='true')
  throw Error('SEMEADURA_RELEASE_UNAVAILABLE');
 const [control,fence]=await Promise.all([
  tx.get(db.doc(SEMEADURA_RELEASE_CONTROL_PATH)),
  tx.get(db.doc('systemControl/pitangaLegacyWriterFence')),
 ]);
 const value=control.data();
 if(!value||value.schemaVersion!==1||value.projectId!==project||value.epoch!==epoch||
    value.mode!=='isolated-pilot'||value.status!=='open'||
    typeof value.opensAt!=='string'||!Number.isFinite(Date.parse(value.opensAt))||
    Date.parse(value.opensAt)>now.getTime()||
    !Number.isSafeInteger(value.revision)||value.revision<1||
    fence.get('status')!=='fenced'||fence.get('writersVerified')!==true||fence.get('epoch')!==epoch)
  throw Error('SEMEADURA_RELEASE_UNAVAILABLE');
}
