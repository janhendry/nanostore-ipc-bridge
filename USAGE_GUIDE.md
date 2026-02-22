# nanostore-ipc-bridge — Ausführlicher Usage Guide

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Konzept & Architektur](#konzept--architektur)
3. [Installation](#installation)
4. [Die 3 Bausteine des Frameworks](#die-3-bausteine-des-frameworks)
5. [Projekt-Struktur (Referenz)](#projekt-struktur-referenz)
6. [Schritt-für-Schritt Setup](#schritt-für-schritt-setup)
7. [API-Referenz im Detail](#api-referenz-im-detail)
8. [Wo liegt was? — Datei-Zuordnung](#wo-liegt-was--datei-zuordnung)
9. [Vollständiges Beispiel](#vollständiges-beispiel)
10. [Typische Patterns & Best Practices](#typische-patterns--best-practices)
11. [Fehlerbehandlung](#fehlerbehandlung)
12. [FAQ](#faq)

---

## Überblick

`@janhendry/nanostore-ipc-bridge` ist ein Zero-Config Framework für **Electron-Apps**, das [Nanostores](https://github.com/nanostores/nanostores) automatisch über IPC zwischen **Main-Prozess** und beliebig vielen **Renderer-Fenstern** synchronisiert.

**Was das Framework löst:**

- Kein manuelles IPC-Mapping pro Store
- Kein duplizierter State-Code
- Kein manuelles Window-Management
- Type-safe RPC-Services zwischen Main und Renderer
- Einmal definieren — überall verwenden

**Kern-Prinzip:** Du definierst Stores und Services in **shared Files** und importierst sie identisch in Main und Renderer. Das Framework erkennt automatisch die Umgebung und verhält sich entsprechend.

---

## Konzept & Architektur

Electron hat 3 isolierte Kontexte:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process                           │
│  (Node.js, App-Lifecycle, privilegierte Operationen)        │
│                                                             │
│  initNanoStoreIPC()  ← IPC-Zentrale                        │
│  Stores (echte atoms)                                       │
│  Services (Handler laufen hier)                             │
└─────────────┬───────────────────────────┬───────────────────┘
              │ IPC (invoke/send)         │ IPC (invoke/send)
┌─────────────▼─────────┐  ┌─────────────▼─────────┐
│    Preload Script      │  │    Preload Script      │
│  exposeNanoStoreIPC()  │  │  exposeNanoStoreIPC()  │
│  (contextBridge)       │  │  (contextBridge)       │
└─────────────┬──────────┘  └─────────────┬──────────┘
┌─────────────▼──────────┐  ┌─────────────▼──────────┐
│    Renderer A          │  │    Renderer B          │
│  (React/Vue/Svelte)    │  │  (React/Vue/Svelte)    │
│  Stores (Proxy-Atoms)  │  │  Stores (Proxy-Atoms)  │
│  Services (RPC-Proxy)  │  │  Services (RPC-Proxy)  │
└────────────────────────┘  └────────────────────────┘
```

### Datenfluss

**Store-Sync (bidirektional):**

```
Renderer A ──set()──▶ Main ──broadcast──▶ Renderer A + B
                       ▲
                       │ subscribe
                       │
Renderer B ──set()─────┘
```

**Service-Calls (RPC):**

```
Renderer ──callService()──▶ Main (Handler ausführen) ──result──▶ Renderer
                             │
                             └──broadcast(event)──▶ Alle Renderer
```

---

## Installation

```bash
npm install @janhendry/nanostore-ipc-bridge nanostores
```

Peer-Dependency: `nanostores >= 0.11.0`

---

## Die 3 Bausteine des Frameworks

Das Framework hat **4 Entry Points** (Import-Pfade):

| Import-Pfad                                 | Wo verwenden?         | Was es tut                              |
| ------------------------------------------- | --------------------- | --------------------------------------- |
| `@janhendry/nanostore-ipc-bridge/main`      | `electron/main.ts`    | IPC-Bridge initialisieren               |
| `@janhendry/nanostore-ipc-bridge/preload`   | `electron/preload.ts` | API an Renderer exposen                 |
| `@janhendry/nanostore-ipc-bridge/universal` | `shared/` (überall)   | `syncedAtom()` — Stores definieren      |
| `@janhendry/nanostore-ipc-bridge/services`  | `shared/` (überall)   | `defineService()` — Services definieren |

> **Wichtig:** `universal` und `services` exportieren beide aus dem gleichen Modul. `services` ist ein Alias für `universal`.

---

## Projekt-Struktur (Referenz)

So **muss** die Projektstruktur deiner Electron-App aussehen:

```
my-electron-app/
├── package.json
├── tsconfig.json
├── vite.config.ts              # Vite config mit @shared alias
├── tsup.electron.config.ts     # Build config für Electron (main + preload)
│
├── electron/                   # ◀ ELECTRON-SPEZIFISCH (Main + Preload)
│   ├── main.ts                 # App-Einstieg, initNanoStoreIPC()
│   └── preload.ts              # contextBridge, exposeNanoStoreIPC()
│
├── shared/                     # ◀ GETEILTER CODE (Main + Renderer)
│   ├── stores.ts               # Alle syncedAtom() Definitionen
│   ├── stores/                 # ODER: ein Ordner pro Store-Domäne
│   │   ├── counterStore.ts
│   │   ├── settingsStore.ts
│   │   └── index.ts
│   ├── services/               # Alle defineService() Definitionen
│   │   ├── todoService.ts
│   │   ├── authService.ts
│   │   └── index.ts
│   └── types/                  # Geteilte TypeScript-Types
│       ├── todo.ts
│       ├── settings.ts
│       └── index.ts
│
├── renderer/                   # ◀ RENDERER (UI)
│   ├── index.html
│   └── src/
│       ├── main.tsx            # React Entry
│       ├── App.tsx
│       ├── components/         # UI-Komponenten
│       │   ├── TodoList.tsx
│       │   └── Settings.tsx
│       └── hooks/              # Optional: Custom Hooks
│           └── useTodos.ts
│
└── dist-electron/              # Build Output (generiert)
    ├── main.js
    └── preload.js
```

### Wo liegt was? — Übersicht

| Was                            | Wo                                       | Warum                            |
| ------------------------------ | ---------------------------------------- | -------------------------------- |
| **Types/Interfaces**           | `shared/types/`                          | Von Main UND Renderer benötigt   |
| **Stores** (`syncedAtom`)      | `shared/stores.ts` oder `shared/stores/` | Universeller Code, läuft überall |
| **Services** (`defineService`) | `shared/services/`                       | Universeller Code, läuft überall |
| **Main-Prozess Init**          | `electron/main.ts`                       | Nur im Main-Prozess              |
| **Preload Script**             | `electron/preload.ts`                    | Bridge Main ↔ Renderer           |
| **UI-Komponenten**             | `renderer/src/components/`               | Nur im Renderer                  |
| **React Hooks**                | `renderer/src/hooks/`                    | Nur im Renderer                  |
| **Vite Config**                | `vite.config.ts` (Root)                  | Build-Konfiguration              |
| **Electron Build**             | `tsup.electron.config.ts`                | Main/Preload transpilieren       |

---

## Schritt-für-Schritt Setup

### Schritt 1: Types definieren (`shared/types/`)

```typescript
// shared/types/todo.ts
export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: number;
}

// shared/types/settings.ts
export interface AppSettings {
  theme: "light" | "dark";
  language: "de" | "en";
  fontSize: number;
}

// shared/types/index.ts
export type { Todo } from "./todo";
export type { AppSettings } from "./settings";
```

### Schritt 2: Stores definieren (`shared/stores.ts`)

```typescript
// shared/stores.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { AppSettings } from "./types";

// Einfacher primitiver Store
export const $counter = syncedAtom<number>("counter", 0);

// Objekt-Store mit Typ
export const $settings = syncedAtom<AppSettings>("settings", {
  theme: "dark",
  language: "de",
  fontSize: 14,
});

// Boolean Store
export const $sidebarOpen = syncedAtom<boolean>("sidebarOpen", true);

// Array Store
export const $notifications = syncedAtom<string[]>("notifications", []);
```

**Regeln für `syncedAtom()`:**

- Der **erste Parameter** (`id`) muss **global eindeutig** sein
- Der **zweite Parameter** ist der Initialwert
- Der Store wird **automatisch** registriert — kein weiterer Code nötig
- Funktioniert identisch in Main und Renderer (Universal)

### Schritt 3: Services definieren (`shared/services/`)

```typescript
// shared/services/todoService.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";
import type { Todo } from "../types";

// In-Memory Storage (nur im Main-Prozess vorhanden)
const todos: Todo[] = [];

export const todoService = defineService({
  id: "todos", // Eindeutige Service-ID
  handlers: {
    // Jeder Handler ist async und läuft im Main-Prozess
    async addTodo(text: string): Promise<Todo> {
      const todo: Todo = {
        id: Date.now(),
        text,
        completed: false,
        createdAt: Date.now(),
      };
      todos.push(todo);

      // Event an alle Renderer-Fenster senden
      todoService.broadcast("todoAdded", todo);

      return todo;
    },

    async getTodos(): Promise<Todo[]> {
      return [...todos];
    },

    async toggleTodo(id: number): Promise<Todo> {
      const todo = todos.find((t) => t.id === id);
      if (!todo) throw new Error(`Todo ${id} not found`);

      todo.completed = !todo.completed;
      todoService.broadcast("todoToggled", todo);
      return todo;
    },

    async deleteTodo(id: number): Promise<boolean> {
      const index = todos.findIndex((t) => t.id === id);
      if (index === -1) throw new Error(`Todo ${id} not found`);

      todos.splice(index, 1);
      todoService.broadcast("todoDeleted", { id });
      return true;
    },
  },

  // Optional: Lifecycle-Hooks (nur Main)
  hooks: {
    beforeAll: async (methodName, args) => {
      console.log(`[todoService] → ${methodName}`, args);
    },
    afterAll: async (methodName, result, duration) => {
      console.log(`[todoService] ✓ ${methodName} (${duration.toFixed(2)}ms)`);
    },
  },
});
```

**Regeln für `defineService()`:**

- `id` muss **global eindeutig** sein
- Alle `handlers` müssen **async** sein (Promise zurückgeben)
- `broadcast()` funktioniert **nur im Main-Prozess** (sendet Events an alle Renderer)
- `on()` funktioniert **nur im Renderer** (empfängt Events)
- Im Renderer werden Handler-Aufrufe automatisch zu **RPC-Calls**

### Schritt 4: Main-Prozess einrichten (`electron/main.ts`)

```typescript
// electron/main.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ██████ SCHRITT 1: IPC Bridge initialisieren (VOR allen Imports!) ██████
initNanoStoreIPC({
  channelPrefix: "myapp", // Optional: IPC-Channel-Prefix
  enableLogging: true, // Optional: Debug-Logging
  autoRegisterWindows: true, // Neue Fenster automatisch registrieren
  allowRendererSet: true, // Renderer darf Stores direkt setzen
});

// ██████ SCHRITT 2: Shared Code importieren (NACH init!) ██████
// Diese Imports registrieren die Stores und Services automatisch
import "../shared/stores";
import "../shared/services/todoService";

// ██████ SCHRITT 3: Fenster erstellen ██████
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true, // PFLICHT
      nodeIntegration: false, // PFLICHT (Sicherheit)
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Dev oder Prod
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

**Wichtige Reihenfolge:**

1. `initNanoStoreIPC()` **zuerst** aufrufen
2. Dann erst die `shared/` Module importieren
3. Dann Fenster erstellen

> **Hinweis:** Dank Queue-Pattern funktioniert es auch, wenn Stores/Services vor `initNanoStoreIPC()` importiert werden — diese werden automatisch nachregistriert. Trotzdem ist die obige Reihenfolge Best Practice.

### Schritt 5: Preload-Script (`electron/preload.ts`)

```typescript
// electron/preload.ts
import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";

exposeNanoStoreIPC({
  channelPrefix: "myapp", // MUSS mit main.ts übereinstimmen!
  globalName: "nanostoreIPC", // Standard, kann geändert werden
});
```

**Das ist alles!** Das Preload-Script exponiert automatisch:

- `window.nanostoreIPC.get(id)` — Store-Wert holen
- `window.nanostoreIPC.set(id, value)` — Store-Wert setzen
- `window.nanostoreIPC.subscribe(id, cb)` — Store-Updates empfangen
- `window.nanostoreIPC.callService(id, method, ...args)` — Service-RPC
- `window.nanostoreIPC.subscribeServiceEvent(id, event, cb)` — Service-Events

### Schritt 6: Renderer / UI (`renderer/src/`)

```tsx
// renderer/src/App.tsx
import { useStore } from "@nanostores/react"; // Nanostore React-Binding
import { $counter, $settings } from "@shared/stores";
import { todoService } from "@shared/services/todoService";
import type { Todo } from "@shared/types";
import React from "react";

export function App() {
  // ██████ STORES: Automatisch synchronisiert ██████
  const counter = useStore($counter);
  const settings = useStore($settings);

  // ██████ SERVICES: RPC-Calls (laufen im Main) ██████
  const [todos, setTodos] = React.useState<Todo[]>([]);

  React.useEffect(() => {
    // Initial laden
    todoService.getTodos().then(setTodos);
  }, []);

  // ██████ SERVICE EVENTS: Reaktive Updates ██████
  React.useEffect(() => {
    const unsub1 = todoService.on("todoAdded", (data) => {
      setTodos((prev) => [...prev, data as Todo]);
    });

    const unsub2 = todoService.on("todoDeleted", (data) => {
      const { id } = data as { id: number };
      setTodos((prev) => prev.filter((t) => t.id !== id));
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  // ██████ STORE DIREKT SETZEN (Renderer → Main → alle Renderer) ██████
  const increment = () => $counter.set(counter + 1);

  // ██████ SERVICE AUFRUFEN (Renderer → Main RPC → Result) ██████
  const addTodo = async () => {
    const todo = await todoService.addTodo("Neue Aufgabe");
    // Event kommt automatisch über todoService.on("todoAdded")
  };

  return (
    <div>
      <h1>Counter: {counter}</h1>
      <button onClick={increment}>+1</button>

      <h2>Theme: {settings.theme}</h2>

      <h2>Todos ({todos.length})</h2>
      <button onClick={addTodo}>Todo hinzufügen</button>
      <ul>
        {todos.map((t) => (
          <li key={t.id}>{t.text}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## API-Referenz im Detail

### `syncedAtom<T>(id, initial, options?)`

**Import:** `@janhendry/nanostore-ipc-bridge/universal`

Erstellt einen synchronisierten Nanostore-Atom.

| Parameter | Typ                    | Beschreibung                                         |
| --------- | ---------------------- | ---------------------------------------------------- |
| `id`      | `string`               | Eindeutige Store-ID (z.B. `"counter"`, `"settings"`) |
| `initial` | `T`                    | Initialwert                                          |
| `options` | `SyncedAtomOptions<T>` | Optionale Konfiguration                              |

**Optionen:**

| Option           | Typ                     | Default          | Beschreibung                                 |
| ---------------- | ----------------------- | ---------------- | -------------------------------------------- |
| `rendererCanSet` | `boolean`               | `true`           | Darf der Renderer den Store direkt setzen?   |
| `warnIfNoIPC`    | `boolean`               | `false`          | Warnung wenn IPC nicht verfügbar             |
| `channelPrefix`  | `string`                | `""`             | Muss mit `initNanoStoreIPC()` übereinstimmen |
| `globalName`     | `string`                | `"nanostoreIPC"` | Name des globalen Window-Objekts             |
| `onError`        | `ErrorHandler`          | —                | Fehler-Callback                              |
| `validateValue`  | `(value: T) => boolean` | —                | Wert-Validierung (z.B. mit Zod)              |

**Verhalten pro Umgebung:**

| Umgebung            | Verhalten                                                      |
| ------------------- | -------------------------------------------------------------- |
| **Main**            | Erstellt echten `atom(initial)`, registriert für IPC-Broadcast |
| **Renderer**        | Erstellt Proxy-Atom, synchronisiert über IPC                   |
| **Node.js / Tests** | Fallback auf normalen `atom(initial)`                          |

**Rückgabe:** `WritableAtom<T>` — Standard Nanostore Atom mit `.get()`, `.set()`, `.subscribe()`

---

### `defineService<T>(options)`

**Import:** `@janhendry/nanostore-ipc-bridge/services`

Definiert einen RPC-Service.

| Option       | Typ                                         | Beschreibung                                  |
| ------------ | ------------------------------------------- | --------------------------------------------- |
| `id`         | `string`                                    | Eindeutige Service-ID                         |
| `handlers`   | `Record<string, (...args) => Promise<any>>` | Async Handler-Methoden                        |
| `hooks`      | `ServiceHooks`                              | Optional: `beforeAll` / `afterAll` Middleware |
| `globalName` | `string`                                    | Standard: `"nanostoreIPC"`                    |

**Rückgabe: `ServiceProxy<T>`** mit:

| Methode                  | Main                       | Renderer           | Beschreibung                    |
| ------------------------ | -------------------------- | ------------------ | ------------------------------- |
| `handler()`              | Lokal ausführen            | RPC an Main        | Jede definierte Handler-Methode |
| `broadcast(event, data)` | ✅ Sendet an alle Renderer | ❌ Throws          | Events an alle Fenster          |
| `on(event, cb)`          | ❌ Throws                  | ✅ Empfängt Events | Events von Main empfangen       |

---

### `initNanoStoreIPC(options?)`

**Import:** `@janhendry/nanostore-ipc-bridge/main`

**Nur im Main-Prozess aufrufen!** Initialisiert die IPC-Bridge.

| Option                  | Typ            | Default | Beschreibung                          |
| ----------------------- | -------------- | ------- | ------------------------------------- |
| `channelPrefix`         | `string`       | `""`    | Prefix für IPC-Channels               |
| `enableLogging`         | `boolean`      | `false` | Debug-Logging an/aus                  |
| `autoRegisterWindows`   | `boolean`      | `true`  | Neue Fenster automatisch registrieren |
| `allowRendererSet`      | `boolean`      | `true`  | Renderer darf Stores schreiben        |
| `onError`               | `ErrorHandler` | —       | Fehler-Callback                       |
| `validateSerialization` | `boolean`      | `false` | Serialisierungs-Check (nur Dev)       |

**Rückgabe:**

```typescript
{
  registerStore: (id: string, store: Store) => void;    // Manuell Store registrieren
  registerWindow: (win: BrowserWindow) => void;          // Manuell Window registrieren
  destroy: () => void;                                    // Komplett aufräumen
}
```

---

### `exposeNanoStoreIPC(options?)`

**Import:** `@janhendry/nanostore-ipc-bridge/preload`

**Nur im Preload-Script aufrufen!** Exponiert die IPC-API zum Renderer.

| Option          | Typ      | Default          | Beschreibung                      |
| --------------- | -------- | ---------------- | --------------------------------- |
| `channelPrefix` | `string` | `""`             | **Muss mit Main übereinstimmen!** |
| `globalName`    | `string` | `"nanostoreIPC"` | Name unter `window.*`             |

---

## Wo liegt was? — Datei-Zuordnung

### Entscheidungsbaum: Wo kommt mein Code hin?

```
Braucht der Code Electron Main APIs (app, BrowserWindow, fs, etc.)?
├── JA → electron/main.ts
│
Braucht der Code contextBridge/ipcRenderer?
├── JA → electron/preload.ts
│
Wird der Code in Main UND Renderer verwendet?
├── JA → shared/
│   ├── Ist es ein Store? → shared/stores/ oder shared/stores.ts
│   ├── Ist es ein Service? → shared/services/
│   ├── Ist es ein Type/Interface? → shared/types/
│   └── Ist es eine Utility? → shared/utils/
│
Wird der Code nur im UI verwendet?
├── JA → renderer/src/
│   ├── Ist es eine Komponente? → renderer/src/components/
│   ├── Ist es ein Hook? → renderer/src/hooks/
│   ├── Ist es eine Page/View? → renderer/src/pages/
│   └── Ist es ein UI-Utility? → renderer/src/utils/
```

### Detaillierte Zuordnung

#### `shared/types/` — Geteilte TypeScript-Types

```typescript
// shared/types/todo.ts
export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

// shared/types/settings.ts
export type Theme = "light" | "dark";

export interface AppSettings {
  theme: Theme;
  language: string;
}
```

**Warum hier?** Types werden in Stores, Services UND Renderer-Komponenten verwendet.

---

#### `shared/stores.ts` oder `shared/stores/` — Store-Definitionen

**Variante A: Einzelne Datei** (für kleine Apps)

```typescript
// shared/stores.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";

export const $counter = syncedAtom<number>("counter", 0);
export const $settings = syncedAtom<AppSettings>("settings", {
  theme: "dark",
  language: "de",
});
```

**Variante B: Store pro Datei** (für große Apps)

```typescript
// shared/stores/counterStore.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
export const $counter = syncedAtom<number>("counter", 0);

// shared/stores/settingsStore.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { AppSettings } from "../types";
export const $settings = syncedAtom<AppSettings>("settings", {
  theme: "dark",
  language: "de",
});

// shared/stores/index.ts
export { $counter } from "./counterStore";
export { $settings } from "./settingsStore";
```

**Konvention:** Store-Variablen beginnen mit `$` (Nanostore-Konvention).

---

#### `shared/services/` — Service-Definitionen

```typescript
// shared/services/todoService.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

export const todoService = defineService({
  id: "todos",
  handlers: {
    /* ... */
  },
});

// shared/services/index.ts
export { todoService } from "./todoService";
```

**Warum `shared/`?** Services werden sowohl in Main (echte Handler) als auch im Renderer (RPC-Proxy) importiert.

---

#### `electron/main.ts` — Main-Prozess

Hier kommt NUR:

- `initNanoStoreIPC()` Aufruf
- Imports der shared Stores/Services
- `BrowserWindow` Erstellung
- Electron-spezifische Logik (Tray, Menu, etc.)

```typescript
// electron/main.ts
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";

initNanoStoreIPC({ channelPrefix: "myapp" });

// Shared Code importieren (registriert automatisch)
import "../shared/stores";
import "../shared/services/todoService";
```

---

#### `electron/preload.ts` — Preload-Script

Normalerweise nur **2 Zeilen**:

```typescript
import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";
exposeNanoStoreIPC({ channelPrefix: "myapp" });
```

---

#### `renderer/src/` — UI Code

Importiert Stores und Services aus `shared/`:

```tsx
import { useStore } from "@nanostores/react";
import { $counter } from "@shared/stores";
import { todoService } from "@shared/services/todoService";
```

---

## Vollständiges Beispiel

### Projekt: Todo-App mit Settings

```
my-todo-app/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tsup.electron.config.ts
│
├── electron/
│   ├── main.ts
│   └── preload.ts
│
├── shared/
│   ├── types/
│   │   ├── index.ts
│   │   ├── todo.ts
│   │   └── settings.ts
│   ├── stores/
│   │   ├── index.ts
│   │   ├── todoStore.ts
│   │   └── settingsStore.ts
│   └── services/
│       ├── index.ts
│       └── todoService.ts
│
└── renderer/
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        └── components/
            ├── TodoList.tsx
            └── Settings.tsx
```

#### `shared/types/todo.ts`

```typescript
export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}
```

#### `shared/types/settings.ts`

```typescript
export interface AppSettings {
  theme: "light" | "dark";
  showCompleted: boolean;
}
```

#### `shared/stores/todoStore.ts`

```typescript
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { Todo } from "../types/todo";

// Die Todo-Liste als synchronisierter Store
export const $todos = syncedAtom<Todo[]>("todos", []);
```

#### `shared/stores/settingsStore.ts`

```typescript
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { AppSettings } from "../types/settings";

export const $settings = syncedAtom<AppSettings>("settings", {
  theme: "dark",
  showCompleted: true,
});
```

#### `shared/services/todoService.ts`

```typescript
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";
import type { Todo } from "../types/todo";
import { $todos } from "../stores/todoStore";

export const todoService = defineService({
  id: "todos",
  handlers: {
    async addTodo(text: string): Promise<Todo> {
      const todo: Todo = { id: Date.now(), text, completed: false };
      const current = $todos.get();
      $todos.set([...current, todo]);

      // Alle Renderer informieren
      todoService.broadcast("todoAdded", todo);
      return todo;
    },

    async toggleTodo(id: number): Promise<void> {
      const current = $todos.get();
      $todos.set(
        current.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t,
        ),
      );
      todoService.broadcast("todoToggled", { id });
    },

    async deleteTodo(id: number): Promise<void> {
      const current = $todos.get();
      $todos.set(current.filter((t) => t.id !== id));
      todoService.broadcast("todoDeleted", { id });
    },
  },
});
```

#### `electron/main.ts`

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. IPC Bridge initialisieren
initNanoStoreIPC({
  channelPrefix: "myapp",
  enableLogging: process.env.NODE_ENV === "development",
});

// 2. Stores und Services importieren (Auto-Registrierung)
import "../shared/stores/todoStore";
import "../shared/stores/settingsStore";
import "../shared/services/todoService";

// 3. Fenster erstellen
function createWindow() {
  return new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
}

app.whenReady().then(() => createWindow());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

#### `electron/preload.ts`

```typescript
import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";

exposeNanoStoreIPC({ channelPrefix: "myapp" });
```

#### `renderer/src/components/TodoList.tsx`

```tsx
import { useStore } from "@nanostores/react";
import { $todos } from "@shared/stores/todoStore";
import { $settings } from "@shared/stores/settingsStore";
import { todoService } from "@shared/services/todoService";
import React from "react";

export function TodoList() {
  const todos = useStore($todos);
  const settings = useStore($settings);
  const [text, setText] = React.useState("");

  const filteredTodos = settings.showCompleted
    ? todos
    : todos.filter((t) => !t.completed);

  const handleAdd = async () => {
    if (!text.trim()) return;
    await todoService.addTodo(text);
    setText("");
  };

  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={handleAdd}>Hinzufügen</button>

      <ul>
        {filteredTodos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => todoService.toggleTodo(todo.id)}
            />
            <span>{todo.text}</span>
            <button onClick={() => todoService.deleteTodo(todo.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Typische Patterns & Best Practices

### Pattern 1: Store + Service Kombination

Services können Stores direkt manipulieren:

```typescript
// shared/services/storeController.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";
import { $counter } from "../stores";

export const storeController = defineService({
  id: "storeController",
  handlers: {
    async increment(amount: number = 1) {
      const current = $counter.get();
      $counter.set(current + amount);
      storeController.broadcast("counterChanged", { value: current + amount });
      return current + amount;
    },
  },
});
```

### Pattern 2: Wert-Validierung mit Zod

```typescript
import { z } from "zod";
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";

const SettingsSchema = z.object({
  theme: z.enum(["light", "dark"]),
  fontSize: z.number().min(8).max(72),
});

export const $settings = syncedAtom(
  "settings",
  { theme: "dark", fontSize: 14 },
  {
    validateValue: (value) => SettingsSchema.safeParse(value).success,
  },
);
```

### Pattern 3: Read-Only Stores im Renderer

```typescript
// Store den nur Main setzen darf
export const $systemInfo = syncedAtom(
  "systemInfo",
  { cpu: "", memory: 0 },
  {
    rendererCanSet: false, // Renderer kann nur lesen
  },
);
```

### Pattern 4: Event-basierte UI-Updates

```tsx
React.useEffect(() => {
  const unsub = todoService.on("todoAdded", (data) => {
    const todo = data as Todo;
    showNotification(`Neues Todo: ${todo.text}`);
  });
  return unsub;
}, []);
```

### Pattern 5: Vite Alias für `@shared`

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
```

---

## Fehlerbehandlung

### Error-Codes

| Code                       | Bedeutung                                                     |
| -------------------------- | ------------------------------------------------------------- |
| `STORE_NOT_FOUND`          | Store-ID existiert nicht                                      |
| `RENDERER_WRITE_DISABLED`  | `allowRendererSet: false` aber Renderer versucht zu schreiben |
| `SERIALIZATION_FAILED`     | Wert nicht serialisierbar (oder Validierung fehlgeschlagen)   |
| `IPC_FAILED`               | IPC-Kommunikation fehlgeschlagen                              |
| `SERVICE_NOT_FOUND`        | Service-ID existiert nicht                                    |
| `SERVICE_METHOD_NOT_FOUND` | Methode auf Service nicht gefunden                            |
| `ALREADY_INITIALIZED`      | `initNanoStoreIPC()` wurde mehrfach aufgerufen                |

### Globaler Error-Handler

```typescript
initNanoStoreIPC({
  onError: (error) => {
    console.error(`[${error.code}] ${error.message}`, error.storeId);
    // Optional: an Logging-Service senden
  },
});
```

### Per-Store Error-Handler

```typescript
const $data = syncedAtom("data", [], {
  onError: (error) => {
    console.warn(`Store error: ${error.message}`);
  },
});
```

---

## FAQ

### Muss der `channelPrefix` überall gleich sein?

**Ja!** `initNanoStoreIPC()`, `exposeNanoStoreIPC()` und optional `syncedAtom()` müssen denselben `channelPrefix` verwenden.

### Kann ich Stores ohne Services verwenden?

**Ja!** Stores (`syncedAtom`) und Services (`defineService`) sind unabhängig voneinander. Du kannst nur Stores verwenden, nur Services, oder beides.

### Funktioniert das Framework ohne Electron?

**Ja, teilweise.** `syncedAtom()` fällt außerhalb von Electron auf einen normalen `atom()` zurück. Services benötigen Electron IPC.

### Kann ich mehrere Fenster synchronisieren?

**Ja!** Das ist ein Hauptfeature. Alle registrierten `BrowserWindow`-Instanzen werden automatisch synchronisiert. Ändert ein Fenster einen Store, sehen alle anderen Fenster sofort das Update.

### Muss ich Stores vor `initNanoStoreIPC()` oder danach importieren?

**Beides funktioniert.** Dank Queue-Pattern werden Stores, die vor `initNanoStoreIPC()` erstellt werden, automatisch nachregistriert. Best Practice ist trotzdem: **erst init, dann imports**.

### Wie teste ich Stores/Services in Unit-Tests?

Außerhalb von Electron verhält sich `syncedAtom()` wie ein normaler `atom()`. Du kannst Stores direkt in Tests verwenden ohne IPC-Setup.

### Kann ich React, Vue oder Svelte verwenden?

**Ja!** Das Framework ist UI-Framework-agnostisch. Nanostores hat offizielle Bindings für React (`@nanostores/react`), Vue (`@nanostores/vue`), Svelte (nativ) und andere.
