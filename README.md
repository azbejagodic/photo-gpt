# Photo GPT

Photo GPT is a local phone-to-PC photo bridge for ChatGPT. Photos stay on the local network and each new upload replaces the previous batch.

The product has three user-facing parts:

1. **App** - the native Electron application that starts and manages the local LAN server and displays the application UI.
2. **Extension** - the Chrome/Brave extension that fetches the latest photos and copies them to the clipboard for pasting into ChatGPT.
3. **PWA** - the phone upload web app served over the local network.

The Express server is an internal part of the App, not a separate product.

## Requirements

- Windows PC
- Node.js 18 or newer for development
- Chrome or Brave for the extension
- Phone and PC connected to the same Wi-Fi network

## Development

Install dependencies:

```text
npm install
```

Start the App:

```text
npm start
```

Start only the internal server when testing the API or PWA:

```text
npm run server
```

Build the Windows installer and portable executable:

```text
npm run dist
```

The local server listens on `0.0.0.0:8787` so the phone can connect over the LAN.

## App

The App opens the Photo GPT UI in its Electron window. It reuses a compatible server already running on port 8787 or starts and manages its own server process.

The App UI provides:

- The phone upload URL
- A QR code for opening the PWA
- Server and LAN diagnostics
- The latest uploaded photo batch
- Open and Download actions for each photo

The UI is an internal Electron renderer under `app/renderer/`. It is not served as a browser page.

In development, uploads use `data/latest/` and temporary staging uses `data/upload-tmp/`. Packaged builds use the Electron user-data directory, so uploaded photos are not stored in the installation directory or included in later builds.

## PWA

Connect the phone and PC to the same Wi-Fi network. In the App, scan the QR code or open the displayed LAN URL, for example:

```text
http://192.168.1.16:8787
```

The PWA lets the user:

- Take photos one at a time
- Select multiple photos from the gallery
- Review and remove photos from the selected tray
- Upload up to 20 images as one batch

Each uploaded image must be no larger than 12 MB. Every successful upload batch replaces the previous batch.

### PWA installation

On Android, open the LAN URL in Chrome or Brave and use Add to Home Screen when available.

On iPhone, open the LAN URL in Safari, tap Share, then tap Add to Home Screen.

## Extension

The unpacked extension lives in `extension/`.

To install it:

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable Developer Mode.
3. Select **Load unpacked**.
4. Choose the `extension/` folder.

The extension defaults to:

```text
http://localhost:8787
```

When opened, it fetches the latest uploaded images. The Copy action converts the selected image to PNG and writes it to the clipboard so it can be pasted into ChatGPT. The Open action opens the source image in a browser tab.

## Windows firewall

The Setup installer creates this inbound firewall rule:

- Rule name: `Photo GPT LAN Upload`
- Protocol: TCP
- Local port: 8787
- Profile: Private only

The rule is removed during uninstall. The portable build does not run installer-time firewall configuration.

If the phone cannot connect:

1. Set the Windows network profile to Private.
2. Confirm the phone and PC are on the same Wi-Fi.
3. Use the LAN URL shown in the App, not `localhost`.
4. Check for guest Wi-Fi, VPN routing, access-point isolation, or third-party firewall rules.
5. Prefer the Setup installer for normal use.

## API

The App, PWA, and Extension use these internal local-server routes:

- `POST /api/upload` - uploads a multipart image batch using field name `photos`
- `GET /api/latest` - returns the current image batch
- `GET /api/phone-url` - returns detected LAN URLs for the App
- `GET /api/server-status` - returns server and LAN diagnostics
- `GET /files/<filename>` - serves an uploaded image
- `GET /` - serves the phone PWA

## Project structure

```text
photo-gpt/
  app/
    main.js
    server/
      index.js
      config.js
      lan.js
      storage.js
      routes/
        api.js
        files.js
    renderer/
      index.html
      app.js
      styles.css
  pwa/
    index.html
    manifest.json
    app.js
    styles.css
    icons/
  extension/
    manifest.json
    popup.html
    popup.js
    styles.css
  build/
    installer.nsh
  data/
  dist/
  package.json
  package-lock.json
  README.md
```

## Technology

- Electron
- Node.js and Express
- Multer
- Vanilla HTML, CSS, and JavaScript
- Chrome/Brave Manifest V3 extension APIs

No cloud service or external storage is used.
