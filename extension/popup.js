const STORAGE_KEY = 'serverBaseUrl';

const serverInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');

function setStatus(message, type = 'muted') {
  statusEl.textContent = message;
  statusEl.className = type;
}

function normalizeServerUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('Invalid server URL. Example: http://192.168.1.10:8787');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Server URL must start with http:// or https://');
  }

  return parsed.origin;
}

function toHostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}/*`;
}

async function ensureHostPermission(origin) {
  const pattern = toHostPattern(origin);
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error(`Host permission denied for ${pattern}`);
  }
}

async function getSavedOrigin() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return result[STORAGE_KEY] || '';
}

async function saveOrigin() {
  try {
    const origin = normalizeServerUrl(serverInput.value);
    await ensureHostPermission(origin);
    await chrome.storage.sync.set({ [STORAGE_KEY]: origin });
    setStatus(`Saved: ${origin}`, 'ok');
  } catch (error) {
    setStatus(error.message || 'Failed to save server URL.', 'error');
  }
}

async function loadLatest(origin) {
  console.log('[popup] refresh fetch start', { endpoint: `${origin}/api/latest` });
  let response;
  try {
    response = await fetch(`${origin}/api/latest`);
  } catch {
    throw new Error('Server unreachable or CORS/network error while requesting /api/latest.');
  }

  if (!response.ok) {
    throw new Error(`Server returned ${response.status} for /api/latest.`);
  }

  const json = await response.json();
  if (!json || !Array.isArray(json.files)) {
    throw new Error('Invalid API response. Expected { files:[{name,size,url}] }.');
  }

  console.log('[popup] refresh fetch end', { filesCount: json.files.length });
  return json.files;
}

function buildImageUrl(origin, file) {
  if (file && typeof file.url === 'string' && file.url.trim().length > 0) {
    return new URL(file.url, origin).toString();
  }

  if (!file || typeof file.name !== 'string' || file.name.trim().length === 0) {
    throw new Error('Invalid file entry from API (missing name/url).');
  }

  return `${origin}/files/${encodeURIComponent(file.name)}`;
}

async function copyImageFromPopup(imageUrl) {
  console.log('[popup] copy fetch start', { imageUrl });
  let response;
  try {
    response = await fetch(imageUrl);
  } catch (error) {
    console.error('[popup] copy fetch failed', error);
    throw new Error('Network/CORS error while downloading image.');
  }

  console.log('[popup] copy fetch end', { status: response.status });
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.type || !blob.type.startsWith('image/')) {
    throw new Error(`Fetched resource is not an image blob (type: ${blob.type || 'unknown'}).`);
  }

  try {
    console.log('[popup] clipboard write start', { mime: blob.type, size: blob.size });
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    console.log('[popup] clipboard write end');
  } catch (error) {
    console.error('[popup] clipboard write failed', error);
    throw new Error(`Clipboard write denied: ${error?.message || 'unknown error'}`);
  }
}

function makeCard(origin, file) {
  const imageUrl = buildImageUrl(origin, file);

  const card = document.createElement('div');
  card.className = 'card';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = file?.name || 'image';
  img.loading = 'lazy';
  thumbWrap.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${file?.name || '(unnamed)'} (${file?.size ?? 'unknown'} bytes)`;

  const actions = document.createElement('div');
  actions.className = 'actions';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    console.log('[popup] copy clicked', { imageUrl });
    setStatus('Copying...', 'muted');
    copyBtn.disabled = true;
    try {
      await copyImageFromPopup(imageUrl);
      setStatus('Copied!', 'ok');
    } catch (error) {
      console.error('[popup] copy failed', error);
      setStatus(error.message || 'Failed to copy image.', 'error');
    } finally {
      copyBtn.disabled = false;
    }
  });

  const openBtn = document.createElement('button');
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', async () => {
    await chrome.tabs.create({ url: imageUrl });
  });

  actions.append(copyBtn, openBtn);
  card.append(thumbWrap, meta, actions);
  return card;
}

async function refresh() {
  refreshBtn.disabled = true;
  gridEl.textContent = '';
  try {
    const origin = normalizeServerUrl((await getSavedOrigin()) || serverInput.value || '');
    await ensureHostPermission(origin);

    setStatus('Loading...', 'muted');
    const files = await loadLatest(origin);

    if (files.length === 0) {
      console.log('[popup] rendering count computed', { apiFilesCount: 0, renderedCount: 0 });
      setStatus('No files found.', 'muted');
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const file of files) {
      try {
        fragment.appendChild(makeCard(origin, file));
      } catch (error) {
        console.error('[popup] skipping malformed file', { file, error });
      }
    }

    const renderedCount = fragment.childNodes.length;
    console.log('[popup] rendering count computed', {
      apiFilesCount: files.length,
      renderedCount
    });

    if (!renderedCount) {
      setStatus('No valid image entries found in API response.', 'error');
      return;
    }

    gridEl.appendChild(fragment);
    setStatus(`Loaded ${renderedCount} image(s).`, 'ok');
  } catch (error) {
    console.error('[popup] refresh failed', error);
    setStatus(error.message || 'Refresh failed.', 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

async function init() {
  console.log('[popup] popup loaded');

  const saved = await getSavedOrigin();
  if (saved) {
    serverInput.value = saved;
  }

  await refresh();
}

saveBtn.addEventListener('click', saveOrigin);
refreshBtn.addEventListener('click', refresh);
document.addEventListener('DOMContentLoaded', init);
