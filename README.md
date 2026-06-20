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

This project consists of four parts:

1. Node.js + Express Server
2. Mobile PWA (Progressive Web App)
3. Desktop Dashboard
4. Manifest V3 Chrome/Brave Extension

Flow:

Phone → PWA → Local Server → Extension → Clipboard

Uploaded images are stored temporarily in:

data/latest/

Each new upload replaces the previous batch.

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

If your phone cannot connect:

Allow Node.js through firewall:

1. Open Windows Defender Firewall
2. Click "Allow an app"
3. Ensure Node.js is allowed on Private networks

OR create manual inbound rule:

- Port: 8787
- Protocol: TCP
- Allow connection
- Apply to: Private network only

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

---

# Purpose

Designed for fast, frictionless phone-to-desktop image transfer optimized for ChatGPT workflows.
