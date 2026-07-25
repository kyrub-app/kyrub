const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

interface ResponseLike {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: unknown) => unknown;
  json: (body: unknown) => unknown;
}

export const proxyPublicGoogleDriveImage = async (
  rawFileId: unknown,
  response: ResponseLike
): Promise<unknown> => {
  const fileId = typeof rawFileId === 'string' ? rawFileId.trim() : '';
  if (!DRIVE_FILE_ID_PATTERN.test(fileId)) {
    return response.status(400).json({
      error: 'Identificador de imagem do Google Drive inválido.',
    });
  }

  try {
    const upstream = await fetch(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Kyrub-Drive-Media-Proxy/1.0',
        },
      }
    );

    if (!upstream.ok) {
      return response.status(upstream.status === 404 ? 404 : 502).json({
        error: 'A imagem não está disponível no Google Drive.',
      });
    }

    const contentType = upstream.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (!contentType.startsWith('image/')) {
      return response.status(415).json({
        error: 'O arquivo selecionado não é uma imagem pública válida.',
      });
    }

    const declaredLength = Number.parseInt(
      upstream.headers.get('content-length') ?? '0',
      10
    );
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_SIZE_BYTES) {
      return response.status(413).json({
        error: 'A imagem excede o limite de 10 MB.',
      });
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
      return response.status(413).json({
        error: 'A imagem excede o limite de 10 MB.',
      });
    }

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(bytes.byteLength));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Cache-Control',
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
    );
    return response.status(200).send(bytes);
  } catch (error) {
    console.error('[Kyrub Drive Media] Proxy request failed.', error);
    return response.status(502).json({
      error: 'Não foi possível carregar a imagem do Google Drive.',
    });
  }
};
