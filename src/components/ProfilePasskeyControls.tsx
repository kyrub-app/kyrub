import { useEffect, useState } from 'react';
import { Fingerprint, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';

type PasskeyPayload = Record<string, unknown>;

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  );
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const toBase64Url = (value: ArrayBuffer | ArrayBufferView | null): string => {
  if (!value) return '';
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const request = async (
  user: User,
  method: 'GET' | 'POST',
  body?: PasskeyPayload
): Promise<PasskeyPayload> => {
  const token = await user.getIdToken(method === 'POST');
  const response = await fetch('/api/security/passkey', {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as PasskeyPayload;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível concluir a validação do aparelho.'
    );
  }
  return payload;
};

const creationOptions = (
  value: PasskeyPayload
): PublicKeyCredentialCreationOptions => ({
  ...(value as unknown as PublicKeyCredentialCreationOptions),
  challenge: fromBase64Url(String(value.challenge ?? '')),
  user: {
    ...(value.user as PublicKeyCredentialUserEntity),
    id: fromBase64Url(
      String((value.user as PasskeyPayload | undefined)?.id ?? '')
    ),
  },
  excludeCredentials: Array.isArray(value.excludeCredentials)
    ? value.excludeCredentials.map(item => {
        const candidate = item as PasskeyPayload;
        return {
          ...candidate,
          type: 'public-key',
          id: fromBase64Url(String(candidate.id ?? '')),
        } satisfies PublicKeyCredentialDescriptor;
      })
    : [],
});

const requestOptions = (
  value: PasskeyPayload
): PublicKeyCredentialRequestOptions => ({
  ...(value as unknown as PublicKeyCredentialRequestOptions),
  challenge: fromBase64Url(String(value.challenge ?? '')),
  allowCredentials: Array.isArray(value.allowCredentials)
    ? value.allowCredentials.map(item => {
        const candidate = item as PasskeyPayload;
        return {
          ...candidate,
          type: 'public-key',
          id: fromBase64Url(String(candidate.id ?? '')),
        } satisfies PublicKeyCredentialDescriptor;
      })
    : [],
});

export function ProfilePasskeyControls({ user }: { user: User }) {
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void request(user, 'GET')
      .then(payload => {
        if (!cancelled) setConfigured(payload.configured === true);
      })
      .catch(error => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Não foi possível consultar a passkey.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const register = async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setMessage('Este navegador ou aparelho não oferece passkeys/WebAuthn.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await reauthenticateWithPopup(user, provider);
      const options = await request(user, 'POST', {
        action: 'registration-options',
      });
      const credential = await navigator.credentials.create({
        publicKey: creationOptions(options),
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('O aparelho não criou uma credencial válida.');
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const extended = response as AuthenticatorAttestationResponse & {
        getAuthenticatorData?: () => ArrayBuffer;
        getPublicKey?: () => ArrayBuffer | null;
        getPublicKeyAlgorithm?: () => number;
        getTransports?: () => AuthenticatorTransport[];
      };
      const authenticatorData = extended.getAuthenticatorData?.();
      const publicKey = extended.getPublicKey?.();
      const algorithm = extended.getPublicKeyAlgorithm?.();
      if (!authenticatorData || !publicKey || typeof algorithm !== 'number') {
        throw new Error(
          'Este navegador não forneceu os dados necessários da passkey.'
        );
      }

      await request(user, 'POST', {
        action: 'registration-finish',
        id: credential.id,
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(authenticatorData),
        publicKey: toBase64Url(publicKey),
        algorithm,
        transports: extended.getTransports?.() ?? [],
      });
      setConfigured(true);
      setMessage('Biometria/passkey cadastrada neste aparelho.');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setMessage(
        name === 'NotAllowedError'
          ? 'A confirmação foi cancelada ou expirou.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível cadastrar a passkey.'
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setMessage('Este navegador ou aparelho não oferece passkeys/WebAuthn.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const options = await request(user, 'POST', {
        action: 'authentication-options',
      });
      const credential = await navigator.credentials.get({
        publicKey: requestOptions(options),
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('O aparelho não devolveu uma credencial válida.');
      }

      const response = credential.response as AuthenticatorAssertionResponse;
      await request(user, 'POST', {
        action: 'authentication-finish',
        id: credential.id,
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
        userHandle: toBase64Url(response.userHandle),
      });
      setMessage('Biometria do aparelho confirmada com sucesso.');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setMessage(
        name === 'NotAllowedError'
          ? 'A confirmação foi cancelada ou expirou.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível confirmar a passkey.'
      );
    } finally {
      setBusy(false);
    }
  };

  const positive =
    message.includes('sucesso') || message.includes('cadastrada');

  return (
    <section className="space-y-4 rounded-3xl border border-teal-500/20 bg-teal-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-500/30 bg-slate-950 text-teal-300">
          <Fingerprint className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-[11px] font-black uppercase text-white">
            Biometria do aparelho
          </h4>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Use Windows Hello, Touch ID, Face ID ou o desbloqueio seguro do
            aparelho. O Kyrub não recebe sua impressão digital nem sua imagem.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void (configured ? verify() : register())}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 text-[10px] font-black uppercase text-slate-950 disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : configured ? (
          <ShieldCheck className="h-4 w-4" />
        ) : (
          <Fingerprint className="h-4 w-4" />
        )}
        {configured ? 'Confirmar biometria' : 'Ativar biometria/passkey'}
      </button>

      <p className={`text-[9px] leading-relaxed ${
        positive ? 'text-emerald-300' : 'text-slate-500'
      }`}>
        {message || (configured
          ? 'Passkey ativa neste perfil.'
          : 'Nenhuma passkey foi confirmada neste navegador ainda.')}
      </p>
    </section>
  );
}
