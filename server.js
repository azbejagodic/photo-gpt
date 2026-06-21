import express from 'express';
import cors from 'cors';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { promises as fs } from 'fs';

// Recreate __dirname for ES modules so we can build absolute paths safely.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App configuration values are grouped here so limits and folders are easy to adjust.
const PORT = 8787;
const HOST = '0.0.0.0';
const MAX_FILES = 20;
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12MB in bytes.
const dataRoot = process.env.PHOTO_GPT_DATA_DIR || path.join(__dirname, 'data');
const dataDir = path.join(dataRoot, 'latest');
const uploadTempDir = path.join(dataRoot, 'upload-tmp');
const desktopDir = path.join(__dirname, 'desktop');
const pwaDir = path.join(__dirname, 'pwa');
const startupLogPath = process.env.PHOTO_GPT_LOG_FILE || '';
const launchSource = process.env.PHOTO_GPT_SERVER_SOURCE || (process.env.PHOTO_GPT_PARENT_PID ? 'electron' : 'standalone');
const isPackagedRuntime = process.env.PHOTO_GPT_PACKAGED === '1';

const app = express();
let serverInstance = null;

// Minimal CORS for LAN usage: allow any local origin to use standard GET/POST requests.
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST'],
  })
);

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

const isPrivateIpv4 = (address) => (
  address.startsWith('10.') ||
  address.startsWith('192.168.') ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
);

const getIpv4Rank = (address) => {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 2;
  if (address.startsWith('169.254.')) return 4;
  return 3;
};

const getLanIpv4Addresses = () => {
  const seen = new Set();
  const addresses = [];

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const details of interfaces || []) {
      if (details.family !== 'IPv4' || details.internal || seen.has(details.address)) {
        continue;
      }

      seen.add(details.address);
      addresses.push({
        address: details.address,
        private: isPrivateIpv4(details.address),
      });
    }
  }

  return addresses.sort((a, b) => (
    getIpv4Rank(a.address) - getIpv4Rank(b.address) ||
    a.address.localeCompare(b.address)
  ));
};

const getPhoneUrlRecords = () => getLanIpv4Addresses().map(({ address, private: isPrivate }) => ({
  address,
  private: isPrivate,
  url: `http://${address}:${PORT}`,
}));

const getServerStatus = () => {
  const address = serverInstance?.address?.();
  const boundAddress = address && typeof address === 'object' ? address.address : HOST;
  const boundPort = address && typeof address === 'object' ? address.port : PORT;
  const lanUrls = getPhoneUrlRecords();

  return {
    status: serverInstance?.listening ? 'listening' : 'starting',
    configuredHost: HOST,
    bindHost: boundAddress || HOST,
    port: boundPort || PORT,
    lanUrls,
    primaryLanUrl: lanUrls[0]?.url || '',
    launchSource,
    packaged: isPackagedRuntime,
    runtimeDataDir: dataRoot,
    latestDir: dataDir,
    uploadTempDir,
    pid: process.pid,
  };
};

const appendStartupLog = async (event, details = {}) => {
  if (!startupLogPath) {
    return;
  }

  await fs.mkdir(path.dirname(startupLogPath), { recursive: true });
  await fs.appendFile(startupLogPath, `${JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...details,
  })}\n`);
};

// Multer storage controls where and how incoming files are written to disk.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dataDir),
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
    cb(new Error('Only image/* files are allowed.'));
  },
});

// Error middleware specifically for Multer failures and input validation issues.
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
      message = `Each image must be <= 12MB.`;
    }
    res.status(400).json({ error: message });
    return;
  }

  res.status(400).json({ error: err.message || 'Upload failed.' });
};

// POST /api/upload:
// 1) Remove old files from the active batch directory.
// 2) Accept new multipart images from field name "photos".
// 3) Return metadata for the newly stored files.
app.post('/api/upload', async (req, res, next) => {
  try {
    const existingNames = await fs.readdir(dataDir);
    await Promise.all(existingNames.map((name) => fs.rm(path.join(dataDir, name), { force: true, recursive: true })));
    next();
  } catch (err) {
    next(err);
  }
}, upload.array('photos', MAX_FILES), uploadErrorHandler, async (_req, res, next) => {
  try {
    const files = await listLatestFiles();
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

// GET /api/latest returns the current active batch stored in ./data/latest.
app.get('/api/latest', async (_req, res, next) => {
  try {
    const files = await listLatestFiles();
    res.json({ files });
  } catch (err) {
    next(err);
  }
});

// GET /api/phone-url returns LAN URLs the desktop dashboard can show and encode as a QR code.
app.get('/api/phone-url', (req, res) => {
  const lanUrls = getPhoneUrlRecords();
  const requestHost = req.get('host') || `localhost:${PORT}`;
  const fallbackUrl = `http://${requestHost}`;
  const urls = lanUrls.length > 0 ? lanUrls : [{ address: requestHost.split(':')[0], private: false, url: fallbackUrl }];

  res.json({
    port: PORT,
    primaryUrl: urls[0].url,
    urls,
  });
});

// GET /api/server-status returns LAN diagnostics for desktop troubleshooting.
app.get('/api/server-status', (_req, res) => {
  res.json(getServerStatus());
});

// Serve uploaded files with no-store so phones/clients always fetch the newest images.
app.use('/files', express.static(dataDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// Serve the desktop dashboard separately from the phone PWA.
app.use('/desktop', express.static(desktopDir));

// Serve the PWA front-end files from ./pwa at the web root.
app.use('/', express.static(pwaDir));

// Fallback JSON error response so API clients receive clear messages.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const startServer = async ({ host = HOST, port = PORT, log = true } = {}) => {
  if (serverInstance?.listening) {
    return serverInstance;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadTempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      serverInstance = server;
      const status = getServerStatus();
      if (log) {
        console.log(`Photo bridge listening on http://${host}:${port}`);
        console.log(`Photo GPT runtime data: ${dataRoot}`);
        console.log(`Photo GPT LAN URLs: ${status.lanUrls.map((item) => item.url).join(', ') || 'none detected'}`);
      }
      appendStartupLog('server-listening', status).catch((err) => {
        console.warn('Could not write startup diagnostics:', err);
      });
      resolve(server);
    });

    server.once('error', reject);
  });
};

const stopServer = async () => {
  if (!serverInstance) {
    return;
  }

  await new Promise((resolve, reject) => {
    serverInstance.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  serverInstance = null;
};

const watchParentProcess = () => {
  const parentPid = Number(process.env.PHOTO_GPT_PARENT_PID);
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    return;
  }

  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') {
        process.exit(0);
      }
    }
  }, 2000);
  timer.unref();
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  watchParentProcess();
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app, PORT, HOST, startServer, stopServer };
