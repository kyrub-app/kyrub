import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth } from './firebase';
import {
  buildGoogleDriveImageUrl,
  type GoogleDriveImageSelection,
} from './googleDriveMedia';

const GOOGLE_PHOTOS_SCOPE =
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PHOTOS_API_BASE_URL = 'https://photospicker.googleapis.com/v1';
const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size';
const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_SESSION_TIMEOUT_MS = 2 * 60 * 1000;

type PhotosPollingConfig = {
  pollInterval?: string;
  timeoutIn?: string;
};

type PhotosPickingSession = {
  id?: string;
  pickerUri?: string;
  expireTime?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: PhotosPollingConfig;
};

type PickedMediaItem = {
  id?: string;
  type?: 'TYPE_UNSPECIFIED' | 'PHOTO' | 'VIDEO';
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
  };
};

type PickedMediaItemsResponse = {
  mediaItems?: PickedMediaItem[];
};

type DriveFileMetadata = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
};

class GooglePhotosApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly apiStatus: string
  ) {
    super(message);
    this.name = 'GooglePhotosApiError';
  }
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise(resolve => window.setTimeout(resolve, milliseconds));

const parseGoogleDurationMs = (
  value: string | undefined,
  fallback: number
): number => {
  const normalizedValue = value?.trim() ?? '';
  if (!normalizedValue.endsWith('s')) return fallback;
  const seconds = Number.parseFloat(normalizedValue.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : fallback;
};

const readGoogleApiError = async (
  response: Response,
  fallback: string
): Promise<GooglePhotosApiError> => {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
        status?: string;
        code?: number;
      };
    };
    const detail = payload.error?.message?.trim();
    return new GooglePhotosApiError(
      detail || fallback,
      response.status,
      payload.error?.status?.trim() ?? ''
    );
  } catch {
    return new GooglePhotosApiError(fallback, response.status, '');
  }
};

const requestPhotosAndDriveAccessToken = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login novamente antes de acessar o Google Fotos.');
  }

  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_PHOTOS_SCOPE);
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
    ...(user.email ? { login_hint: user.email } : {}),
  });

  const result = await reauthenticateWithPopup(user, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;

  if (!accessToken) {
    throw new Error(
      'O Google não forneceu autorização para importar a imagem.'
    );
  }

  return accessToken;
};

const photosRequest = async <T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init?.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${PHOTOS_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await readGoogleApiError(
      response,
      'O Google Fotos não permitiu concluir esta operação.'
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

const createPickingSession = async (
  accessToken: string
): Promise<PhotosPickingSession> => {
  try {
    return await photosRequest('/sessions', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        pickingConfig: {
          maxItemCount: '1',
        },
      }),
    });
  } catch (error) {
    const retryWithoutPickingConfig =
      error instanceof GooglePhotosApiError &&
      error.httpStatus === 400 &&
      (
        error.apiStatus === 'INVALID_ARGUMENT' ||
        /pickingConfig|maxItemCount/i.test(error.message)
      );

    if (!retryWithoutPickingConfig) throw error;

    console.warn(
      'Google Photos rejected the one-item picking configuration; retrying with the default session configuration.',
      {
        status: error.apiStatus || error.httpStatus,
        message: error.message,
      }
    );

    return photosRequest('/sessions', accessToken, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
};

const deletePickingSession = async (
  sessionId: string,
  accessToken: string
): Promise<void> => {
  try {
    await photosRequest(
      `/sessions/${encodeURIComponent(sessionId)}`,
      accessToken,
      { method: 'DELETE' }
    );
  } catch (error) {
    console.warn('Não foi possível encerrar a sessão do Google Fotos.', error);
  }
};

const pollPickingSession = async (
  initialSession: PhotosPickingSession,
  accessToken: string
): Promise<PhotosPickingSession> => {
  const sessionId = initialSession.id?.trim() ?? '';
  if (!sessionId) {
    throw new Error('O Google Fotos não retornou uma sessão válida.');
  }

  const startedAt = Date.now();
  let session = initialSession;
  let timeoutMs = parseGoogleDurationMs(
    session.pollingConfig?.timeoutIn,
    DEFAULT_SESSION_TIMEOUT_MS
  );
  if (timeoutMs <= 0) timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
  timeoutMs = Math.min(Math.max(timeoutMs, 30_000), 5 * 60 * 1000);

  while (Date.now() - startedAt < timeoutMs) {
    if (session.mediaItemsSet) return session;

    const intervalMs = Math.min(
      Math.max(
        parseGoogleDurationMs(
          session.pollingConfig?.pollInterval,
          DEFAULT_POLL_INTERVAL_MS
        ),
        750
      ),
      5000
    );
    await wait(intervalMs);

    session = await photosRequest<PhotosPickingSession>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      accessToken
    );

    if (session.mediaItemsSet) return session;
  }

  throw new Error(
    'A seleção no Google Fotos expirou ou foi fechada antes da conclusão. Tente novamente.'
  );
};

