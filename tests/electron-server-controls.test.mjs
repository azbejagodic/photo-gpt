import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyServerStatus } from '../app/server/identity.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const serverEntry = path.join(projectRoot, 'app', 'server', 'index.js');
const mainSource = await readFile(path.join(projectRoot, 'app', 'main.js'), 'utf8');
const serverSource = await readFile(serverEntry, 'utf8');
const preloadSource = await readFile(path.join(projectRoot, 'app', 'preload.cjs'), 'utf8');
const rendererMarkup = await readFile(path.join(projectRoot, 'app', 'renderer', 'index.html'), 'utf8');
const rendererStyles = await readFile(path.join(projectRoot, 'app', 'renderer', 'styles.css'), 'utf8');
const rendererSource = await readFile(path.join(projectRoot, 'app', 'renderer', 'app.js'), 'utf8');
const requestQuitStart = mainSource.indexOf('async function requestQuit()');
const requestQuitEnd = mainSource.indexOf("ipcMain.handle('server:get-state'", requestQuitStart);
const requestQuitSource = mainSource.slice(requestQuitStart, requestQuitEnd);
const windowCloseSource = mainSource.match(
  /mainWindow\.on\('close',[\s\S]*?mainWindow\.on\('closed'/,
)?.[0];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
  return port;
}

async function getStatus(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/server-status`);
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
  return response.json();
}

async function getControl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/server-control`);
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
  return response.json();
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const status = await getStatus(port);
      if (status.status === 'listening') return status;
    } catch {}
    await sleep(100);
  }
  throw new Error('Test server did not become ready');
}

function waitForExit(child, timeoutMs = 5000) {
  return Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    sleep(timeoutMs).then(() => { throw new Error(`Process ${child.pid} did not exit`); }),
  ]);
}

