# Test App (Electron + Vite + React)

This app opens **two windows** (A & B). They share the same NanoStores via `syncedAtom()`.

## Run

From repo root:

```bash
npm install
npm run dev
```

If you want a production build:

```bash
npm run -w @demo/test-electron build
# Then run Electron main from built output (see dist-electron/main.js)
```
