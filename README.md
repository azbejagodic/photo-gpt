# photo-gpt
Fast local phone-to-PC photo bridge for ChatGPT.

## Run the server

### 1) Install dependencies
```bash
npm install
```

### 2) Start the server
```bash
npm start
```

The server listens on `0.0.0.0:8787`, so other devices on your home LAN can open:

- `http://<your-computer-lan-ip>:8787/` (PWA/static files)
- `http://<your-computer-lan-ip>:8787/api/latest`

## API overview

- `POST /api/upload`
  - multipart/form-data field: `photos`
  - accepts up to 20 files
  - max 12MB per image
  - accepts only `image/*`
  - deletes old files in `./data/latest` before saving new upload
  - response: `{ "files": [{ "name", "size", "url" }] }`

- `GET /api/latest`
  - response: `{ "files": [{ "name", "size", "url" }] }`

- `GET /files/<filename>`
  - serves uploaded images from `./data/latest`
  - `Cache-Control: no-store` is set

## Directory structure

```text
photo-gpt/
├── data/
│   └── latest/      # active upload batch (replaced each upload)
├── pwa/             # static files served at /
├── server.js
└── package.json
```
