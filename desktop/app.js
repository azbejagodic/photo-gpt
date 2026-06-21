const refreshBtn = document.getElementById('refreshBtn');
const phoneUrlInput = document.getElementById('phoneUrl');
const copyPhoneUrlBtn = document.getElementById('copyPhoneUrlBtn');
const setupStatus = document.getElementById('setupStatus');
const alternateUrls = document.getElementById('alternateUrls');
const phoneQr = document.getElementById('phoneQr');
const qrFallback = document.getElementById('qrFallback');
const photoSummary = document.getElementById('photoSummary');
const emptyState = document.getElementById('emptyState');
const photoGrid = document.getElementById('photoGrid');
const diagnosticsSummary = document.getElementById('diagnosticsSummary');
const diagnosticsList = document.getElementById('diagnosticsList');
const diagnosticsWarning = document.getElementById('diagnosticsWarning');
const diagnosticsUrls = document.getElementById('diagnosticsUrls');

const QR_VERSION = 2;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_DATA_CODEWORDS = 34;
const QR_ECC_CODEWORDS = 10;
const GF_EXP = [];
const GF_LOG = [];

let currentPhoneUrl = '';
const launchParams = new URLSearchParams(window.location.search);

function initGaloisTables() {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }

  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMultiply(a, b) {
  if (a === 0 || b === 0) {
    return 0;
  }
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function getUtf8Bytes(text) {
  if (window.TextEncoder) {
    return Array.from(new TextEncoder().encode(text));
  }

  return Array.from(unescape(encodeURIComponent(text))).map((char) => char.charCodeAt(0));
}

function appendBits(target, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    target.push(((value >>> i) & 1) === 1);
  }
}

function createDataCodewords(text) {
  const bytes = getUtf8Bytes(text);
  if (bytes.length > 32) {
    throw new Error('Phone URL is too long for the built-in QR code.');
  }

  const bits = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));

  const maxBits = QR_DATA_CODEWORDS * 8;
  const terminatorLength = Math.min(4, maxBits - bits.length);
  appendBits(bits, 0, terminatorLength);

  while (bits.length % 8 !== 0) {
    bits.push(false);
  }

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | (bits[i + j] ? 1 : 0);
    }
    codewords.push(value);
  }

  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < QR_DATA_CODEWORDS; i += 1) {
    codewords.push(pads[i % 2]);
  }

  return codewords;
}

function reedSolomonRemainder(data, degree) {
  const coefficients = new Array(degree).fill(0);
  coefficients[degree - 1] = 1;

  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      coefficients[j] = gfMultiply(coefficients[j], root);
      if (j + 1 < degree) {
        coefficients[j] ^= coefficients[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }

  const result = new Array(degree).fill(0);
  data.forEach((value) => {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i += 1) {
      result[i] ^= gfMultiply(coefficients[i], factor);
    }
  });

  return result;
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function createBaseMatrix() {
  const modules = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));
  const reserved = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));

  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) {
      return;
    }
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  const drawFinder = (left, top) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        setFunction(left + x, top + y, false);
      }
    }

    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        setFunction(left + x, top + y, edge || center);
      }
    }
  };

  const drawAlignment = (centerX, centerY) => {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setFunction(centerX + x, centerY + y, distance === 0 || distance === 2);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(QR_SIZE - 7, 0);
  drawFinder(0, QR_SIZE - 7);
  drawAlignment(18, 18);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunction(i, 6, dark);
    setFunction(6, i, dark);
  }

  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      setFunction(8, i, false);
      setFunction(i, 8, false);
    }
  }

  for (let i = 0; i < 8; i += 1) {
    setFunction(QR_SIZE - 1 - i, 8, false);
    setFunction(8, QR_SIZE - 1 - i, false);
  }

  setFunction(8, QR_SIZE - 8, true);
  return { modules, reserved };
}

function drawFormatBits(modules, mask) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }

  const bits = ((data << 10) | remainder) ^ 0x5412;
  const getBit = (index) => ((bits >>> index) & 1) === 1;
  const set = (x, y, dark) => {
    modules[y][x] = dark;
  };

  for (let i = 0; i <= 5; i += 1) {
    set(8, i, getBit(i));
  }
  set(8, 7, getBit(6));
  set(8, 8, getBit(7));
  set(7, 8, getBit(8));
  for (let i = 9; i < 15; i += 1) {
    set(14 - i, 8, getBit(i));
  }

  for (let i = 0; i < 8; i += 1) {
    set(QR_SIZE - 1 - i, 8, getBit(i));
  }
  for (let i = 8; i < 15; i += 1) {
    set(8, QR_SIZE - 15 + i, getBit(i));
  }
  set(8, QR_SIZE - 8, true);
}

