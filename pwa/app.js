const MAX_FILES = 20;

const cameraInput = document.getElementById('cameraInput');
const galleryInput = document.getElementById('galleryInput');
const uploadBtn = document.getElementById('uploadBtn');
const statusEl = document.getElementById('status');

const selectedGrid = document.getElementById('selectedGrid');
const selectedEmpty = document.getElementById('selectedEmpty');
const selectedCount = document.getElementById('selectedCount');

// File inputs expose a transient, read-only FileList, so this array is the tray's source of truth.
let selectedFiles = [];

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = kind ? kind : '';
}

function updateSelectedCount() {
  selectedCount.textContent = `Selected: ${selectedFiles.length} / ${MAX_FILES}`;
  uploadBtn.disabled = selectedFiles.length === 0;
}

function renderSelectedTray() {
  selectedGrid.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const tile = document.createElement('div');
    tile.className = 'tile';

    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    img.alt = file.name || `selected-${index + 1}`;
    img.onload = () => URL.revokeObjectURL(objectUrl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove';
    removeBtn.setAttribute('aria-label', `Remove photo ${index + 1}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderSelectedTray();
      updateSelectedCount();
      if (selectedFiles.length === 0) setStatus('Selected tray is empty.');
    });

    tile.appendChild(img);
    tile.appendChild(removeBtn);
    selectedGrid.appendChild(tile);
  });

  selectedEmpty.hidden = selectedFiles.length > 0;
}

function appendFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  if (selectedFiles.length >= MAX_FILES) {
    setStatus(`Limit reached (${MAX_FILES}). Remove a photo before adding more.`, 'error');
    return;
  }

  const availableSlots = MAX_FILES - selectedFiles.length;
  const acceptedFiles = files.slice(0, availableSlots);
  selectedFiles.push(...acceptedFiles);

  if (acceptedFiles.length < files.length) {
    setStatus(`Added ${acceptedFiles.length}. Tray limit is ${MAX_FILES}, extra photos were skipped.`, 'error');
  } else {
    setStatus(`Added ${acceptedFiles.length} photo${acceptedFiles.length > 1 ? 's' : ''} to tray.`);
  }

  renderSelectedTray();
  updateSelectedCount();
}

cameraInput.addEventListener('change', () => {
  appendFiles(cameraInput.files);
  cameraInput.value = '';
});

galleryInput.addEventListener('change', () => {
  appendFiles(galleryInput.files);
  galleryInput.value = '';
});

uploadBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) {
    setStatus('Add at least one photo before upload.', 'error');
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
    setStatus(`Uploaded ${uploadedCount} photo${uploadedCount > 1 ? 's' : ''}.`, 'success');
  } catch (error) {
    setStatus(error.message || 'Upload failed. Please try again.', 'error');
    uploadBtn.disabled = selectedFiles.length === 0;
  }
});

updateSelectedCount();
renderSelectedTray();
