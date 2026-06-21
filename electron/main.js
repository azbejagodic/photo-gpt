import { app as electronApp, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');

const PORT = 8787;
const SERVER_ORIGIN = `http://localhost:${PORT}`;
const DASHBOARD_URL = `${SERVER_ORIGIN}/desktop`;

electronApp.setName('Photo GPT');

let mainWindow = null;
let ownedServerProcess = null;
let serverLaunchMode = 'unknown';

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isDashboardReachable = (url) => new Promise((resolve) => {
  let settled = false;
  const done = (value) => {
    if (!settled) {
      settled = true;
      resolve(value);
    }
  };

  const req = http.get(url, (res) => {
    res.resume();
    done(res.statusCode >= 200 && res.statusCode < 400);
  });

  req.on('error', () => done(false));
  req.setTimeout(1000, () => {
    req.destroy();
    done(false);
  });
});

const getJson = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });

  req.on('error', reject);
  req.setTimeout(1500, () => {
    req.destroy(new Error(`Timed out requesting ${url}`));
  });
});

const getStartupLogPath = () => path.join(electronApp.getPath('userData'), 'startup.log');

const writeStartupLog = async (event, details = {}) => {
  const logPath = getStartupLogPath();
  const record = {
    time: new Date().toISOString(),
    event,
    dashboardUrl: DASHBOARD_URL,
    ...details,
  };

  console.log('Photo GPT startup:', record);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`);
};

const waitForDashboard = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isDashboardReachable(DASHBOARD_URL)) {
      return true;
    }
    await delay(100);
  }

  return false;
};

const ensureServer = async () => {
  if (await isDashboardReachable(DASHBOARD_URL)) {
    serverLaunchMode = 'reused';
    const status = await getJson(`${SERVER_ORIGIN}/api/server-status`).catch((err) => ({ statusError: err.message }));
    await writeStartupLog('server-reused', {
      serverStatus: status,
      logFile: getStartupLogPath(),
    });
    return;
  }

  const isPackaged = electronApp.isPackaged;
  const nodePath = isPackaged ? process.execPath : process.env.npm_node_execpath || process.env.NODE || 'node';
  const runtimeDataRoot = isPackaged ? path.join(electronApp.getPath('userData'), 'data') : '';
  const logPath = getStartupLogPath();
  const childEnv = {
    ...process.env,
    PHOTO_GPT_PARENT_PID: String(process.pid),
    PHOTO_GPT_LOG_FILE: logPath,
    PHOTO_GPT_SERVER_SOURCE: isPackaged ? 'electron-packaged-child' : 'electron-dev-child',
  };

  if (isPackaged) {
    childEnv.ELECTRON_RUN_AS_NODE = '1';
    childEnv.PHOTO_GPT_DATA_DIR = runtimeDataRoot;
    childEnv.PHOTO_GPT_PACKAGED = '1';
  }

  await writeStartupLog('server-starting', {
    nodePath,
    serverPath,
    bindHost: '0.0.0.0',
    port: PORT,
    runtimeDataDir: runtimeDataRoot || path.join(projectRoot, 'data'),
    logFile: logPath,
  });

  ownedServerProcess = spawn(nodePath, [serverPath], {
    cwd: projectRoot,
    env: childEnv,
    stdio: isPackaged ? 'ignore' : 'inherit',
    windowsHide: true,
  });

  ownedServerProcess.once('exit', (code, signal) => {
    if (ownedServerProcess) {
      console.error(`Photo GPT server process exited early (${signal || code}).`);
      writeStartupLog('server-exited-early', { code, signal }).catch(() => {});
      ownedServerProcess = null;
    }
  });

  const ready = await waitForDashboard();
  if (!ready) {
    cleanupOwnedServer();
    throw new Error(`The local dashboard did not become ready at ${DASHBOARD_URL}.`);
  }

  serverLaunchMode = 'started';
  const status = await getJson(`${SERVER_ORIGIN}/api/server-status`).catch((err) => ({ statusError: err.message }));
  await writeStartupLog('server-started', {
    serverStatus: status,
    logFile: logPath,
  });
};

const isLocalAppUrl = (targetUrl) => {
  try {
    const parsed = new URL(targetUrl);
    return ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === String(PORT);
  } catch (_err) {
    return false;
  }
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'Photo GPT',
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'Photo GPT',
          width: 1000,
          height: 760,
          autoHideMenuBar: true,
          backgroundColor: '#111827',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const url = new URL(DASHBOARD_URL);
  url.searchParams.set('launcher', 'electron');
  url.searchParams.set('server', serverLaunchMode);
  await mainWindow.loadURL(url.toString());
};

const cleanupOwnedServer = () => {
  if (!ownedServerProcess) {
    return;
  }

  const serverProcess = ownedServerProcess;
  ownedServerProcess = null;

  if (!serverProcess.killed) {
    serverProcess.kill();
  }
};

const gotLock = electronApp.requestSingleInstanceLock();

if (!gotLock) {
  electronApp.quit();
} else {
  electronApp.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  electronApp.whenReady().then(async () => {
    try {
      await ensureServer();
      await createWindow();
    } catch (err) {
      dialog.showErrorBox('Photo GPT could not start', err.message || String(err));
      electronApp.quit();
    }
  });

  electronApp.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });

  electronApp.on('before-quit', cleanupOwnedServer);

  electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      electronApp.quit();
    }
  });
}
