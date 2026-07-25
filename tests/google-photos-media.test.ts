import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const photosSource = readFileSync(
  'src/utils/googlePhotosMedia.ts',
  'utf8'
);
const photosButtonSource = readFileSync(
  'src/components/GooglePhotosImagePickerButton.tsx',
  'utf8'
);
const storeConfigSource = readFileSync(
  'src/components/modals/StoreConfigModal.tsx',
  'utf8'
);
const productModalSource = readFileSync(
  'src/components/modals/NewProductModal.tsx',
  'utf8'
);

test('Google Photos Picker requests narrow Photos and Drive scopes', () => {
  assert.match(
    photosSource,
    /https:\/\/www\.googleapis\.com\/auth\/photospicker\.mediaitems\.readonly/
  );
  assert.match(
    photosSource,
    /https:\/\/www\.googleapis\.com\/auth\/drive\.file/
  );
  assert.match(photosSource, /reauthenticateWithPopup/);
  assert.match(photosSource, /provider\.addScope\(GOOGLE_PHOTOS_SCOPE\)/);
  assert.match(photosSource, /provider\.addScope\(DRIVE_FILE_SCOPE\)/);
});

test('Photos flow creates, polls, lists and deletes one-item sessions', () => {
  assert.match(photosSource, /photospicker\.googleapis\.com\/v1/);
  assert.match(photosSource, /pickingConfig/);
  assert.match(photosSource, /maxItemCount: '1'/);
  assert.match(photosSource, /pickerUri\.replace/);
  assert.match(photosSource, /\/autoclose/);
  assert.match(photosSource, /pollingConfig\?\.pollInterval/);
  assert.match(photosSource, /session\.mediaItemsSet/);
  assert.match(photosSource, /\/mediaItems\?sessionId=/);
  assert.match(photosSource, /method: 'DELETE'/);
});

test('picked Photos image is downloaded briefly and copied to public Drive media', () => {
  assert.match(photosSource, /fetch\(`\$\{baseUrl\}=d`/);
  assert.match(photosSource, /mimeType\.startsWith\('image\/'\)/);
  assert.match(photosSource, /MAX_IMAGE_SIZE_BYTES/);
  assert.match(photosSource, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(photosSource, /source: 'google_photos'/);
  assert.match(photosSource, /type: 'anyone'/);
  assert.match(photosSource, /role: 'reader'/);
  assert.match(photosSource, /allowFileDiscovery: false/);
  assert.match(photosSource, /buildGoogleDriveImageUrl\(fileId\)/);
});

test('store and product media controls expose Photos beside Drive', () => {
  assert.match(storeConfigSource, /GooglePhotosImagePickerButton/);
  assert.match(storeConfigSource, /Logo no Google Fotos/);
  assert.match(storeConfigSource, /Banner no Google Fotos/);
  assert.match(productModalSource, /GooglePhotosImagePickerButton/);
  assert.match(productModalSource, /Selecionar da galeria/);
  assert.match(productModalSource, /setImageUrl\(selection\.url\)/);
  assert.match(photosButtonSource, /pickGooglePhotosImageToDrive/);
});
