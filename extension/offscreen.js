async function copyImageToClipboard(imageUrl) {
  let response;
  try {
    response = await fetch(imageUrl);
  } catch {
    throw new Error('Network/CORS error while downloading image for clipboard.');
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.type || !blob.type.startsWith('image/')) {
    throw new Error(`Fetched resource is not an image blob (type: ${blob.type || 'unknown'}).`);
  }

  try {
    // ClipboardItem usage required by spec: MIME type key maps to the image Blob.
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
  } catch {
    throw new Error('Clipboard write denied or unavailable.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OFFSCREEN_COPY_IMAGE') {
    return undefined;
  }

  (async () => {
    try {
      await copyImageToClipboard(message.imageUrl);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || 'Offscreen clipboard error.' });
    }
  })();

  return true;
});
