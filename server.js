import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

// Recreate __dirname for ES modules so we can build absolute paths safely.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App configuration values are grouped here so limits and folders are easy to adjust.
const PORT = 8787;
const HOST = '0.0.0.0';
const MAX_FILES = 20;
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12MB in bytes.
const IMAGE_ONLY_UPLOAD_ERROR = 'Only image/* files are allowed.';
const dataRoot = path.join(__dirname, 'data');
const dataDir = path.join(dataRoot, 'latest');
const uploadTempRoot = path.join(dataRoot, 'upload-tmp');
const pwaDir = path.join(__dirname, 'pwa');

const app = express();

// Minimal CORS for LAN usage: allow any local origin to use standard GET/POST requests.
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST'],
  })
);

// Ensure the upload directories exist before handling requests.
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(uploadTempRoot, { recursive: true });

// Shared helper that builds a consistent API response object for each saved image.
const toFileRecord = async (name) => {
  const fullPath = path.join(dataDir, name);
  const stats = await fs.stat(fullPath);
  return {
    name,
    size: stats.size,
    url: `/files/${encodeURIComponent(name)}`,
  };
};

// Shared helper that reads the current batch of files from ./data/latest.
const listLatestFiles = async () => {
  const names = await fs.readdir(dataDir);
  const filesOnly = [];

  for (const name of names) {
    const fullPath = path.join(dataDir, name);
    const stats = await fs.stat(fullPath);
    if (stats.isFile()) {
      filesOnly.push({ name, mtimeMs: stats.mtimeMs });
    }
  }

  // Sort by modified time so clients receive files in a predictable order.
  filesOnly.sort((a, b) => a.mtimeMs - b.mtimeMs);

  return Promise.all(filesOnly.map((file) => toFileRecord(file.name)));
};

const cleanupDirectory = async (dir) => {
  if (!dir) {
    return;
  }

  await fs.rm(dir, { recursive: true, force: true });
};

const createUploadTempDir = async (req, _res, next) => {
  try {
    req.uploadTempDir = await fs.mkdtemp(path.join(uploadTempRoot, 'batch-'));
    next();
  } catch (err) {
    next(err);
  }
};

const replaceLatestBatch = async (newBatchDir) => {
  const swapParentDir = await fs.mkdtemp(path.join(uploadTempRoot, 'swap-'));
  const previousBatchDir = path.join(swapParentDir, 'previous');
  let previousBatchMoved = false;
  let newBatchMoved = false;

  try {
    await fs.rename(dataDir, previousBatchDir);
    previousBatchMoved = true;

    try {
      await fs.rename(newBatchDir, dataDir);
      newBatchMoved = true;
    } catch (err) {
      try {
        await fs.rename(previousBatchDir, dataDir);
        previousBatchMoved = false;
      } catch (restoreErr) {
        err.restoreError = restoreErr;
      }
      throw err;
    }
  } finally {
    if (newBatchMoved || !previousBatchMoved) {
      await cleanupDirectory(swapParentDir).catch((err) => {
        console.warn('Could not remove upload swap directory:', err);
      });
    }
  }
};

// Multer storage controls where and how incoming files are written to disk.
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    if (!req.uploadTempDir) {
      cb(new Error('Upload staging directory was not prepared.'));
      return;
    }

    cb(null, req.uploadTempDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBaseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 60) || 'photo';

    // Prefix filename with a timestamp to avoid accidental filename collisions.
    cb(null, `${Date.now()}-${safeBaseName}${ext.toLowerCase()}`);
  },
});

// Multer instance enforces image-only uploads plus file count and size limits.
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
    cb(new Error(IMAGE_ONLY_UPLOAD_ERROR));
  },
});

// Error middleware specifically for Multer failures and input validation issues.
const uploadErrorHandler = (err, req, res, next) => {
  if (!err) {
    next();
    return;
  }

  cleanupDirectory(req.uploadTempDir)
    .catch((cleanupErr) => {
      console.warn('Could not clean failed upload directory:', cleanupErr);
    })
    .finally(() => {
      if (!(err instanceof multer.MulterError) && err.message !== IMAGE_ONLY_UPLOAD_ERROR) {
        next(err);
        return;
      }

      let message = err.message;
      if (err.code === 'LIMIT_FILE_COUNT') {
        message = `Maximum ${MAX_FILES} files are allowed.`;
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = `Each image must be <= 12MB.`;
      }
      res.status(400).json({ error: message || 'Upload failed.' });
    });
};

// POST /api/upload:
// 1) Stage multipart images from field name "photos" in a temporary directory.
// 2) Replace the active batch only after Multer accepts the full upload.
// 3) Return metadata for the newly active files.
app.post(
  '/api/upload',
  createUploadTempDir,
  upload.array('photos', MAX_FILES),
  uploadErrorHandler,
  async (req, res, next) => {
    try {
      await replaceLatestBatch(req.uploadTempDir);
      req.uploadTempDir = null;
      const files = await listLatestFiles();
      res.json({ files });
    } catch (err) {
      await cleanupDirectory(req.uploadTempDir).catch((cleanupErr) => {
        console.warn('Could not clean staged upload directory:', cleanupErr);
      });
      next(err);
    }
  }
);

// GET /api/latest returns the current active batch stored in ./data/latest.
app.get('/api/latest', async (_req, res, next) => {
  try {
    const files = await listLatestFiles();
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

// Serve uploaded files with no-store so phones/clients always fetch the newest images.
app.use('/files', express.static(dataDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// Serve the PWA front-end files from ./pwa at the web root.
app.use('/', express.static(pwaDir));

// Fallback JSON error response so API clients receive clear messages.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Bind to 0.0.0.0 for LAN access and start listening on port 8787.
app.listen(PORT, HOST, () => {
  console.log(`Photo bridge listening on http://${HOST}:${PORT}`);
});
