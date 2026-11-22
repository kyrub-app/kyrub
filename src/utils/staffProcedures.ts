import type {
  StaffPopAttachment,
  StaffProcedure,
  StaffProcedureRevision,
  StaffProcedureView,
} from '../../shared/staffProcedures';
import { STAFF_POP_MAX_ATTACHMENT_BYTES, STAFF_POP_ACCEPT } from '../../shared/staffProcedures';
import { auth } from './firebase';

const basePath = '/api/staff/pops';
const authenticatedFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const user = auth.currentUser;
  if (!user) throw Error('Entre novamente para acessar os procedimentos.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({})) as { error?: string };
    throw Error(json.error || 'Não foi possível concluir a operação.');
  }
  return response;
};
const requestJson = async <T>(path: string, body?: object): Promise<T> => {
  const response = await authenticatedFetch(path, body ? {
    method: 'POST', body: JSON.stringify(body),
  } : {});
  return response.json() as Promise<T>;
};

export const listStaffProcedures = async (storeId: string): Promise<StaffProcedureView[]> => {
  const payload = await requestJson<{ procedures: StaffProcedureView[] }>(
    basePath + '?storeId=' + encodeURIComponent(storeId)
  );
  return payload.procedures;
};

export const getStaffProcedureHistory = async (
  storeId: string, procedureId: string
): Promise<StaffProcedureRevision[]> => {
  const result = await requestJson<{ versions: StaffProcedureRevision[] }>(
    basePath + '/history?storeId=' + encodeURIComponent(storeId) +
    '&procedureId=' + encodeURIComponent(procedureId)
  );
  return result.versions;
};

export const publishStaffProcedure = async (input: {
  storeId: string;
  procedureId: string;
  requestId: string;
  expectedVersion: number;
  title: string;
  body: string;
  audienceRoles: string[];
  attachment: StaffPopAttachment | null;
  retainAttachment: boolean;
}): Promise<StaffProcedure> => {
  const response = await requestJson<{ procedure: StaffProcedure }>(basePath, input);
  return response.procedure;
};

export const confirmStaffProcedureRead = async (
  storeId: string, procedureId: string, version: number
): Promise<string> => {
  const result = await requestJson<{ readAt: string }>(basePath + '/read', {
    storeId, procedureId, version,
  });
  return result.readAt;
};

export const uploadStaffProcedureFile = async (input: {
  storeId: string;
  procedureId: string;
  requestId: string;
  file: File;
}): Promise<StaffPopAttachment> => {
  const { file } = input;
  if (!STAFF_POP_ACCEPT.split(',').includes(file.type) ||
      !file.size || file.size > STAFF_POP_MAX_ATTACHMENT_BYTES) {
    throw Error('Selecione PDF ou imagem de até 1,25 MB.');
  }
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Não foi possível ler o anexo.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const base64 = value.split(',')[1];
      if (!base64) reject(Error('Arquivo vazio.')); else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
  const response = await requestJson<{ attachment: StaffPopAttachment }>(basePath + '/upload', {
    storeId: input.storeId,
    procedureId: input.procedureId,
    requestId: input.requestId,
    name: file.name.slice(0, 160), mimeType: file.type, dataBase64,
  });
  return response.attachment;
};

export const downloadStaffProcedureFile = async (
  storeId: string, procedureId: string, version: number, filename: string
): Promise<void> => {
  const query = new URLSearchParams({ storeId, procedureId, version: String(version) });
  const response = await authenticatedFetch(basePath + '/file?' + query);
  const file = await response.blob();
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
