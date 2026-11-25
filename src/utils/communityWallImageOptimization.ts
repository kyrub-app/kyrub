// Conservative client-side JPEG optimization. PNG/WebP (including animation)
// and videos deliberately retain their original bytes in V1.
const MIN_BYTES = 350 * 1024;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_DECODE_PIXELS = 24_000_000;
const MAX_SIDE = 1800;
const JPEG_QUALITY = 0.84;

type Size = { width: number; height: number };
type DecodedImage = Size & { close(): void };
export interface WallJpegCodec {
  decode(file: Blob): Promise<DecodedImage>;
  encode(image: DecodedImage, size: Size): Promise<Blob | null>;
}

// Inspect SOF before decoding, to avoid allocating huge bitmaps on phones.
// Unknown/truncated headers are left unchanged rather than decoded here.
export function readWallJpegSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i++] !== 0xff) return null;
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i++];
    if (marker === 0xda || marker === 0xd9 || marker === 0x00) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > bytes.length) return null;
    const length = bytes[i] * 256 + bytes[i + 1];
    if (length < 2 || i + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 8) return null;
      const height = bytes[i + 3] * 256 + bytes[i + 4];
      const width = bytes[i + 5] * 256 + bytes[i + 6];
      return width && height ? { width, height } : null;
    }
    i += length;
  }
  return null;
}

const browserCodec: WallJpegCodec = {
  decode: file => createImageBitmap(file, { imageOrientation: 'from-image' }),
  async encode(image, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image as ImageBitmap, 0, 0, size.width, size.height);
      return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  },
};

export async function optimizeCommunityWallImage(file: Blob, codec: WallJpegCodec = browserCodec): Promise<Blob> {
  if (file.type !== 'image/jpeg' || file.size <= MIN_BYTES || file.size > MAX_INPUT_BYTES) return file;
  let decoded: DecodedImage | undefined;
  try {
    const size = readWallJpegSize(new Uint8Array(await file.arrayBuffer()));
    if (!size || size.width * size.height > MAX_DECODE_PIXELS) return file;
    decoded = await codec.decode(file);
    const { width, height } = decoded;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || width * height > MAX_DECODE_PIXELS) return file;
    // Bitmap dimensions reflect EXIF orientation. No upscaling.
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    const result = await codec.encode(decoded, target);
    // Keep original on unsupported encoder, empty result or <10% gain.
    if (!result || result.type !== 'image/jpeg' || result.size <= 0 ||
        result.size > file.size * 0.9) return file;
    return result;
  } catch {
    // Browsers without the codec and corrupt files retain the existing upload behavior.
    return file;
  } finally {
    decoded?.close();
  }
}
