# Photo Bridge Extension (Manifest V3)

Browser extension for copying images from the local Photo GPT Bridge server directly to the clipboard.

This extension is designed for Chrome, Brave, and other Chromium-based browsers supporting Manifest V3.

---

# Files

- manifest.json  
- popup.html  
- popup.js  
- service_worker.js  
- offscreen.html  
- offscreen.js  

---

# Installation (Load Unpacked)

1. Open:
   - chrome://extensions
   - brave://extensions
   - edge://extensions

2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder

---

# Usage

1. Open the extension popup.
2. Enter the base server URL, for example:

   http://192.168.1.50:8787

3. Click **Save**  
   (This requests host permission for that specific origin.)
4. The popup auto-refreshes and reads:

   GET {SERVER}/api/latest

5. Click:
   - **Copy** to copy the image blob to clipboard
   - **Open** to open the image in a new browser tab

---

# Permissions

- storage  
  Persist server URL using chrome.storage.sync.

- offscreen  
  Create an offscreen document required for certain clipboard operations.

- clipboardWrite  
  Allow writing image data to the clipboard.

- optional_host_permissions  
  Request access only to the specific server origin entered by the user.

If you prefer simpler configuration, you may replace optional host permissions with:

http://*/*  
https://*/*  

However, this grants broader host access and reduces security.

---

# Troubleshooting

Offscreen unsupported  
Update your browser to a recent version supporting chrome.offscreen.

Permission denied  
Click Save again and approve the host access prompt.

Invalid URL  
Use a full origin including protocol and port, e.g.:

http://192.168.1.50:8787

Network or CORS errors  
Verify:
- Phone and PC are on the same network
- Windows firewall allows port 8787
- Server is running

Clipboard denied  
Some browser or OS policies may block clipboard writes. Retry directly from the user click.

---

# Technical Notes

## Manifest V3 vs Manifest V2

Manifest V2 used persistent background pages.  
Manifest V3 uses event-driven service workers with stricter security.

In MV3:
- Background code runs in a service worker
- Service workers have no DOM access
- Security and permission boundaries are stricter

---

## Why an Offscreen Document Is Used

MV3 service workers cannot access DOM APIs directly.

Image clipboard writes are more reliable from a document context.  
The chrome.offscreen API creates a hidden document that performs clipboard operations safely.

---

## How ClipboardItem Works

The extension fetches the image as a Blob, then writes it to the clipboard:

```js
const item = new ClipboardItem({ [blob.type]: blob });
await navigator.clipboard.write([item]);
```

This copies actual binary image content, not just the image URL.

---

## Message Passing Flow

1. Popup sends COPY_IMAGE with image URL.
2. Service worker ensures an offscreen document exists.
3. Service worker forwards message to offscreen.
4. Offscreen fetches image and writes clipboard.
5. Result is returned to popup for status display.

---

## Security Considerations

- Designed for LAN-only use.
- The server URL is user-provided.
- Host permissions are requested only for the selected origin.
- Do not grant permissions for untrusted endpoints.

---

## Why Host Permissions Are Required

The extension must fetch:

- {SERVER}/api/latest
- {SERVER}/files/<filename>

Chromium extension security restricts cross-origin requests.  
Explicit host permission is required for the chosen server origin.