async function copyImageToClipboard(imageUrl) {
  let response;
  try {
    console.log('[offscreen] image fetch start', { imageUrl });
    response = await fetch(imageUrl);
    console.log('[offscreen] image fetch end', { status: response.status });
  } catch (error) {
    console.error('[offscreen] image fetch failed', error);
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
    console.log('[offscreen] clipboard write start', { mime: blob.type, size: blob.size });
    // ClipboardItem usage required by spec: MIME type key maps to the image Blob.
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    console.log('[offscreen] clipboard write end');
  } catch (error) {
    console.error('[offscreen] clipboard write failed', error);
    throw new Error('Clipboard write denied. Use Open then Ctrl+C as fallback.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OFFSCREEN_COPY_IMAGE') {
    return undefined;
  }

  console.log('[offscreen] message received', { type: message.type, imageUrl: message.imageUrl });

  (async () => {
    try {
      await copyImageToClipboard(message.imageUrl);
      sendResponse({ ok: true });
    } catch (error) {
      console.error('[offscreen] copy flow failed', error);
      sendResponse({ ok: false, error: error.message || 'Offscreen clipboard error.' });
    }
  })();

  return true;
});
