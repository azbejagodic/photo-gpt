import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const serverEntry = path.join(projectRoot, 'app', 'server', 'index.js');
const mainSource = await readFile(path.join(projectRoot, 'app', 'main.js'), 'utf8');
const preloadSource = await readFile(path.join(projectRoot, 'app', 'preload.cjs'), 'utf8');
const rendererMarkup = await readFile(path.join(projectRoot, 'app', 'renderer', 'index.html'), 'utf8');
const rendererStyles = await readFile(path.join(projectRoot, 'app', 'renderer', 'styles.css'), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getStatus() {
  const response = await fetch('http://127.0.0.1:8787/api/server-status');
  if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
  return response.json();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const status = await getStatus();
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

test('preload exposes only the scoped server and background methods', () => {
  assert.match(mainSource, /preload:\s*preloadPath/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(preloadSource, /getServerState/);
  assert.match(preloadSource, /startServer/);
  assert.match(preloadSource, /stopServer/);
  assert.match(preloadSource, /getBackgroundMode/);
  assert.match(preloadSource, /setBackgroundMode/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|sendSync)|require:\s*\(/);
});

test('header controls are compact, accessible, and preserve existing actions', () => {
  assert.match(rendererMarkup, /id="connectionPill"/);
  assert.match(rendererMarkup, /id="serverToggleBtn"[^>]+aria-label=/);
  assert.match(rendererMarkup, /id="backgroundToggleBtn"[^>]+aria-label=/);
  assert.match(rendererMarkup, /id="qrBtn"/);
  assert.match(rendererMarkup, /id="refreshBtn"/);
  assert.match(rendererStyles, /\.header-toggle:focus-visible/);
});

test('server rejects a duplicate instance and exits cleanly over owned IPC', async (t) => {
  try {
    await getStatus();
    assert.fail('Port 8787 is already occupied before the lifecycle test');
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
  }

  const childEnv = {
    ...process.env,
    SNAPOVERLAN_PARENT_PID: String(process.pid),
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

  await waitForServer();

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
  server.send({ type: 'snapoverlan:shutdown' });
  const cleanExit = await exitPromise;
  assert.equal(cleanExit.code, 0);

  await assert.rejects(() => fetch('http://127.0.0.1:8787/api/server-status'));
});