const downloadPickedPhoto = async (
  mediaItem: PickedMediaItem,
  accessToken: string
): Promise<{ blob: Blob; fileName: string }> => {
  const mediaFile = mediaItem.mediaFile;
  const baseUrl = mediaFile?.baseUrl?.trim() ?? '';
  const mimeType = mediaFile?.mimeType?.trim() ?? '';

  if (mediaItem.type === 'VIDEO' || !mimeType.startsWith('image/')) {
    throw new Error('Selecione uma foto, não um vídeo.');
  }
  if (!baseUrl) {
    throw new Error('O Google Fotos não retornou o conteúdo da foto.');
  }

  const response = await fetch(`${baseUrl}=d`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw await readGoogleApiError(
      response,
      'Não foi possível baixar a foto selecionada.'
    );
  }

  const declaredLength = Number.parseInt(
    response.headers.get('content-length') ?? '0',
    10
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('A foto precisa ter no máximo 10 MB.');
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('O item selecionado não é uma imagem válida.');
  }
  if (blob.size <= 0 || blob.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('A foto precisa ter entre 1 byte e 10 MB.');
  }

  return {
    blob,
    fileName: mediaFile?.filename?.trim() || `foto-kyrub-${Date.now()}.jpg`,
  };
};

const uploadPhotoCopyToDrive = async (
  blob: Blob,
  sourceFileName: string,
  accessToken: string
): Promise<GoogleDriveImageSelection> => {
  const safeFileName = sourceFileName.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const driveFileName = `Kyrub - ${safeFileName || `foto-${Date.now()}.jpg`}`;
  const boundary = `kyrub-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: driveFileName,
    mimeType: blob.type,
    description:
      'Imagem selecionada no Google Fotos e importada pelo Kyrub para uso público.',
    appProperties: {
      kyrubMedia: 'true',
      source: 'google_photos',
    },
  });
  const requestBody = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const uploadResponse = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: requestBody,
  });
  if (!uploadResponse.ok) {
    throw await readGoogleApiError(
      uploadResponse,
      'Não foi possível copiar a foto para o Google Drive.'
    );
  }

  const metadataResponse = (await uploadResponse.json()) as DriveFileMetadata;
  const fileId = metadataResponse.id?.trim() ?? '';
  if (!fileId) {
    throw new Error('O Google Drive não retornou o arquivo importado.');
  }

  const permissionResponse = await fetch(
    `${DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader',
        allowFileDiscovery: false,
      }),
    }
  );

  if (!permissionResponse.ok) {
    try {
      await fetch(`${DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Best-effort cleanup only.
    }
    throw await readGoogleApiError(
      permissionResponse,
      'Não foi possível publicar a cópia da foto.'
    );
  }

  return {
    provider: 'google_drive',
    fileId,
    fileName: metadataResponse.name?.trim() || driveFileName,
    mimeType: metadataResponse.mimeType?.trim() || blob.type,
    sizeBytes: Number.parseInt(metadataResponse.size ?? String(blob.size), 10),
    url: buildGoogleDriveImageUrl(fileId),
  };
};

export const pickGooglePhotosImageToDrive = async (): Promise<
  GoogleDriveImageSelection | null
> => {
  const pickerWindow = window.open(
    'about:blank',
    `kyrub-google-photos-${Date.now()}`,
    'popup=yes,width=520,height=760,resizable=yes,scrollbars=yes'
  );
  if (!pickerWindow) {
    throw new Error(
      'Permita pop-ups do Kyrub para abrir sua galeria do Google Fotos.'
    );
  }

  pickerWindow.document.title = 'Abrindo Google Fotos…';
  pickerWindow.document.body.textContent = 'Preparando sua galeria do Google Fotos…';

  let accessToken = '';
  let sessionId = '';

  try {
    accessToken = await requestPhotosAndDriveAccessToken();
    const session = await createPickingSession(accessToken);
    sessionId = session.id?.trim() ?? '';
    const pickerUri = session.pickerUri?.trim() ?? '';

    if (!sessionId || !pickerUri) {
      throw new Error('O Google Fotos não retornou o endereço de seleção.');
    }

    pickerWindow.location.href = `${pickerUri.replace(/\/$/, '')}/autoclose`;
    const completedSession = await pollPickingSession(session, accessToken);

    const pickedItems = await photosRequest<PickedMediaItemsResponse>(
      `/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=1`,
      accessToken
    );
    const mediaItem = pickedItems.mediaItems?.[0];
    if (!mediaItem) {
      throw new Error('Nenhuma foto foi selecionada.');
    }

    const { blob, fileName } = await downloadPickedPhoto(mediaItem, accessToken);
    return uploadPhotoCopyToDrive(blob, fileName, accessToken);
  } catch (error) {
    console.error('Google Photos Picker flow failed.', error);

    if (error instanceof GooglePhotosApiError && error.httpStatus === 400) {
      const status = error.apiStatus || 'HTTP 400';
      throw new Error(
        `O Google Fotos recusou a criação da sessão (${status}): ${error.message} Confira se a API Google Photos Picker e o cliente OAuth pertencem ao mesmo projeto do Kyrub.`
      );
    }

    throw error;
  } finally {
    try {
      pickerWindow.close();
    } catch {
      // The popup can already be closed by /autoclose.
    }
    if (sessionId && accessToken) {
      await deletePickingSession(sessionId, accessToken);
    }
  }
};
