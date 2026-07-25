import { proxyPublicGoogleDriveImage } from '../../server/driveMediaProxy';

export default async function handler(
  request: {
    method?: string;
    query?: Record<string, string | string[] | undefined>;
  },
  response: any
): Promise<unknown> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  const rawFileId = request.query?.fileId;
  const fileId = Array.isArray(rawFileId) ? rawFileId[0] : rawFileId;
  return proxyPublicGoogleDriveImage(fileId, response);
}
