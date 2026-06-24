import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import {
  DATA_DIR,
  MAX_FILES,
  MAX_FILE_SIZE,
  UPLOAD_TEMP_DIR,
} from './config.js';

const toFileRecord = ({ name, size }) => ({
  name,
  size,
  url: `/files/${encodeURIComponent(name)}`,
});

const toUploadedFileRecords = (files = []) => files.map((file) => (
  toFileRecord({ name: file.filename, size: file.size })
));

const statLatestFile = async (name) => {
  const stats = await fs.stat(path.join(DATA_DIR, name));
  return {
    name,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
};

const listLatestFiles = async () => {
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const filesOnly = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map((entry) => statLatestFile(entry.name)));

  filesOnly.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return filesOnly.map(toFileRecord);
};

const clearLatestFiles = async () => {
  const existingEntries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  await Promise.all(existingEntries.map((entry) => (
    fs.rm(path.join(DATA_DIR, entry.name), { force: true, recursive: entry.isDirectory() })
  )));
};

const ensureStorageDirectories = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_TEMP_DIR, { recursive: true });
};

const padDatePart = (value) => String(value).padStart(2, '0');

const formatUploadTimestamp = (date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DATA_DIR),
  filename: (req, file, cb) => {
    if (!req.uploadBatchTimestamp) {
      req.uploadBatchTimestamp = formatUploadTimestamp(new Date());
      req.uploadBatchIndex = 0;
    }

    req.uploadBatchIndex += 1;

    const ext = path.extname(file.originalname).toLowerCase();
    const photoNumber = String(req.uploadBatchIndex).padStart(3, '0');

    cb(null, `photo-gpt_${req.uploadBatchTimestamp}_photo-${photoNumber}${ext}`);
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
  toUploadedFileRecords,
  upload,
  uploadErrorHandler,
};
