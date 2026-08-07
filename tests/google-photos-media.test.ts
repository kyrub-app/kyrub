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
const appImageSource = readFileSync(
  'src/utils/appImageStorage.ts',
  'utf8'
);
const storageRulesSource = readFileSync('storage.rules', 'utf8');
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

test('Photos session retries only compatible invalid one-item configurations', () => {
  assert.match(photosSource, /class GooglePhotosApiError/);
  assert.match(photosSource, /error\.httpStatus === 400/);
  assert.match(photosSource, /error\.apiStatus === 'INVALID_ARGUMENT'/);
  assert.match(photosSource, /pickingConfig\|maxItemCount/);
  assert.match(photosSource, /body: JSON\.stringify\(\{\}\)/);
  assert.match(photosSource, /Google Photos Picker flow failed/);
  assert.match(photosSource, /cliente OAuth pertencem ao mesmo projeto/);
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

test('the shared media picker uploads device images to Firebase Storage', () => {
  assert.match(photosButtonSource, /type="file"/);
  assert.match(photosButtonSource, /APP_IMAGE_ACCEPT/);
  assert.match(photosButtonSource, /uploadCurrentUserImage/);
  assert.match(photosButtonSource, /Dispositivo/);
  assert.match(photosButtonSource, /Enviando\.\.\./);
  assert.match(appImageSource, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(appImageSource, /app-images\/\$\{user\.uid\}\/\$\{hash\}/);
  assert.match(appImageSource, /getDownloadURL/);
  assert.match(appImageSource, /image\/jpeg/);
  assert.match(appImageSource, /image\/png/);
  assert.match(appImageSource, /image\/webp/);
});

test('device images are public to storefronts but writable only by their owner', () => {
  assert.match(storageRulesSource, /match \/app-images\/\{userId\}\/\{contentHash\}/);
  assert.match(storageRulesSource, /allow read: if true/);
  assert.match(storageRulesSource, /request\.auth\.uid == userId/);
  assert.match(storageRulesSource, /request\.resource\.metadata\.contentHash == contentHash/);
  assert.match(storageRulesSource, /request\.resource\.metadata\.ownerId == userId/);
});
