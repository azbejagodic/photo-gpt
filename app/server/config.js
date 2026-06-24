import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8787;
const HOST = '0.0.0.0';
const MAX_FILES = 20;
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
const DATA_ROOT = process.env.PHOTO_GPT_DATA_DIR || path.join(PROJECT_ROOT, 'data');
const DATA_DIR = path.join(DATA_ROOT, 'latest');
const BATCHES_DIR = path.join(DATA_ROOT, 'batches');
const CURRENT_BATCH_PATH = path.join(DATA_ROOT, 'current-batch.json');
const STORAGE_SETTINGS_PATH = path.join(DATA_ROOT, 'storage-settings.json');
const UPLOAD_TEMP_DIR = path.join(DATA_ROOT, 'upload-tmp');
const PWA_DIR = path.join(PROJECT_ROOT, 'pwa');
const STARTUP_LOG_PATH = process.env.PHOTO_GPT_LOG_FILE || '';
const LAUNCH_SOURCE = process.env.PHOTO_GPT_SERVER_SOURCE || (process.env.PHOTO_GPT_PARENT_PID ? 'electron' : 'standalone');
const IS_PACKAGED_RUNTIME = process.env.PHOTO_GPT_PACKAGED === '1';

export {
  BATCHES_DIR,
  CURRENT_BATCH_PATH,
  DATA_DIR,
  DATA_ROOT,
  HOST,
  IS_PACKAGED_RUNTIME,
  LAUNCH_SOURCE,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_VIDEO_FILE_SIZE,
  PORT,
  PROJECT_ROOT,
  PWA_DIR,
  STARTUP_LOG_PATH,
  STORAGE_SETTINGS_PATH,
  UPLOAD_TEMP_DIR,
};
