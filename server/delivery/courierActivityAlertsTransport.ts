import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { projectCourierActivityAlert, type CourierActivityAlert } from '../../shared/rendaActivityAlerts.js';
type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): unknown; status(code: number): { json(value: unknown): unknown } };
type Dependencies = { verify(token: string): Promise<{uid:string}>; list(uid: string): Promise<CourierActivityAlert[]> };
const defaults: Dependencies = {
  verify: token => adminAuth.verifyIdToken(token, true),
  list: async uid => {
    const result = await adminDb.collection('deliveryClaims').where('courierId','==',uid).limit(51).get();
    if (result.size > 50) throw new Error('COURIER_ACTIVITY_HISTORY_LIMIT');
    return result.docs.flatMap(doc => {
      const alert = projectCourierActivityAlert(doc.id, doc.data(), uid);
      return alert ? [alert] : [];
    });
  },
};
export async function handleCourierActivityAlerts(request: Request, response: Response, deps: Dependencies = defaults): Promise<void> {
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  if (request.method !== 'GET') { response.setHeader('Allow','GET'); response.status(405).json({error:'Método não permitido.'}); return; }
  const header = request.headers.authorization ?? request.headers.Authorization;
  const token = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() : '';
  if (!token) { response.status(401).json({error:'Entre novamente para consultar seus avisos.'}); return; }
  let uid: string;
  try { uid = (await deps.verify(token)).uid; if (!uid || uid.includes('/')) throw new Error('AUTH_REQUIRED'); }
  catch { response.status(401).json({error:'Não foi possível confirmar sua sessão.'}); return; }
  try { response.status(200).json({alerts:await deps.list(uid)}); }
  catch { response.status(503).json({error:'Avisos de entregas indisponíveis.'}); }
}
