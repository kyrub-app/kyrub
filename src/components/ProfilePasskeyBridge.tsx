import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Fingerprint, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from '../utils/firebase';

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const toBase64Url = (value: ArrayBuffer | ArrayBufferView | null): string => {
  if (!value) return '';
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const request = async (
  user: User,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
) => {
  const token = await user.getIdToken(method === 'POST');
  const response = await fetch('/api/security/passkey', {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível concluir a validação do aparelho.'
    );
  }
  return payload;
};

const publicKeyCreationOptions = (
  value: Record<string, unknown>
): PublicKeyCredentialCreationOptions => ({
  ...(value as unknown as PublicKeyCredentialCreationOptions),
  challenge: fromBase64Url(String(value.challenge ?? '')),
  user: {
    ...(value.user as PublicKeyCredentialUserEntity),
    id: fromBase64Url(
      String((value.user as Record<string, unknown> | undefined)?.id ?? '')
    ),
  },
  excludeCredentials: Array.isArray(value.excludeCredentials)
    ? value.excludeCredentials.map(item => {
        const candidate = item as Record<string, unknown>;
        return {
          ...candidate,
          id: fromBase64Url(String(candidate.id ?? '')),
        } as PublicKeyCredentialDescriptor;
      })
    : [],
});

const publicKeyRequestOptions = (
  value: Record<string, unknown>
): PublicKeyCredentialRequestOptions => ({
  ...(value as unknown as PublicKeyCredentialRequestOptions),
  challenge: fromBase64Url(String(value.challenge ?? '')),
  allowCredentials: Array.isArray(value.allowCredentials)
    ? value.allowCredentials.map(item => {
        const candidate = item as Record<string, unknown>;
        return {
          ...candidate,
          id: fromBase64Url(String(candidate.id ?? '')),
        } as PublicKeyCredentialDescriptor;
      })
    : [],
});

export function ProfilePasskeyBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const findTarget = () => {
      const heading = [...document.querySelectorAll<HTMLElement>('h3')]
        .find(item => item.textContent?.trim() === 'Biometria do dispositivo');
      const section = heading?.closest('section');
      if (!section) {
        setTarget(null);
        return;
      }
      let mount = section.querySelector<HTMLElement>('#profile-passkey-controls');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'profile-passkey-controls';
        mount.className = 'mt-3';
        const pendingBadge = [...section.querySelectorAll<HTMLElement>('span')]
          .find(item => item.textContent?.includes('Aguardando integração passkey'));
        pendingBadge?.remove();
        section.appendChild(mount);
      }
      setTarget(mount);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!user || !target) return;
    void request(user, 'GET')
      .then(payload => setConfigured(payload.configured === true))
      .catch(error => setMessage(error instanceof Error ? error.message : ''));
  }, [target, user]);

  if (!user || !target) return null;

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
        publicKey: publicKeyCreationOptions(options),
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
        throw new Error('Este navegador não forneceu os dados necessários da passkey.');
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
        publicKey: publicKeyRequestOptions(options),
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

  return createPortal(
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void (configured ? verify() : register())}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-[10px] font-black uppercase text-teal-200 disabled:opacity-50"
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
        message.includes('sucesso') || message.includes('cadastrada')
          ? 'text-emerald-300'
          : 'text-slate-500'
      }`}>
        {message || (configured
          ? 'Passkey ativa. O Kyrub não recebe sua impressão digital nem sua imagem facial.'
          : 'Use Windows Hello, Touch ID, Face ID ou o desbloqueio seguro disponível no aparelho.')}
      </p>
    </div>,
    target
  );
}
