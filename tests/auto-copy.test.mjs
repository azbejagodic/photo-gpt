import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import express from 'express';

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snapoverlan-auto-copy-'));
process.env.SNAPOVERLAN_DATA_DIR = dataRoot;

const {
  copyFirstUploadedImage,
  UPLOAD_COMPLETED_EVENT,
  validateUploadCompletedMessage,
} = await import('../app/auto-copy.js');
const {
  DEFAULT_DESKTOP_SETTINGS,
  normalizeDesktopSettings,
  updateDesktopSetting,
} = await import('../app/desktop-settings.js');
const { createApiRouter } = await import('../app/server/routes/api.js');
const { ensureStorageDirectories } = await import('../app/server/storage.js');
const { sendUploadCompletedToParent } = await import('../app/server/index.js');

await ensureStorageDirectories();

let completionHandler = () => {};
const apiApp = express();
apiApp.use('/api', createApiRouter({
  getServerStatus: () => ({ status: 'listening' }),
  onUploadCompleted: (event) => completionHandler(event),
}));
const server = await new Promise((resolve, reject) => {
  const instance = apiApp.listen(0, '127.0.0.1', () => resolve(instance));
  instance.once('error', reject);
});
const { port } = server.address();

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
  await fs.rm(dataRoot, { recursive: true, force: true });
});

const uploadFiles = async (files) => {
  const form = new FormData();
  for (const file of files) {
    form.append('photos', new Blob([file.contents || file.name], { type: file.type }), file.name);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/upload`, {
    method: 'POST',
    body: form,
  });
  return {
    response,
    body: await response.json(),
  };
};

const validMessage = (filePath = path.join(dataRoot, 'first.png')) => ({
  type: UPLOAD_COMPLETED_EVENT,
  batchId: 'batch_test',
  firstImage: {
    name: 'first.png',
    path: filePath,
    mimeType: 'image/png',
  },
});

test('desktop settings default and migrate auto-copy safely', () => {
  assert.deepEqual(DEFAULT_DESKTOP_SETTINGS, {
    backgroundMode: false,
    autoCopyFirstPhoto: false,
  });
  assert.deepEqual(normalizeDesktopSettings({ backgroundMode: true }), {
    backgroundMode: true,
    autoCopyFirstPhoto: false,
  });
  assert.deepEqual(normalizeDesktopSettings(null), DEFAULT_DESKTOP_SETTINGS);
});

test('saving auto-copy preserves the Background Mode setting', () => {
  assert.deepEqual(
    updateDesktopSetting({ backgroundMode: true }, 'autoCopyFirstPhoto', true),
    {
      backgroundMode: true,
      autoCopyFirstPhoto: true,
    },
  );
});

test('the upload route emits one event with the first image from an ordered mixed batch', async () => {
  const events = [];
  completionHandler = (event) => events.push(event);

  const { response, body } = await uploadFiles([
    { name: 'clip.mp4', type: 'video/mp4' },
    { name: 'first.png', type: 'image/png' },
    { name: 'second.jpg', type: 'image/jpeg' },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.files.length, 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, UPLOAD_COMPLETED_EVENT);
  assert.match(events[0].batchId, /^batch_/);
  assert.match(events[0].firstImage.name, /photo-001\.png$/);
  assert.equal(events[0].firstImage.mimeType, 'image/png');
  assert.equal(path.isAbsolute(events[0].firstImage.path), true);
});

test('video-only and empty batches do not emit image-copy requests', async () => {
  const events = [];
  completionHandler = (event) => events.push(event);

  const videoUpload = await uploadFiles([
    { name: 'clip.mp4', type: 'video/mp4' },
  ]);
  const emptyUpload = await uploadFiles([]);

  assert.equal(videoUpload.response.status, 200);
  assert.equal(emptyUpload.response.status, 200);
  assert.equal(events.length, 0);
});

test('IPC callback failures and unavailable IPC do not fail uploads', async () => {
  completionHandler = () => {
    throw new Error('IPC unavailable');
  };
  const { response, body } = await uploadFiles([
    { name: 'photo.png', type: 'image/png' },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.files.length, 1);
  assert.equal(sendUploadCompletedToParent(validMessage(), { connected: false }), false);
});

test('malformed IPC payloads are ignored before filesystem or clipboard access', async () => {
  let dependencyCalls = 0;
  const result = await copyFirstUploadedImage({
    message: { type: UPLOAD_COMPLETED_EVENT, firstImage: { path: 'relative.png' } },
    enabled: true,
    fileExists: async () => { dependencyCalls += 1; return true; },
    createImageFromPath: () => { dependencyCalls += 1; return { isEmpty: () => false }; },
    writeImage: () => { dependencyCalls += 1; },
  });

  assert.equal(validateUploadCompletedMessage({}), null);
  assert.deepEqual(result, { status: 'ignored' });
  assert.equal(dependencyCalls, 0);
});

test('disabled auto-copy does not access or replace the clipboard', async () => {
  let writes = 0;
  const result = await copyFirstUploadedImage({
    message: validMessage(),
    enabled: false,
    fileExists: async () => true,
    createImageFromPath: () => ({ isEmpty: () => false }),
    writeImage: () => { writes += 1; },
  });

  assert.deepEqual(result, { status: 'disabled' });
  assert.equal(writes, 0);
});

test('enabled auto-copy writes exactly one decoded image', async () => {
  const decodedImage = { isEmpty: () => false };
  let writes = 0;
  const result = await copyFirstUploadedImage({
    message: validMessage(),
    enabled: true,
    fileExists: async () => true,
    createImageFromPath: () => decodedImage,
    writeImage: (image) => {
      assert.equal(image, decodedImage);
      writes += 1;
    },
  });

  assert.equal(result.status, 'copied');
  assert.equal(result.filename, 'first.png');
  assert.equal(writes, 1);
});

test('an empty nativeImage produces non-blocking failure without a clipboard write', async () => {
  let writes = 0;
  const result = await copyFirstUploadedImage({
    message: validMessage(),
    enabled: true,
    fileExists: async () => true,
    createImageFromPath: () => ({ isEmpty: () => true }),
    writeImage: () => { writes += 1; },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /could not decode/i);
  assert.equal(writes, 0);
});
