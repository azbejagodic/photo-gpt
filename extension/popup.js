const STORAGE_KEY = 'serverBaseUrl';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:8787';
const LOOPBACK_FALLBACK_ORIGIN = 'http://127.0.0.1:8787';

const serverInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
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
    throw new Error('Invalid server URL. Example: http://localhost:8787');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Server URL must start with http:// or https://');
  }

  return parsed.origin;
}

function isLoopbackOrigin(origin) {
  try {
    const { hostname, port } = new URL(origin);
    return port === '8787' && (hostname === 'localhost' || hostname === '127.0.0.1');
  } catch {
    return false;
  }
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

async function getPreferredOrigin() {
  const saved = await getSavedOrigin();
  if (!saved) {
    return DEFAULT_SERVER_ORIGIN;
  }

  try {
    const normalized = normalizeServerUrl(saved);
    return isLoopbackOrigin(normalized) ? normalized : DEFAULT_SERVER_ORIGIN;
  } catch {
    return DEFAULT_SERVER_ORIGIN;
  }
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

async function loadLatestWithLoopbackFallback(origin) {
  try {
    return {
      origin,
      files: await loadLatest(origin),
    };
  } catch (error) {
    if (origin !== DEFAULT_SERVER_ORIGIN) {
      throw error;
    }

    await ensureHostPermission(LOOPBACK_FALLBACK_ORIGIN);
    return {
      origin: LOOPBACK_FALLBACK_ORIGIN,
      files: await loadLatest(LOOPBACK_FALLBACK_ORIGIN),
    };
  }
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

async function convertImageBlobToPng(blob) {
  console.log('[popup] convert start', { sourceType: blob.type, sourceSize: blob.size });

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    console.error('[popup] createImageBitmap failed', error);
    throw new Error('Copy blocked. Use Open then Ctrl+C.');
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable.');
    }

    ctx.drawImage(bitmap, 0, 0);

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }
        reject(new Error('Canvas PNG conversion returned null blob.'));
      }, 'image/png');
    });

    console.log('[popup] convert end', { outputType: pngBlob.type, outputSize: pngBlob.size });
    return pngBlob;
  } catch (error) {
    console.error('[popup] PNG conversion failed', error);
    throw new Error('Copy blocked. Use Open then Ctrl+C.');
  } finally {
    bitmap.close();
  }
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

  setStatus('Converting...', 'muted');
  const pngBlob = await convertImageBlobToPng(blob);

  try {
    console.log('[popup] clipboard write start', { mime: 'image/png', size: pngBlob.size });
    const item = new ClipboardItem({ 'image/png': pngBlob });
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
      setStatus('Copied as PNG', 'ok');
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
  gridEl.textContent = '';
  try {
    const origin = normalizeServerUrl(serverInput.value || await getPreferredOrigin());
    await ensureHostPermission(origin);

    setStatus('Loading...', 'muted');
    const result = await loadLatestWithLoopbackFallback(origin);
    const files = result.files;
    const imageOrigin = result.origin;

    if (files.length === 0) {
      console.log('[popup] rendering count computed', { apiFilesCount: 0, renderedCount: 0 });
      setStatus('No files found.', 'muted');
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const file of files) {
      try {
        fragment.appendChild(makeCard(imageOrigin, file));
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
  }
}

async function init() {
  console.log('[popup] popup loaded');

  serverInput.value = await getPreferredOrigin();

  // Popup auto-refreshes on open so users immediately see latest images.
  await refresh();
}

saveBtn.addEventListener('click', saveOrigin);
document.addEventListener('DOMContentLoaded', init);
