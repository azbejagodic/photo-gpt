import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import {
  DATA_DIR,
  MAX_FILES,
  MAX_FILE_SIZE,
  UPLOAD_TEMP_DIR,
} from './config.js';

const toFileRecord = async (name) => {
  const fullPath = path.join(DATA_DIR, name);
  const stats = await fs.stat(fullPath);
  return {
    name,
    size: stats.size,
    url: `/files/${encodeURIComponent(name)}`,
  };
};

const listLatestFiles = async () => {
  const names = await fs.readdir(DATA_DIR);
  const filesOnly = [];

  for (const name of names) {
    const fullPath = path.join(DATA_DIR, name);
    const stats = await fs.stat(fullPath);
    if (stats.isFile()) {
      filesOnly.push({ name, mtimeMs: stats.mtimeMs });
    }
  }

  filesOnly.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return Promise.all(filesOnly.map((file) => toFileRecord(file.name)));
};

const clearLatestFiles = async () => {
  const existingNames = await fs.readdir(DATA_DIR);
  await Promise.all(existingNames.map((name) => (
    fs.rm(path.join(DATA_DIR, name), { force: true, recursive: true })
  )));
};

const ensureStorageDirectories = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_TEMP_DIR, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DATA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBaseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 60) || 'photo';

    cb(null, `${Date.now()}-${safeBaseName}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: {
    files: MAX_FILES,
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image/* files are allowed.'));
  },
});

const uploadErrorHandler = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    let message = err.message;
    if (err.code === 'LIMIT_FILE_COUNT') {
      message = `Maximum ${MAX_FILES} files are allowed.`;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Each image must be <= 12MB.';
    }
    res.status(400).json({ error: message });
    return;
  }

  res.status(400).json({ error: err.message || 'Upload failed.' });
};

export {
  clearLatestFiles,
  ensureStorageDirectories,
  listLatestFiles,
  upload,
  uploadErrorHandler,
};
