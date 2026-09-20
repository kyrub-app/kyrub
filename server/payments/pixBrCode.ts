import { createHash } from 'node:crypto';
import type { StoreOwnedPixConfiguration } from '../../shared/storeOwnedPix.js';

const QR_VERSION = 10;
const QR_SIZE = 17 + 4 * QR_VERSION;
const QR_DATA_CODEWORDS = 274;
const QR_ECC_CODEWORDS_PER_BLOCK = 18;
const QR_BLOCK_DATA_LENGTHS = [68, 68, 69, 69] as const;
const QR_ALIGNMENT_CENTERS = [6, 28, 50] as const;

const tlv = (id: string, value: string): string => {
  const length = Buffer.byteLength(value, 'utf8');
  if (!/^\d{2}$/u.test(id) || length > 99) throw new Error('STORE_PIX_BR_CODE_FIELD_INVALID');
  return `${id}${String(length).padStart(2, '0')}${value}`;
};

const crc16Ccitt = (value: string): string => {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000
        ? ((crc << 1) ^ 0x1021) & 0xffff
        : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

export const buildStoreOwnedPixTxid = (paymentIdInput: string): string => {
  const paymentId = paymentIdInput.trim();
  if (!paymentId) throw new Error('STORE_PIX_PAYMENT_ID_REQUIRED');
  return createHash('sha256')
    .update(paymentId)
    .digest('hex')
    .slice(0, 25)
    .toUpperCase();
};

export const buildStoreOwnedPixBrCode = (input: {
  configuration: StoreOwnedPixConfiguration;
  amount: number;
  paymentId: string;
}): { payload: string; txid: string } => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('STORE_PIX_AMOUNT_INVALID');
  }
  const amount = input.amount.toFixed(2);
  const txid = buildStoreOwnedPixTxid(input.paymentId);
  const merchantAccount = tlv('00', 'br.gov.bcb.pix') + tlv('01', input.configuration.key);
  const additionalData = tlv('05', txid);
  const withoutCrc = [
    tlv('00', '01'),
    tlv('26', merchantAccount),
    tlv('52', '0000'),
    tlv('53', '986'),
    tlv('54', amount),
    tlv('58', 'BR'),
    tlv('59', input.configuration.recipientName),
    tlv('60', input.configuration.recipientCity),
    tlv('62', additionalData),
    '6304',
  ].join('');
  return {
    payload: `${withoutCrc}${crc16Ccitt(withoutCrc)}`,
    txid,
  };
};

const gfMultiply = (x: number, y: number): number => {
  let z = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> bit) & 1) !== 0) z ^= x;
  }
  return z;
};

const reedSolomonDivisor = (degree: number): number[] => {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let item = 0; item < degree; item += 1) {
      result[item] = gfMultiply(result[item], root);
      if (item + 1 < degree) result[item] ^= result[item + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
};

const reedSolomonRemainder = (data: readonly number[], divisor: readonly number[]): number[] => {
  const result = Array<number>(divisor.length).fill(0);
  for (const value of data) {
    const factor = value ^ result[0];
    result.shift();
    result.push(0);
    for (let index = 0; index < divisor.length; index += 1) {
      result[index] ^= gfMultiply(divisor[index], factor);
    }
  }
  return result;
};

const qrCodewords = (text: string): number[] => {
  const raw = [...Buffer.from(text, 'utf8')];
  const bits: number[] = [];
  const append = (value: number, count: number): void => {
    for (let bit = count - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };

  append(0b0100, 4);
  append(raw.length, 16);
  for (const byte of raw) append(byte, 8);
  const capacityBits = QR_DATA_CODEWORDS * 8;
  if (bits.length > capacityBits) throw new Error('STORE_PIX_QR_PAYLOAD_TOO_LARGE');
  append(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let offset = 0; offset < 8; offset += 1) value = (value << 1) | bits[index + offset];
    data.push(value);
  }
  for (let index = 0; data.length < QR_DATA_CODEWORDS; index += 1) {
    data.push(index % 2 === 0 ? 0xec : 0x11);
  }

  const divisor = reedSolomonDivisor(QR_ECC_CODEWORDS_PER_BLOCK);
  const blocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const length of QR_BLOCK_DATA_LENGTHS) {
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push(block);
    eccBlocks.push(reedSolomonRemainder(block, divisor));
  }

  const result: number[] = [];
  const maximumDataLength = Math.max(...QR_BLOCK_DATA_LENGTHS);
  for (let index = 0; index < maximumDataLength; index += 1) {
    for (const block of blocks) {
      if (index < block.length) result.push(block[index]);
    }
  }
  for (let index = 0; index < QR_ECC_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of eccBlocks) result.push(block[index]);
  }
  return result;
};

