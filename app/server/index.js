import express from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fs } from 'fs';
import { pathToFileURL } from 'url';
import {
  DATA_DIR,
  DATA_ROOT,
  HOST,
  IS_PACKAGED_RUNTIME,
  LAUNCH_SOURCE,
  PORT,
  PWA_DIR,
  STARTUP_LOG_PATH,
  UPLOAD_TEMP_DIR,
} from './config.js';
import { getPhoneUrlRecords } from './lan.js';
import { ensureStorageDirectories } from './storage.js';
import { createApiRouter } from './routes/api.js';
import { createFilesRouter } from './routes/files.js';

const app = express();
let serverInstance = null;

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
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
    launchSource: LAUNCH_SOURCE,
    packaged: IS_PACKAGED_RUNTIME,
    runtimeDataDir: DATA_ROOT,
    latestDir: DATA_DIR,
    uploadTempDir: UPLOAD_TEMP_DIR,
    pid: process.pid,
  };
};

const appendStartupLog = async (event, details = {}) => {
  if (!STARTUP_LOG_PATH) {
    return;
  }

  await fs.mkdir(path.dirname(STARTUP_LOG_PATH), { recursive: true });
  await fs.appendFile(STARTUP_LOG_PATH, `${JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...details,
  })}\n`);
};

app.use('/api', express.json({ limit: '32kb' }), createApiRouter({ getServerStatus }));
app.use('/files', createFilesRouter());
app.use('/', express.static(PWA_DIR));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const startServer = async ({ host = HOST, port = PORT, log = true } = {}) => {
  if (serverInstance?.listening) {
    return serverInstance;
  }

  await ensureStorageDirectories();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      serverInstance = server;
      const status = getServerStatus();
      if (log) {
        console.log(`SnapOverLAN listening on http://${host}:${port}`);
        console.log(`SnapOverLAN runtime data: ${DATA_ROOT}`);
        console.log(`SnapOverLAN LAN URLs: ${status.lanUrls.map((item) => item.url).join(', ') || 'none detected'}`);
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
  // PHOTO_GPT_PARENT_PID is a legacy fallback for pre-rename Electron launches.
  const parentPid = Number(process.env.SNAPOVERLAN_PARENT_PID || process.env.PHOTO_GPT_PARENT_PID);
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

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  watchParentProcess();
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { app, HOST, PORT, startServer, stopServer };
