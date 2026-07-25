import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pickerSource = readFileSync('src/utils/googleDriveMedia.ts', 'utf8');
const pickerButtonSource = readFileSync(
  'src/components/GoogleDriveImagePickerButton.tsx',
  'utf8'
);
const storeConfigSource = readFileSync(
  'src/components/modals/StoreConfigModal.tsx',
  'utf8'
);
const legacyStoreConfigSource = readFileSync(
  'src/components/modals/LegacyStoreConfigModal.tsx',
  'utf8'
);
const productModalSource = readFileSync(
  'src/components/modals/NewProductModal.tsx',
  'utf8'
);
const proxySource = readFileSync('server/driveMediaProxy.ts', 'utf8');
const serverlessSource = readFileSync('api/media/drive.ts', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');

test('Drive picker requests per-file access through Firebase reauthentication', () => {
  assert.match(
    pickerSource,
    /https:\/\/www\.googleapis\.com\/auth\/drive\.file/
  );
  assert.match(pickerSource, /reauthenticateWithPopup/);
  assert.match(pickerSource, /GoogleAuthProvider\.credentialFromResult/);
  assert.match(pickerSource, /ViewId\.DOCS_IMAGES/);
  assert.match(pickerSource, /setOAuthToken/);
  assert.match(pickerSource, /setDeveloperKey/);
  assert.match(pickerSource, /setAppId/);
});

test('selected Drive images are validated and shared read-only', () => {
  assert.match(pickerSource, /mimeType\.startsWith\('image\/'\)/);
  assert.match(pickerSource, /MAX_IMAGE_SIZE_BYTES/);
  assert.match(pickerSource, /type: 'anyone'/);
  assert.match(pickerSource, /role: 'reader'/);
  assert.match(pickerSource, /allowFileDiscovery: false/);
  assert.match(pickerSource, /\/api\/media\/drive\?fileId=/);
});

test('store profile supports Drive logo and banner selection', () => {
  assert.match(legacyStoreConfigSource, /profileMediaControls/);
  assert.match(storeConfigSource, /id="store-drive-media-controls"/);
  assert.match(storeConfigSource, /Escolher logo/);
  assert.match(storeConfigSource, /Escolher banner/);
  assert.match(storeConfigSource, /logo: configStoreLogo\.trim\(\)/);
  assert.match(storeConfigSource, /banner: configStoreBanner\.trim\(\)/);
  assert.match(storeConfigSource, /setStoreMarketplacePublication/);
});

test('new products accept Drive-backed image references', () => {
  assert.match(productModalSource, /id="product-drive-image-control"/);
  assert.match(productModalSource, /Selecionar foto do Drive/);
  assert.match(productModalSource, /setImageUrl\(selection\.url\)/);
  assert.match(productModalSource, /image: imageUrl/);
  assert.match(pickerButtonSource, /pickPublicGoogleDriveImage/);
});

test('Drive media is proxied locally and on Vercel with image-only validation', () => {
  assert.match(proxySource, /contentType\.startsWith\('image\/'\)/);
  assert.match(proxySource, /X-Content-Type-Options/);
  assert.match(proxySource, /stale-while-revalidate/);
  assert.match(serverlessSource, /proxyPublicGoogleDriveImage/);
  assert.match(serverSource, /"\/api\/media\/drive"/);
});
