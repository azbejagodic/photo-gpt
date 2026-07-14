import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../pwa/app.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../pwa/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../pwa/styles.css', import.meta.url), 'utf8');

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.className = '';
    this.disabled = false;
    this.files = [];
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async dispatch(type) {
    return this.listeners.get(type)?.({ type, target: this });
  }

  appendChild() {}
  setAttribute() {}
}

function createHarness(fetchImpl = async () => ({ ok: true })) {
  const ids = [
    'cameraInput', 'videoInput', 'galleryInput', 'uploadBtn', 'status',
    'selectedGrid', 'selectedCount',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: () => new FakeElement(),
  };
  const context = vm.createContext({
    File: class FakeFile {},
    FormData: class FakeFormData { append() {} },
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    document,
    fetch: fetchImpl,
    navigator: {},
    window: {},
  });

  vm.runInContext(source, context, { filename: 'pwa/app.js' });
  return elements;
}

test('restored PWA shell has no connection-status UI or styling', () => {
  assert.doesNotMatch(markup, /connectionStatus|connectionMessage|retryConnectionBtn/);
  assert.doesNotMatch(styles, /connection-status|retry-connection/);
  assert.doesNotMatch(source, /connecting|connected|disconnected|addEventListener\('online'|addEventListener\('offline'/);
});

test('application mounts without making a startup server request', () => {
  let fetchCount = 0;
  const elements = createHarness(async () => {
    fetchCount += 1;
    throw new TypeError('server unavailable');
  });

  assert.equal(fetchCount, 0);
  assert.equal(elements.status.textContent, 'No files selected yet.');
  assert.equal(elements.uploadBtn.disabled, true);
});

test('an upload network failure is caught and keeps the selected file available', async () => {
  const elements = createHarness(async () => {
    throw new TypeError('server unavailable');
  });

  elements.galleryInput.files = [{ name: 'photo.jpg', type: 'image/jpeg', size: 10 }];
  await elements.galleryInput.dispatch('change');
  assert.equal(elements.uploadBtn.disabled, false);

  await elements.uploadBtn.dispatch('click');
  assert.equal(elements.status.textContent, 'Upload failed. Your selected files are still available.');
  assert.equal(elements.status.className, 'error');
  assert.equal(elements.selectedCount.textContent, 'Selected: 1 / 20');
  assert.equal(elements.uploadBtn.disabled, false);
});

test('legacy app-shell worker and cache cleanup cannot block startup', async () => {
  const unregister = async () => { throw new Error('already gone'); };
  const contextSource = source;
  const ids = [
    'cameraInput', 'videoInput', 'galleryInput', 'uploadBtn', 'status',
    'selectedGrid', 'selectedCount',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const context = vm.createContext({
    File: class FakeFile {},
    FormData: class FakeFormData { append() {} },
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => new FakeElement(),
    },
    fetch: async () => ({ ok: true }),
    navigator: { serviceWorker: { getRegistrations: async () => [{ unregister }] } },
    window: { caches: { keys: async () => ['snapoverlan-shell-v1'], delete: async () => true } },
  });

  assert.doesNotThrow(() => vm.runInContext(contextSource, context, { filename: 'pwa/app.js' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.status.textContent, 'No files selected yet.');
});
