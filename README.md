# Photo GPT Bridge

Fast local phone-to-PC photo bridge for ChatGPT.

Photo GPT Bridge allows you to:

- Upload photos from your phone
- Access them instantly on your PC
- Copy images directly to clipboard via browser extension
- Paste into ChatGPT or other desktop apps

All over your local home network (LAN).  
No cloud. No external storage.

---

# Project Architecture

This project consists of five parts:

1. Node.js + Express Server
2. Mobile PWA (Progressive Web App)
3. Desktop Dashboard
4. Native Electron Desktop App
5. Manifest V3 Chrome/Brave Extension

Flow:

Phone → PWA → Local Server → Extension → Clipboard

Uploaded images are stored temporarily in:

data/latest/

Each new upload replaces the previous batch.

Packaged Windows builds do not include uploaded photos. Runtime photos and temporary upload files are created on the user's PC when the app runs.

---

# Requirements

- Node.js (18+ recommended)
- npm
- Chrome or Brave (for extension)
- Phone and PC connected to the same Wi-Fi network

---

# Server Setup

## 1. Install dependencies

```text
npm install
```

## 2. Start the server

```text
npm start
```

Server runs on:

0.0.0.0:8787

This allows other devices on your LAN to connect.

## Developer commands

```text
npm install
npm start
npm run desktop
npm run dist
```

- `npm start` runs the normal Express server.
- `npm run desktop` opens the Electron desktop app in development.
- `npm run dist` builds the Windows desktop app into `dist/`.

---

# Access From Phone

Find your computer’s LAN IP.

On Windows:

ipconfig

Look for:

IPv4 Address

Example:

192.168.1.16

Open on your phone:

http://192.168.1.16:8787

---

# Windows Firewall Configuration (Important)

For normal Windows users, use the Setup installer:

```text
dist/Photo GPT Setup 1.0.0-x64.exe
```

The Setup installer requests the normal Windows elevation prompt and adds this inbound firewall rule:

- Rule name: Photo GPT LAN Upload
- Direction: inbound
- Action: allow
- Protocol: TCP
- Local port: 8787
- Profile: Private only

The rule allows phones on the same private LAN to reach Photo GPT on port 8787. It is removed when Photo GPT is uninstalled through the same installer/uninstaller flow.

Do not use a Public network profile for phone uploads. The firewall rule is intentionally Private-only and does not open Photo GPT on Public networks.

Development modes (`npm start` and `npm run desktop`) may still trigger a Windows firewall prompt for Node.js. Allow access on Private networks if prompted.

---

# Set Network to Private

Windows:

Settings → Network & Internet → Properties →  
Set network profile to:

Private

If network is Public, LAN connections may be blocked.

---

# PWA Installation

## Android

Works in:
- Chrome
- Brave
- Other Chromium browsers

Can be added to Home Screen.

## iPhone (iOS)

Only Safari fully supports PWA install.

To install:

1. Open in Safari
2. Tap Share
3. Tap Add to Home Screen
4. If you already had an old Home Screen shortcut, delete it and add it again after this update so iOS picks up the standalone app metadata and icon.

Brave on iOS does not fully support PWA installation.

---

# Desktop Dashboard

Open the dashboard on the PC running the server:

```text
http://localhost:8787/desktop
```

The dashboard shows:

- The phone upload URL using the PC LAN IP when available
- A QR code for opening the phone upload page
- The latest uploaded photo batch
- Open and Download buttons for each photo

To use it:

1. Start the server with `npm start`
2. Open `http://localhost:8787/desktop` on the PC
3. Scan the QR code with your phone
4. Upload photos from the phone page
5. Click Refresh on the dashboard

If the PC has multiple LAN IP addresses, the dashboard shows the most likely URL first and lists the other detected URLs.

---

# Native Desktop App

Run the native desktop app:

```text
npm run desktop
```

The Electron app opens the desktop dashboard in its own Photo GPT window with no browser address bar. It reuses an already-running server on port 8787, or starts the same Express server as a separate Node.js process when needed.

