import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snapoverlan-retention-'));
process.env.SNAPOVERLAN_DATA_DIR = dataRoot;

const {
  ensureStorageDirectories,
  finalizeUploadedBatch,
  listBatches,
  updateStorageSettings,
} = await import('../app/server/storage.js');

const batchesDir = path.join(dataRoot, 'batches');
after(() => fs.rm(dataRoot, { recursive: true, force: true }));

async function createBatch(id, createdAt) {
  const batchDir = path.join(batchesDir, id);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, '.batch.json'), `${JSON.stringify({ id, createdAt })}\n`);
  await fs.writeFile(path.join(batchDir, 'photo.jpg'), 'photo');
  return batchDir;
}

test('retention changes immediately delete only batches beyond the new cutoff', async () => {
  await ensureStorageDirectories();

  const now = Date.now();
  await createBatch('batch_older_than_30', new Date(now - (31 * 86400000)).toISOString());
  await createBatch('batch_older_than_7', new Date(now - (8 * 86400000)).toISOString());
  await createBatch('batch_recent', new Date(now - 86400000).toISOString());

  await updateStorageSettings({ retentionDays: 30 });
  assert.deepEqual((await listBatches()).map((batch) => batch.id).sort(), [
    'batch_older_than_7',
    'batch_recent',
  ]);

  await updateStorageSettings({ retentionDays: 7 });
  assert.deepEqual((await listBatches()).map((batch) => batch.id), ['batch_recent']);

  await updateStorageSettings({ retentionDays: 30 });
  assert.deepEqual((await listBatches()).map((batch) => batch.id), ['batch_recent']);
});

test('retention cleanup runs during startup and after a successful upload', async () => {
  await updateStorageSettings({ retentionDays: 30 });
  const oldAt = new Date(Date.now() - (31 * 86400000)).toISOString();
  await createBatch('batch_expired_at_startup', oldAt);
  await ensureStorageDirectories();
  assert.equal((await listBatches()).some((batch) => batch.id === 'batch_expired_at_startup'), false);

  await createBatch('batch_expired_before_upload', oldAt);
  const uploadId = 'batch_new_upload';
  const uploadDir = path.join(batchesDir, uploadId);
  await fs.mkdir(uploadDir, { recursive: true });
  const uploadPath = path.join(uploadDir, 'new-photo.jpg');
  await fs.writeFile(uploadPath, 'new photo');
  await finalizeUploadedBatch({
    files: [{ filename: 'new-photo.jpg', size: 9, path: uploadPath }],
    uploadBatchId: uploadId,
    uploadBatchCreatedAt: new Date().toISOString(),
  });

  const remainingIds = (await listBatches()).map((batch) => batch.id);
  assert.equal(remainingIds.includes('batch_expired_before_upload'), false);
  assert.equal(remainingIds.includes(uploadId), true);
});