const qrMatrix = (text: string): boolean[][] => {
  const codewords = qrCodewords(text);
  const modules = Array.from({ length: QR_SIZE }, () => Array<boolean>(QR_SIZE).fill(false));
  const isFunction = Array.from({ length: QR_SIZE }, () => Array<boolean>(QR_SIZE).fill(false));

  const setFunction = (x: number, y: number, dark: boolean): void => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  for (let index = 0; index < QR_SIZE; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }

  const drawFinder = (centerX: number, centerY: number): void => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(QR_SIZE - 4, 3);
  drawFinder(3, QR_SIZE - 4);

  const drawAlignment = (centerX: number, centerY: number): void => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(
          centerX + dx,
          centerY + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1
        );
      }
    }
  };
  for (let xIndex = 0; xIndex < QR_ALIGNMENT_CENTERS.length; xIndex += 1) {
    for (let yIndex = 0; yIndex < QR_ALIGNMENT_CENTERS.length; yIndex += 1) {
      const overlapsFinder =
        (xIndex === 0 && yIndex === 0) ||
        (xIndex === 0 && yIndex === QR_ALIGNMENT_CENTERS.length - 1) ||
        (xIndex === QR_ALIGNMENT_CENTERS.length - 1 && yIndex === 0);
      if (!overlapsFinder) {
        drawAlignment(QR_ALIGNMENT_CENTERS[xIndex], QR_ALIGNMENT_CENTERS[yIndex]);
      }
    }
  }

  const drawFormat = (): void => {
    const data = 1 << 3; // Error correction L (01) and mask pattern 0.
    let remainder = data;
    for (let index = 0; index < 10; index += 1) {
      remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (index: number): boolean => ((bits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, bit(index));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, bit(index));
    for (let index = 0; index < 8; index += 1) setFunction(QR_SIZE - 1 - index, 8, bit(index));
    for (let index = 8; index < 15; index += 1) setFunction(8, QR_SIZE - 15 + index, bit(index));
    setFunction(8, QR_SIZE - 8, true);
  };

  const drawVersion = (): void => {
    let remainder = QR_VERSION;
    for (let index = 0; index < 12; index += 1) {
      remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) * 0x1f25);
    }
    const bits = (QR_VERSION << 12) | remainder;
    for (let index = 0; index < 18; index += 1) {
      const dark = ((bits >>> index) & 1) !== 0;
      const a = QR_SIZE - 11 + (index % 3);
      const b = Math.floor(index / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  };

  drawFormat();
  drawVersion();

  let bitIndex = 0;
  let upward = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (isFunction[y][x]) continue;
        const dark = bitIndex < codewords.length * 8
          ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0
          : false;
        modules[y][x] = dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
    }
  }
  drawFormat();
  return modules;
};

export const createPixQrCodeDataUri = (payload: string): string => {
  const matrix = qrMatrix(payload);
  const quietZone = 4;
  const viewSize = QR_SIZE + quietZone * 2;
  const path: string[] = [];
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (matrix[y][x]) path.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path.join('')}" fill="black"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};