test('preload exposes only automatic server status, retry, and background methods', () => {
  assert.match(mainSource, /preload:\s*preloadPath/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(preloadSource, /getServerState/);
  assert.match(preloadSource, /retryServer/);
  assert.doesNotMatch(preloadSource, /startServer|stopServer|server:start|server:stop/);
  assert.match(preloadSource, /getBackgroundMode/);
  assert.match(preloadSource, /setBackgroundMode/);
  assert.match(preloadSource, /onDesktopStateChanged/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|sendSync)|require:\s*\(/);
});

test('background mode is limited to an online server', () => {
  assert.match(mainSource, /serverState !== 'online' && backgroundMode/);
  assert.match(mainSource, /nextValue && serverState !== 'online'/);
  assert.match(mainSource, /label: `Background Mode:[\s\S]*?enabled: serverIsRunning/);
  assert.match(rendererSource, /backgroundToggleBtn\.disabled = desktopServerState !== 'online'/);
  assert.match(rendererSource, /desktopServerState !== 'online'[\s\S]*?backgroundModeEnabled = false/);
});

test('closing with Background Mode off quits and stops the server', () => {
  assert.notEqual(requestQuitStart, -1);
  assert.notEqual(requestQuitEnd, -1);
  assert.ok(windowCloseSource);
  assert.match(windowCloseSource, /requestQuit\(\)/);
  assert.match(
    requestQuitSource,
    /serverLaunchMode !== 'offline' \|\| ownedServerProcess[\s\S]*?await stopServer\(\)/,
  );
});

test('closing with Background Mode on hides the window and keeps the server alive', () => {
  assert.ok(windowCloseSource);
  assert.match(windowCloseSource, /if \(backgroundMode\) \{[\s\S]*?mainWindow\.hide\(\)[\s\S]*?return/);
});

test('tray Quit, before-quit, and repeated quits share one shutdown path', () => {
  assert.match(requestQuitSource, /if \(serverOperation\) \{[\s\S]*?await serverOperation\.catch/);
  assert.match(
    requestQuitSource,
    /if \(quitOperation\) \{[\s\S]*?return quitOperation/,
  );
  assert.match(mainSource, /label: 'Quit',[\s\S]*?click: \(\) => requestQuit\(\)/);
  assert.match(mainSource, /electronApp\.on\('before-quit',[\s\S]*?requestQuit\(\)/);
  assert.doesNotMatch(mainSource, /label: (?:serverIsRunning \? )?'(?:Start|Stop) Server/);
});

test('unrelated processes are never killed; only verified SnapOverLAN servers receive shutdown', () => {
  assert.match(mainSource, /control\?\.service !== SERVER_CONTROL_ID/);
  assert.match(mainSource, /'x-snapoverlan-shutdown-token': token/);
  assert.match(
    mainSource,
    /if \(!identity && !serverProcess\)[\s\S]*?not a verified SnapOverLAN server/,
  );
  assert.match(mainSource, /if \(!exited && serverProcess\?\.exitCode === null\)/);
  assert.match(serverSource, /const isLoopbackRequest[\s\S]*?remoteAddress/);
  assert.match(serverSource, /crypto\.timingSafeEqual/);
  assert.match(serverSource, /shutdownServer\('localhost-control'\)/);
  assert.doesNotMatch(mainSource, /Leaving the externally managed SnapOverLAN server running/);
});

test('server identity contract recognizes current, legacy, and unrelated responses', () => {
  assert.equal(classifyServerStatus({
    status: 'listening',
    application: 'SnapOverLAN',
    protocolVersion: 1,
    pid: 123,
  }), 'current');
  assert.equal(classifyServerStatus({
    status: 'listening',
    configuredHost: '0.0.0.0',
    bindHost: '0.0.0.0',
    port: 8787,
    lanUrls: [],
    runtimeDataDir: 'data',
    latestDir: 'latest',
    uploadTempDir: 'upload-tmp',
    pid: 123,
  }), 'legacy');
  assert.equal(classifyServerStatus({
    status: 'listening',
    application: 'UnrelatedService',
    protocolVersion: 1,
    configuredHost: '0.0.0.0',
    bindHost: '0.0.0.0',
    port: 8787,
    lanUrls: [],
    runtimeDataDir: 'data',
    latestDir: 'latest',
    uploadTempDir: 'upload-tmp',
    pid: 123,
  }), 'unrelated');
  assert.match(mainSource, /An older SnapOverLAN server is running\. Stop it once and restart the app\./);
  assert.match(mainSource, /if \(existingIdentity\?\.shutdownToken\)/);
});

test('server startup is mandatory, awaited, and cannot start a duplicate', () => {
  assert.match(mainSource, /show: false/);
  assert.match(
    mainSource,
    /await createWindow\(\);[\s\S]*?await startServer\(\)\.catch[\s\S]*?showMainWindow\(\)/,
  );
  assert.match(
    mainSource,
    /if \(serverOperationType === 'start'\) \{[\s\S]*?return serverOperation/,
  );
  assert.match(mainSource, /if \(existingIdentity\?\.shutdownToken\)[\s\S]*?serverLaunchMode = 'reused'/);
  assert.doesNotMatch(mainSource, /serverAutoStart/);
});

test('manual server controls are removed and retry is error-only', () => {
  assert.doesNotMatch(rendererMarkup, /id="serverToggleBtn"/);
  assert.doesNotMatch(rendererSource, /serverToggleBtn|serverToggleOperation|\.startServer\(|\.stopServer\(/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\('server:(?:start|stop)'/);
  assert.match(rendererMarkup, /id="retryServerBtn"[^>]*hidden/);
  assert.match(rendererSource, /retryServerBtn\.hidden = desktopServerState !== 'error'/);
  assert.match(rendererSource, /window\.snapOverLAN\.retryServer\(\)/);
  assert.match(rendererSource, /server\?\.state === 'error'[\s\S]*?server\.error/);
  assert.match(mainSource, /const handleServerControl = async[\s\S]*?return getServerStatePayload\(\)/);
});

test('settings persist only Background Mode and safely ignore legacy fields', () => {
  assert.doesNotMatch(mainSource, /serverAutoStart/);
  assert.match(mainSource, /backgroundMode = settings\.backgroundMode === true/);
  assert.match(mainSource, /JSON\.stringify\(\{\s*backgroundMode,\s*\}/);
});

test('disabling Background Mode restores the window without stopping the server', () => {
  const backgroundModeSource = mainSource.match(
    /async function setBackgroundMode[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(backgroundModeSource);
  assert.match(backgroundModeSource, /if \(backgroundMode\) \{[\s\S]*?createTray\(\)/);
  assert.match(backgroundModeSource, /else \{[\s\S]*?await openMainWindow\(\);[\s\S]*?destroyTray\(\)/);
  assert.doesNotMatch(backgroundModeSource, /stopServer\(/);
});

test('header controls are compact, accessible, and preserve existing actions', () => {
  assert.match(rendererMarkup, /id="connectionPill"/);
  assert.match(rendererMarkup, /id="backgroundToggleBtn"[^>]+aria-label=/);
  assert.match(rendererMarkup, /id="retryServerBtn"/);
  assert.match(rendererMarkup, /id="qrBtn"/);
  assert.match(rendererMarkup, /id="refreshBtn"/);
  assert.match(rendererStyles, /\.header-toggle:focus-visible/);
  assert.match(rendererStyles, /#backgroundToggleBtn:disabled\s*{\s*cursor:\s*default;/);
});

test('desktop typography uses the shared system scale without heavy or fractional text', () => {
  assert.match(
    rendererStyles,
    /font-family: "Segoe UI", Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;/,
  );
  assert.match(rendererStyles, /-webkit-font-smoothing: antialiased;/);
  assert.match(rendererStyles, /-moz-osx-font-smoothing: grayscale;/);
  assert.match(rendererStyles, /text-rendering: optimizeLegibility;/);
  assert.match(
    rendererStyles,
    /button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit;/,
  );
  assert.match(rendererStyles, /body\s*\{[\s\S]*?font-weight: 600;/);
  assert.match(rendererStyles, /\.header-button\s*\{[\s\S]*?font-weight: 700;/);
  assert.match(rendererStyles, /\.status-text\s*\{[\s\S]*?font-weight: 700;/);
  assert.doesNotMatch(rendererStyles, /font-weight:\s*(?!(?:600|700)\b)\d+/);
  assert.doesNotMatch(rendererStyles, /font-size:\s*[^;]*rem/);
  assert.doesNotMatch(rendererStyles, /letter-spacing:/);
});

test('history uses the full pictures workspace and provides a return control', () => {
  assert.match(rendererMarkup, /id="closeBatchesBtn"[^>]*>Back to Pictures<\/button>/);
  assert.match(rendererSource, /setBatchHistoryOpen\(true\)/);
  assert.match(rendererSource, /setBatchHistoryOpen\(false\)/);
  assert.match(rendererStyles, /\.pictures-panel\.history-open #photoGrid[\s\S]*?display:\s*none/);
  assert.match(rendererStyles, /\.pictures-panel\.history-open \.batches-panel[\s\S]*?flex:\s*1 1 auto/);
});

test('retention Save is disabled only when the selected value is already saved', () => {
  assert.match(rendererSource, /savedRetentionValue !== null[\s\S]*?retentionSelect\.value === savedRetentionValue/);
  assert.match(rendererSource, /savedRetentionValue = normalizeRetentionValue\(settings\.retentionDays\)[\s\S]*?updateRetentionSaveButton\(\)/);
  assert.match(rendererSource, /retentionSelect\?\.addEventListener\('change', updateRetentionSaveButton\)/);
});

test('verified reused server requires authentication and shuts down gracefully', async (t) => {
  const port = await getFreePort();
  const childEnv = {
    ...process.env,
    SNAPOVERLAN_PORT: String(port),
    SNAPOVERLAN_SERVER_SOURCE: 'electron-control-test',
  };
  const server = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  t.after(() => {
    if (server.exitCode === null) server.kill();
  });

  const publicStatus = await waitForServer(port);
  assert.equal(publicStatus.application, 'SnapOverLAN');
  assert.equal(publicStatus.protocolVersion, 1);
  assert.equal(classifyServerStatus(publicStatus), 'current');

  const control = await getControl(port);
  assert.equal(control.service, 'snapoverlan-server-control-v1');
  assert.equal(control.server.application, 'SnapOverLAN');
  assert.equal(control.server.protocolVersion, 1);
  assert.equal(classifyServerStatus(control.server), 'current');
  assert.equal(control.server.status, 'listening');
  assert.match(control.shutdownToken, /^[a-f0-9]{64}$/);

  const rejected = await fetch(`http://127.0.0.1:${port}/api/server-shutdown`, {
    method: 'POST',
    headers: { 'x-snapoverlan-shutdown-token': 'not-the-token' },
  });
  assert.equal(rejected.status, 404);
  assert.equal((await getStatus(port)).status, 'listening');

  let duplicateError = '';
  const duplicate = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  });
  duplicate.stderr.on('data', (chunk) => { duplicateError += chunk; });
  const duplicateExit = await waitForExit(duplicate);
  assert.notEqual(duplicateExit.code, 0);
  assert.match(duplicateError, /EADDRINUSE|address already in use/i);

  const exitPromise = waitForExit(server);
  const shutdownStartedAt = Date.now();
  const accepted = await fetch(`http://127.0.0.1:${port}/api/server-shutdown`, {
    method: 'POST',
    headers: { 'x-snapoverlan-shutdown-token': control.shutdownToken },
  });
  assert.equal(accepted.status, 202);
  const cleanExit = await exitPromise;
  assert.equal(cleanExit.code, 0);
  const shutdownElapsedMs = Date.now() - shutdownStartedAt;
  assert.ok(shutdownElapsedMs < 1200);
  t.diagnostic(`authenticated reused-server shutdown: ${shutdownElapsedMs} ms`);

  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/server-status`));
});

test('an Electron-owned server stops cleanly over IPC', async (t) => {
  const port = await getFreePort();
  const server = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SNAPOVERLAN_PORT: String(port),
      SNAPOVERLAN_PARENT_PID: String(process.pid),
      SNAPOVERLAN_SERVER_SOURCE: 'electron-owned-control-test',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  t.after(() => {
    if (server.exitCode === null) server.kill();
  });

  await waitForServer(port);
  const exitPromise = waitForExit(server);
  const shutdownStartedAt = Date.now();
  server.send({ type: 'snapoverlan:shutdown' });
  const cleanExit = await exitPromise;
  assert.equal(cleanExit.code, 0);
  const shutdownElapsedMs = Date.now() - shutdownStartedAt;
  assert.ok(shutdownElapsedMs < 1000);
  t.diagnostic(`owned IPC shutdown: ${shutdownElapsedMs} ms`);
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/server-status`));
});

test('shutdown cleans up remaining server sockets after a short grace period', async (t) => {
  const port = await getFreePort();
  const server = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SNAPOVERLAN_PORT: String(port),
      SNAPOVERLAN_PARENT_PID: String(process.pid),
      SNAPOVERLAN_SERVER_SOURCE: 'electron-socket-cleanup-test',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  t.after(() => {
    if (server.exitCode === null) server.kill();
  });

  await waitForServer(port);
  const heldSocket = createConnection({ host: '127.0.0.1', port });
  heldSocket.on('error', () => {});
  t.after(() => heldSocket.destroy());
  await new Promise((resolve) => heldSocket.once('connect', resolve));
  heldSocket.write(`GET /api/server-status HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`);

  const exitPromise = waitForExit(server);
  const shutdownStartedAt = Date.now();
  server.send({ type: 'snapoverlan:shutdown' });
  const cleanExit = await exitPromise;
  assert.equal(cleanExit.code, 0);
  const shutdownElapsedMs = Date.now() - shutdownStartedAt;
  assert.ok(shutdownElapsedMs < 1400);
  t.diagnostic(`shutdown with held socket: ${shutdownElapsedMs} ms`);
  assert.equal(heldSocket.destroyed, true);
});
