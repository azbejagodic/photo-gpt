const OFFSCREEN_PATH = 'offscreen.html';
let creatingOffscreen;

// Manifest structure note:
// - popup.html runs UI logic
// - service_worker.js handles background events and routing
// - offscreen.html/offscreen.js provide DOM clipboard access unavailable to MV3 service workers

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  // Why offscreen: MV3 service workers have no DOM and cannot reliably use navigator.clipboard for binary images.
  if (!chrome.offscreen?.createDocument) {
    throw new Error('Offscreen API not supported in this browser/version. Use updated Brave/Chrome/Edge.');
  }

  const exists = await hasOffscreenDocument();
  if (exists) {
    console.log('[sw] reusing existing offscreen document');
    return;
  }

  if (!creatingOffscreen) {
    console.log('[sw] creating offscreen document');
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Copy image blobs via ClipboardItem from an offscreen DOM context.'
    }).finally(() => {
      creatingOffscreen = undefined;
    });
  } else {
    console.log('[sw] awaiting in-flight offscreen creation');
  }

  await creatingOffscreen;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Message passing flow: popup -> service worker -> offscreen -> service worker -> popup.
  if (message?.type !== 'COPY_IMAGE') {
    return undefined;
  }

  console.log('[sw] message received', { type: message.type, imageUrl: message.imageUrl });

  (async () => {
    try {
      if (!message.imageUrl || typeof message.imageUrl !== 'string') {
        throw new Error('Missing image URL.');
      }

      await ensureOffscreenDocument();

      console.log('[sw] forwarding message to offscreen', { imageUrl: message.imageUrl });
      const result = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_COPY_IMAGE',
        imageUrl: message.imageUrl
      });
      console.log('[sw] offscreen response', result);

      if (!result?.ok) {
        throw new Error(result?.error || 'Offscreen clipboard operation failed.');
      }

      sendResponse({ ok: true });
    } catch (error) {
      console.error('[sw] copy flow failed', error);
      sendResponse({ ok: false, error: error.message || 'Service worker error.' });
    }
  })();

  return true;
});
