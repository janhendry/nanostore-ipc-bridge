# Development Guide

> **For library usage documentation, see [README.md](./README.md)**

This guide is for contributors and developers working on the library itself.

---

## Repository Structure

This is a **monorepo workspace** containing:

- **`packages/nanostore-ipc-bridge`** – The library (TypeScript, built with tsup)
- **`apps/test-electron`** – Demo Electron app with two synced windows

---

## Quick Start (Development)

```bash
# Install dependencies
npm install

# Run demo app (builds library + starts Electron in dev mode)
npm run dev
```

**Expected behavior:**

- Two Electron windows open
- Counter, settings, and todo list sync across both windows
- RPC calls and events work in real-time

---

## Workspace Commands

### Root Commands

```bash
npm run build    # Build all packages
npm run dev      # Start demo app in dev mode
```

### Library Package

```bash
# Build library
npm run -w @janhendry/nanostore-ipc-bridge build

# Watch mode (for development)
cd packages/nanostore-ipc-bridge
npm run build -- --watch
```

**Build outputs:**

- `packages/nanostore-ipc-bridge/dist/`
  - ESM (`.mjs`) + CJS (`.js`) + TypeScript definitions (`.d.ts`)
  - Separate entrypoints: `main/`, `preload/`, `universal/`, `services/`

### Demo App

```bash
# Development mode
npm run -w @demo/test-electron dev

# Production build
npm run -w @demo/test-electron build
```

---

## Architecture Overview

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for detailed technical documentation.

### Key Concepts

1. **Zero-config stores**: `syncedAtom()` auto-registers when imported
2. **Queue pattern**: Stores/services can be created before `initNanoStoreIPC()`
3. **Revision tracking**: Prevents race conditions in multi-window sync
4. **Services**: RPC system with explicit event broadcasting

### Process Detection

`syncedAtom()` automatically detects the runtime environment:

- **Main process**: `process.versions.electron` exists, no `window`
- **Renderer process**: `window` exists + preload API available
- **Fallback**: Outside Electron → local-only nanostore

---

## Development Tips

### Channel Prefix

Always use `channelPrefix` in non-trivial apps to avoid IPC collisions:

```typescript
// Main
initNanoStoreIPC({ channelPrefix: "myapp" });

// Preload
exposeNanoStoreIPC({ channelPrefix: "myapp" });
```

### Production Hardening

The demo prioritizes DX. For production:

- Set `allowRendererSet: false` to disable direct renderer writes
- Use services/RPC for mutations instead of raw `.set()`
- Validate state with schemas (e.g., Zod) before broadcasting
- Ensure all store values are structured-clone compatible

### Cleanup

Renderer stores expose `.destroy()` for cleanup:

```typescript
const unsubscribe = $store.destroy(); // Removes IPC listeners
```

Rarely needed unless dynamically creating/destroying stores.

---

## Testing

```bash
# Run demo app and test manually
npm run dev

# Check for TypeScript errors
npm run -w @janhendry/nanostore-ipc-bridge build
```

---

## Contributing

1. **Fork** the repository
2. **Create a branch** for your feature/fix
3. **Make changes** and test with the demo app
4. **Build** the library to check for errors
5. **Submit a PR** with a clear description

### Code Style

- TypeScript strict mode enabled
- ESM + CJS dual output
- Minimal dependencies (only `nanostores` peer)

---

## Release Process

```bash
# 1. Update version
cd packages/nanostore-ipc-bridge
npm version patch|minor|major

# 2. Build
npm run build

# 3. Publish
npm publish
```

---

## License

MIT