function drawCodewords(codewords, mask) {
  const { modules, reserved } = createBaseMatrix();
  const bits = [];
  codewords.forEach((codeword) => appendBits(bits, codeword, 8));

  let bitIndex = 0;
  let upward = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (reserved[y][x]) {
          continue;
        }

        const bit = bitIndex < bits.length ? bits[bitIndex] : false;
        bitIndex += 1;
        modules[y][x] = bit !== maskCondition(mask, x, y);
      }
    }
    upward = !upward;
  }

  drawFormatBits(modules, mask);
  return modules;
}

function getRunPenalty(values) {
  let penalty = 0;
  let runColor = values[0];
  let runLength = 1;

  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === runColor) {
      runLength += 1;
      continue;
    }

    if (runLength >= 5) {
      penalty += 3 + runLength - 5;
    }
    runColor = values[i];
    runLength = 1;
  }

  if (runLength >= 5) {
    penalty += 3 + runLength - 5;
  }

  return penalty;
}

function getPenaltyScore(modules) {
  let penalty = 0;
  for (let y = 0; y < QR_SIZE; y += 1) {
    penalty += getRunPenalty(modules[y]);
  }

  for (let x = 0; x < QR_SIZE; x += 1) {
    const column = [];
    for (let y = 0; y < QR_SIZE; y += 1) {
      column.push(modules[y][x]);
    }
    penalty += getRunPenalty(column);
  }

  for (let y = 0; y < QR_SIZE - 1; y += 1) {
    for (let x = 0; x < QR_SIZE - 1; x += 1) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

function createQrMatrix(text) {
  const dataCodewords = createDataCodewords(text);
  const errorCodewords = reedSolomonRemainder(dataCodewords, QR_ECC_CODEWORDS);
  const codewords = dataCodewords.concat(errorCodewords);
  let best = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const modules = drawCodewords(codewords, mask);
    const penalty = getPenaltyScore(modules);
    if (!best || penalty < best.penalty) {
      best = { modules, penalty };
    }
  }

  return best.modules;
}

function drawQrCode(canvas, text) {
  const modules = createQrMatrix(text);
  const quietZone = 4;
  const scale = 8;
  const size = (modules.length + quietZone * 2) * scale;
  const context = canvas.getContext('2d');

  canvas.width = size;
  canvas.height = size;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#111827';

  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (modules[y][x]) {
        context.fillRect((x + quietZone) * scale, (y + quietZone) * scale, scale, scale);
      }
    }
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'Unknown size';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function renderAlternateUrls(urls) {
  if (!Array.isArray(urls) || urls.length <= 1) {
    alternateUrls.hidden = true;
    alternateUrls.innerHTML = '';
    return;
  }

  alternateUrls.hidden = false;
  alternateUrls.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = 'Other detected LAN URLs';
  const list = document.createElement('ul');

  urls.forEach((item) => {
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.url;
    link.textContent = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  alternateUrls.append(title, list);
}

function renderUrlList(container, titleText, urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.hidden = false;
  container.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = titleText;
  const list = document.createElement('ul');

  urls.forEach((item) => {
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.url;
    link.textContent = item.private ? `${item.url} (private LAN)` : item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  container.append(title, list);
}

function addDiagnosticRow(label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value || 'Not available';
  diagnosticsList.append(term, description);
}

function getLauncherStatus() {
  const serverMode = launchParams.get('server');
  if (serverMode === 'started') {
    return 'Electron started the local server';
  }
  if (serverMode === 'reused') {
    return 'Electron reused an existing server';
  }
  return 'Browser or unknown launcher';
}

function renderDiagnostics(data) {
  diagnosticsList.innerHTML = '';
  diagnosticsSummary.textContent = data.status === 'listening' ? 'Server is listening.' : 'Server status is unknown.';

  addDiagnosticRow('Server status', data.status || 'unknown');
  addDiagnosticRow('Launcher', getLauncherStatus());
  addDiagnosticRow('Server source', data.launchSource || 'unknown');
  addDiagnosticRow('Bind host', data.bindHost || data.configuredHost || 'unknown');
  addDiagnosticRow('Port', String(data.port || 'unknown'));
  addDiagnosticRow('Primary phone URL', data.primaryLanUrl || 'No LAN URL detected');
  addDiagnosticRow('Runtime data', data.runtimeDataDir || 'unknown');
  addDiagnosticRow('Upload staging', data.uploadTempDir || 'unknown');

  const privateLanUrls = Array.isArray(data.lanUrls) ? data.lanUrls.filter((item) => item.private) : [];
  renderUrlList(diagnosticsUrls, 'Detected LAN URLs', data.lanUrls || []);

  if (privateLanUrls.length === 0) {
    diagnosticsWarning.hidden = false;
    diagnosticsWarning.textContent = 'No private LAN IPv4 address was detected. Make sure the PC is connected to the same Wi-Fi as the phone, the network profile is Private, and Windows Firewall allows Photo GPT on Private networks.';
  } else {
    diagnosticsWarning.hidden = false;
    diagnosticsWarning.textContent = 'Phone checklist: use the LAN URL above, keep phone and PC on the same Wi-Fi, set the PC network to Private, and allow Photo GPT through Windows Firewall on Private networks if Windows asks.';
  }
}

function renderPhoneSetup(data) {
  currentPhoneUrl = data.primaryUrl || window.location.origin;
  phoneUrlInput.value = currentPhoneUrl;
  setupStatus.textContent = 'Use this address from Safari or Chrome on your phone while both devices are on the same Wi-Fi.';
  setupStatus.className = 'status';
  renderAlternateUrls(data.urls);

  try {
    drawQrCode(phoneQr, currentPhoneUrl);
    qrFallback.textContent = '';
    phoneQr.hidden = false;
  } catch (error) {
    phoneQr.hidden = true;
    qrFallback.textContent = error.message || 'QR code could not be generated.';
  }
}

function renderPhotos(files) {
  photoGrid.innerHTML = '';
  emptyState.hidden = files.length > 0;
  photoSummary.textContent = files.length === 1 ? '1 photo' : `${files.length} photos`;

  files.forEach((file) => {
    const card = document.createElement('article');
    card.className = 'photo-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    const image = document.createElement('img');
    image.src = file.url;
    image.alt = file.name;
    image.loading = 'lazy';
    thumbWrap.appendChild(image);

    const body = document.createElement('div');
    body.className = 'photo-body';

    const name = document.createElement('div');
    name.className = 'photo-name';
    name.title = file.name;
    name.textContent = file.name;

    const meta = document.createElement('div');
    meta.className = 'photo-meta';
    meta.textContent = formatBytes(file.size);

    const actions = document.createElement('div');
    actions.className = 'photo-actions';

    const openButton = document.createElement('button');
    openButton.className = 'button primary';
    openButton.type = 'button';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', () => {
      window.open(file.url, '_blank', 'noopener');
    });

    const downloadLink = document.createElement('a');
    downloadLink.className = 'button secondary';
    downloadLink.href = file.url;
    downloadLink.download = file.name;
    downloadLink.textContent = 'Download';

    actions.append(openButton, downloadLink);
    body.append(name, meta, actions);
    card.append(thumbWrap, body);
    photoGrid.appendChild(card);
  });
}

function getDashboardFiles(files) {
  return files.filter((file) => file.name && !file.name.startsWith('.'));
}

async function loadPhoneSetup() {
  try {
    const response = await fetch('/api/phone-url');
    if (!response.ok) {
      throw new Error(`Phone URL request failed (${response.status})`);
    }
    renderPhoneSetup(await response.json());
  } catch (error) {
    renderPhoneSetup({ primaryUrl: window.location.origin, urls: [{ url: window.location.origin }] });
    setupStatus.textContent = error.message || 'Using this browser address as a fallback.';
    setupStatus.className = 'status error';
  }
}

async function loadDiagnostics() {
  try {
    const response = await fetch('/api/server-status');
    if (!response.ok) {
      throw new Error(`Server status request failed (${response.status})`);
    }
    renderDiagnostics(await response.json());
  } catch (error) {
    diagnosticsList.innerHTML = '';
    diagnosticsSummary.textContent = error.message || 'Could not load server diagnostics.';
    diagnosticsWarning.hidden = false;
    diagnosticsWarning.textContent = 'Check that the local server is running and reload the dashboard.';
  }
}

async function loadPhotos() {
  refreshBtn.disabled = true;
  photoSummary.textContent = 'Refreshing...';

  try {
    const response = await fetch('/api/latest');
    if (!response.ok) {
      throw new Error(`Photo request failed (${response.status})`);
    }
    const data = await response.json();
    renderPhotos(getDashboardFiles(Array.isArray(data.files) ? data.files : []));
  } catch (error) {
    photoGrid.innerHTML = '';
    emptyState.hidden = false;
    photoSummary.textContent = error.message || 'Could not load photos.';
  } finally {
    refreshBtn.disabled = false;
  }
}

initGaloisTables();

refreshBtn.addEventListener('click', loadPhotos);
copyPhoneUrlBtn.addEventListener('click', async () => {
  if (!currentPhoneUrl) {
    return;
  }

  try {
    await copyText(currentPhoneUrl);
    setupStatus.textContent = 'Phone upload URL copied.';
    setupStatus.className = 'status';
  } catch (_error) {
    setupStatus.textContent = 'Copy failed. Select the URL and copy it manually.';
    setupStatus.className = 'status error';
  }
});

loadPhoneSetup();
loadDiagnostics();
loadPhotos();
