const MAX_FILES = 20;

const cameraInput = document.getElementById('cameraInput');
const videoInput = document.getElementById('videoInput');
const galleryInput = document.getElementById('galleryInput');
const uploadBtn = document.getElementById('uploadBtn');
const statusEl = document.getElementById('status');

const selectedGrid = document.getElementById('selectedGrid');
const selectedCount = document.getElementById('selectedCount');

// File inputs expose a transient, read-only FileList, so this array is the tray's source of truth.
let selectedFiles = [];
let hasEverSelectedFiles = false;

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = kind ? kind : '';
}

function updateSelectedCount() {
  selectedCount.textContent = `Selected: ${selectedFiles.length} / ${MAX_FILES}`;
  uploadBtn.disabled = selectedFiles.length === 0;
}

function isVideoFile(file) {
  return file.type?.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name || '');
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getVideoExtension(file) {
  const nameExtension = file.name?.split('.').pop()?.toLowerCase();
  if (['mp4', 'mov', 'webm'].includes(nameExtension)) {
    return nameExtension;
  }

  if (file.type === 'video/mp4') return 'mp4';
  if (file.type === 'video/quicktime') return 'mov';
  return 'webm';
}

function getVideoType(file) {
  if (['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) {
    return file.type;
  }

  const extension = getVideoExtension(file);
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  return 'video/webm';
}

function normalizeRecordedVideo(file) {
  const type = getVideoType(file);
  const extension = getVideoExtension({ name: file.name, type });
  const hasVideoExtension = /\.(mp4|mov|webm)$/i.test(file.name || '');

  if (file instanceof File && file.name && file.type === type && hasVideoExtension) {
    return file;
  }

  return new File(
    [file],
    hasVideoExtension ? file.name : `recorded-video-${Date.now()}.${extension}`,
    {
      type,
      lastModified: Date.now(),
    },
  );
}

function renderSelectedTray() {
  selectedGrid.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const tile = document.createElement('div');
    tile.className = 'tile';

    if (isVideoFile(file)) {
      const videoTile = document.createElement('div');
      videoTile.className = 'video-tile';

      const label = document.createElement('span');
      label.className = 'video-label';
      label.textContent = 'Video';

      const name = document.createElement('span');
      name.className = 'video-name';
      name.textContent = file.name || `video-${index + 1}`;

      const meta = document.createElement('span');
      meta.className = 'video-meta';
      meta.textContent = [file.type || 'video', formatFileSize(file.size)].filter(Boolean).join(' - ');

      videoTile.append(label, name, meta);
      tile.appendChild(videoTile);
    } else {
      const img = document.createElement('img');
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;
      img.alt = file.name || `selected-${index + 1}`;
      img.onload = () => URL.revokeObjectURL(objectUrl);
      tile.appendChild(img);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove';
    removeBtn.setAttribute('aria-label', `Remove media ${index + 1}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderSelectedTray();
      updateSelectedCount();
      if (selectedFiles.length === 0) setStatus('Tray is empty.');
    });

    tile.appendChild(removeBtn);
    selectedGrid.appendChild(tile);
  });

}

function appendFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  if (selectedFiles.length >= MAX_FILES) {
    setStatus(`Limit reached (${MAX_FILES}). Remove a file before adding more.`, 'error');
    return;
  }

  const availableSlots = MAX_FILES - selectedFiles.length;
  const acceptedFiles = files.slice(0, availableSlots);
  if (acceptedFiles.length === 0) {
    return;
  }

  hasEverSelectedFiles = true;
  selectedFiles.push(...acceptedFiles);

  if (acceptedFiles.length < files.length) {
    setStatus(`Added ${acceptedFiles.length}. Tray limit is ${MAX_FILES}, extra files were skipped.`, 'error');
  } else {
    setStatus(`Added ${acceptedFiles.length} file${acceptedFiles.length > 1 ? 's' : ''} to tray.`);
  }

  renderSelectedTray();
  updateSelectedCount();
}

function appendRecordedVideos(fileList) {
  appendFiles(Array.from(fileList || []).map(normalizeRecordedVideo));
}

cameraInput.addEventListener('change', () => {
  appendFiles(cameraInput.files);
  cameraInput.value = '';
});

videoInput.addEventListener('change', () => {
  appendRecordedVideos(videoInput.files);
  videoInput.value = '';
});

galleryInput.addEventListener('change', () => {
  appendFiles(galleryInput.files);
  galleryInput.value = '';
});

uploadBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) {
    setStatus('Add at least one file before upload.', 'error');
    return;
  }

  uploadBtn.disabled = true;
  setStatus('Uploading...');

  try {
    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append('photos', file, file.name));

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) throw new Error(`Upload failed (${response.status})`);

    const uploadedCount = selectedFiles.length;
    selectedFiles = [];
    renderSelectedTray();
    updateSelectedCount();
    setStatus(`Uploaded ${uploadedCount} file${uploadedCount > 1 ? 's' : ''}.`, 'success');
  } catch (error) {
    setStatus('Upload failed. Your selected files are still available.', 'error');
    uploadBtn.disabled = selectedFiles.length === 0;
  }
});

updateSelectedCount();
renderSelectedTray();
if (!hasEverSelectedFiles && selectedFiles.length === 0) {
  setStatus('No files selected yet.');
}

// Retire the temporary app-shell worker so it cannot keep an older HTML/JS pair alive.
// Every operation is best-effort and deliberately isolated from application startup.
if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {});
}

if ('caches' in window) {
  window.caches.keys()
    .then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('snapoverlan-shell-'))
        .map((key) => window.caches.delete(key)),
    ))
    .catch(() => {});
}
