import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth } from './firebase';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';
const DEFAULT_PICKER_API_KEY = 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U';
const DEFAULT_GOOGLE_CLOUD_PROJECT_NUMBER = '636039448089';
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
].join(',');

const pickerApiKey =
  import.meta.env.VITE_GOOGLE_PICKER_API_KEY?.trim() ||
  DEFAULT_PICKER_API_KEY;
const googleCloudProjectNumber =
  import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER?.trim() ||
  DEFAULT_GOOGLE_CLOUD_PROJECT_NUMBER;

export interface GoogleDriveImageSelection {
  provider: 'google_drive';
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

type GoogleDriveFileMetadata = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
};

type GoogleDrivePermission = {
  type?: string;
  role?: string;
};

type GoogleDrivePermissionsResponse = {
  permissions?: GoogleDrivePermission[];
};

type PickerDocument = {
  id?: string;
  name?: string;
  mimeType?: string;
};

declare global {
  interface Window {
    gapi?: {
      load: (
        api: string,
        options: {
          callback: () => void;
          onerror: () => void;
          timeout: number;
          ontimeout: () => void;
        }
      ) => void;
    };
    google?: {
      picker?: any;
    };
  }
}

let pickerScriptPromise: Promise<void> | null = null;
let pickerApiPromise: Promise<void> | null = null;

const loadPickerScript = (): Promise<void> => {
  if (window.gapi) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;

  pickerScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${PICKER_SCRIPT_URL}"]`
    );

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Não foi possível carregar o seletor do Google Drive.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = PICKER_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Não foi possível carregar o seletor do Google Drive.'));
    document.head.appendChild(script);
  });

  return pickerScriptPromise;
};

const loadPickerApi = async (): Promise<void> => {
  await loadPickerScript();
  if (window.google?.picker) return;
  if (pickerApiPromise) return pickerApiPromise;

  pickerApiPromise = new Promise((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('A biblioteca do Google Drive não foi inicializada.'));
      return;
    }

    window.gapi.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('A API do Google Picker não pôde ser carregada.')),
      timeout: 15000,
      ontimeout: () => reject(new Error('O Google Picker demorou demais para responder.')),
    });
  });

  return pickerApiPromise;
};

const requestDriveAccessToken = async (): Promise<string> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login novamente antes de acessar o Google Drive.');
  }

  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
    ...(user.email ? { login_hint: user.email } : {}),
  });

  const result = await reauthenticateWithPopup(user, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;

  if (!accessToken) {
    throw new Error('O Google não forneceu autorização para acessar o arquivo.');
  }

  return accessToken;
};

const driveRequest = async <T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let detail = '';
    try {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      detail = payload.error?.message?.trim() ?? '';
    } catch {
      detail = '';
    }

    throw new Error(
      detail || 'O Google Drive não permitiu concluir esta operação.'
    );
  }

  return response.json() as Promise<T>;
};

const ensurePublicReaderPermission = async (
  fileId: string,
  accessToken: string
): Promise<void> => {
  const permissions = await driveRequest<GoogleDrivePermissionsResponse>(
    `/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(type,role)&supportsAllDrives=true`,
    accessToken
  );

  const alreadyPublic = (permissions.permissions ?? []).some(
    permission =>
      permission.type === 'anyone' && permission.role === 'reader'
  );
  if (alreadyPublic) return;

  await driveRequest(
    `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader',
        allowFileDiscovery: false,
      }),
    }
  );
};

export const buildGoogleDriveImageUrl = (fileId: string): string =>
  `/api/media/drive?fileId=${encodeURIComponent(fileId)}`;

const prepareSelectedImage = async (
  document: PickerDocument,
  accessToken: string
): Promise<GoogleDriveImageSelection> => {
  const fileId = document.id?.trim() ?? '';
  if (!fileId) {
    throw new Error('O Google Drive não retornou o identificador da imagem.');
  }

  const metadata = await driveRequest<GoogleDriveFileMetadata>(
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`,
    accessToken
  );

  const mimeType = metadata.mimeType?.trim() || document.mimeType?.trim() || '';
  if (!mimeType.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem no Google Drive.');
  }

  const sizeBytes = Number.parseInt(metadata.size ?? '0', 10);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho da imagem selecionada.');
  }
  if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('A imagem precisa ter no máximo 10 MB.');
  }

  try {
    await ensurePublicReaderPermission(fileId, accessToken);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Não foi possível publicar esta imagem: ${error.message}`
        : 'Não foi possível tornar a imagem pública.'
    );
  }

  return {
    provider: 'google_drive',
    fileId,
    fileName: metadata.name?.trim() || document.name?.trim() || 'Imagem do Drive',
    mimeType,
    sizeBytes,
    url: buildGoogleDriveImageUrl(fileId),
  };
};

export const pickPublicGoogleDriveImage = async (): Promise<
  GoogleDriveImageSelection | null
> => {
  const accessToken = await requestDriveAccessToken();
  await loadPickerApi();

  const pickerNamespace = window.google?.picker;
  if (!pickerNamespace) {
    throw new Error('O Google Picker não está disponível neste navegador.');
  }

  return new Promise((resolve, reject) => {
    let finished = false;

    const imageView = new pickerNamespace.DocsView(
      pickerNamespace.ViewId.DOCS_IMAGES
    )
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes(IMAGE_MIME_TYPES);

    const picker = new pickerNamespace.PickerBuilder()
      .addView(imageView)
      .setOAuthToken(accessToken)
      .setDeveloperKey(pickerApiKey)
      .setAppId(googleCloudProjectNumber)
      .setOrigin(window.location.origin)
      .setTitle('Selecionar imagem do Google Drive')
      .setCallback((data: Record<string, unknown>) => {
        if (finished) return;

        const action = data[pickerNamespace.Response.ACTION];
        if (action === pickerNamespace.Action.CANCEL) {
          finished = true;
          resolve(null);
          return;
        }

        if (action !== pickerNamespace.Action.PICKED) return;
        finished = true;
        picker.setVisible(false);

        const documents = data[
          pickerNamespace.Response.DOCUMENTS
        ] as PickerDocument[] | undefined;
        const selectedDocument = documents?.[0];
        if (!selectedDocument) {
          reject(new Error('Nenhuma imagem foi selecionada.'));
          return;
        }

        void prepareSelectedImage(selectedDocument, accessToken)
          .then(resolve)
          .catch(reject);
      })
      .build();

    picker.setVisible(true);
  });
};