The server still listens on `0.0.0.0:8787`, so the phone uses the PC LAN upload URL or QR code shown in the dashboard. The Electron window itself loads `http://localhost:8787/desktop`, and the browser extension still talks to the same local server.

## Windows build

Build the Windows app:

```text
npm run dist
```

The build uses electron-builder and writes output to:

```text
dist/
```

The build produces both a Windows installer and a portable executable:

```text
dist/Photo GPT Setup 1.0.0-x64.exe
dist/Photo GPT-1.0.0-portable-x64.exe
```

Use the Setup installer for normal users. It installs Photo GPT to a stable app path and creates the Private-network Windows Firewall rule for TCP port 8787. The portable executable is useful for quick testing, but it does not run the installer-time firewall setup.

In development, runtime uploads use `data/latest/` and temporary staging uses `data/upload-tmp/` inside the repo. In the packaged Windows app, those folders are created under the app's Windows user data directory instead, so builds do not ship old photos.

## Normal user flow

1. Download or copy `dist/Photo GPT Setup 1.0.0-x64.exe`
2. Run the Setup installer and approve the Windows elevation prompt
3. Launch Photo GPT
4. Connect the phone and PC to the same home Wi-Fi
5. Confirm the PC network profile is Private
6. Scan the QR code or open the phone LAN URL shown in the dashboard
7. Upload photos from the phone
8. Use the dashboard or browser extension on the PC

## LAN troubleshooting

The dashboard shows a Server diagnostics section with the bind host, port, detected LAN URLs, launch mode, and runtime data directory.

If the PC dashboard works but the phone cannot connect:

1. Confirm the PC network profile is Private
2. Confirm the phone and PC are on the same Wi-Fi
3. Use the LAN URL shown in the dashboard, not `localhost`
4. Use the Setup installer so the `Photo GPT LAN Upload` firewall rule is created
5. Check for guest Wi-Fi, VPN routing, router/AP client isolation, or third-party antivirus firewall rules
6. Prefer the installer build over the portable build for everyday use

---

# Browser Extension Setup

Extension folder: extension/

To install:

1. Open:

brave://extensions

or

chrome://extensions

2. Enable Developer Mode
3. Click Load unpacked
4. Select the extension/ folder

---

# First Extension Use

1. Enter your server address:

`http://<your-lan-ip>:8787`

2. Click Save  
3. Extension auto-refreshes  
4. Click Copy  

Images are converted to PNG before clipboard write for Brave compatibility.

---

# API

POST /api/upload  
Upload image batch (multipart/form-data, field: photos)

GET /api/latest  
Returns latest uploaded batch

GET /api/phone-url
Returns detected LAN phone upload URLs for the desktop dashboard

GET /api/server-status
Returns local server diagnostics for LAN troubleshooting

GET /files/<filename>  
Serves uploaded image

GET /desktop
Serves the desktop dashboard

---

# Directory Structure

## Directory Structure

```text
photo-gpt/
desktop/             # desktop dashboard
electron/            # native desktop app wrapper
├── data/
│   └── latest/        # active upload batch
├── pwa/               # mobile web app
├── extension/         # browser extension (MV3)
├── server.js
├── package.json
└── README.md
```

---

# Technologies Used

Backend:
- Node.js
- Express
- Multer (file uploads)

PWA:
- HTML
- CSS
- Vanilla JavaScript
- FormData API

Desktop Dashboard:
- HTML
- CSS
- Vanilla JavaScript
- Canvas QR code rendering

Desktop App:
- Electron

Extension:
- Chrome / Brave Manifest V3
- Service Worker
- Clipboard API
- Canvas PNG conversion

---

# Security Notes

- Local LAN only
- No external API calls
- Files auto-replaced on each upload
- No persistent multi-user storage
- Uploaded photos are runtime data and are not included in packaged builds

---

# Purpose

Designed for fast, frictionless phone-to-desktop image transfer optimized for ChatGPT workflows.
