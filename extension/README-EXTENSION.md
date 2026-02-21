# LAN Image Clipboard Copier (Manifest V3)

## Files
- `manifest.json`
- `popup.html`
- `popup.js`
- `service_worker.js`
- `offscreen.html`
- `offscreen.js`

## Load unpacked
1. Open `chrome://extensions`, `brave://extensions`, or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder.

## Use
1. Open popup.
2. Enter base server URL (for example `http://192.168.1.50:8787`).
3. Click **Save** (this requests host permission for the exact origin).
4. Click **Refresh** to read `GET {SERVER}/api/latest`.
5. Click **Copy** to copy real image blob, or **Open** to open image tab.

## Permissions
- `storage`: persist server URL in `chrome.storage.sync`.
- `offscreen`: create offscreen document for clipboard writes.
- `clipboardWrite`: allow clipboard write.
- `optional_host_permissions`: request only the selected origin at runtime (least privilege).

If you prefer simpler setup, you could replace optional host permissions with broad `host_permissions` (`http://*/*`, `https://*/*`), but that grants always-on access to all hosts and is less secure.

## Troubleshooting
- **Offscreen unsupported**: update Brave/Chrome/Edge to a version with `chrome.offscreen`.
- **Permission denied**: click Save again and approve host access prompt.
- **Invalid URL**: use full origin such as `http://192.168.1.50:8787`.
- **Network/CORS errors**: verify LAN reachability and server behavior.
- **Clipboard denied**: browser/OS policy blocked write; retry from user click.

---

## 1) MV3 vs MV2
Manifest V2 used persistent background pages in many extensions. Manifest V3 uses event-driven service workers and tighter security controls. MV3 reduces background resource usage but background code has no DOM.

## 2) Why offscreen document is required
MV3 service workers cannot directly use DOM APIs, and image clipboard writes are most reliable from a document context. `chrome.offscreen` creates that hidden document so clipboard logic can run safely and compatibly.

## 3) How ClipboardItem works
The extension fetches image bytes into a `Blob`, then writes that blob with MIME type mapping:

```js
const item = new ClipboardItem({ [blob.type]: blob });
await navigator.clipboard.write([item]);
```

This copies actual binary image content (not just the URL text).

## 4) Message passing flow (popup <-> SW <-> offscreen)
1. Popup sends `COPY_IMAGE` with image URL.
2. Service worker ensures one offscreen document exists.
3. Service worker forwards `OFFSCREEN_COPY_IMAGE`.
4. Offscreen document fetches blob and writes clipboard.
5. Result propagates back to popup for status updates.

## 5) Security considerations (LAN-only, permissions)
- Intended for LAN servers you control.
- URL is user-provided and stored in sync storage.
- Runtime host permission limits access to selected origin.
- Avoid granting permissions for untrusted endpoints.

## 6) Why host permissions are needed
Extension code must fetch both `{SERVER}/api/latest` and `{SERVER}/files/<filename>` from a user-entered origin. In Chromium extension security, cross-origin fetch is controlled by extension host permissions, so permission must be granted for that origin.
