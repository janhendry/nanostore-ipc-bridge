# Skill: nanostore-ipc-bridge — Electron Store & Service Workflow

> Instruktionsdatei für AI-Agenten (Copilot, Claude, etc.)  
> Zeigt Schritt für Schritt, wie man Stores erstellt, Services definiert und alles im Renderer verwendet.

---

## Kontext

Dieses Projekt verwendet `@janhendry/nanostore-ipc-bridge` — ein Zero-Config Framework für Electron-Apps, das Nanostores automatisch über IPC zwischen Main-Prozess und Renderer-Fenstern synchronisiert.

### Architektur-Regeln

- **Stores und Services** werden in `shared/` definiert (universeller Code)
- **Main-Prozess** (`electron/main.ts`) ruft `initNanoStoreIPC()` auf und importiert shared Code
- **Preload** (`electron/preload.ts`) ruft `exposeNanoStoreIPC()` auf
- **Renderer** (`renderer/src/`) importiert Stores/Services aus `shared/` und verwendet sie mit React/Vue/Svelte
- Types kommen nach `shared/types/`
- Der `channelPrefix` muss in Main, Preload und ggf. syncedAtom-Optionen **identisch** sein

### Import-Pfade

| Import | Verwendung |
|---|---|
| `@janhendry/nanostore-ipc-bridge/main` | Nur `electron/main.ts` |
| `@janhendry/nanostore-ipc-bridge/preload` | Nur `electron/preload.ts` |
| `@janhendry/nanostore-ipc-bridge/universal` | `shared/` — für `syncedAtom()` |
| `@janhendry/nanostore-ipc-bridge/services` | `shared/` — für `defineService()` (Alias für universal) |

### Projekt-Struktur

```
my-app/
├── electron/
│   ├── main.ts          # initNanoStoreIPC() + imports
│   └── preload.ts       # exposeNanoStoreIPC()
├── shared/
│   ├── types/           # TypeScript Interfaces
│   ├── stores/          # syncedAtom() Definitionen
│   │   └── index.ts     # Re-exports
│   └── services/        # defineService() Definitionen
│       └── index.ts     # Re-exports
└── renderer/
    └── src/
        ├── App.tsx
        └── components/
```

---

## Aufgabe 1: Neuen Store erstellen

### Wann?

Wenn der User synchronisierten State zwischen Main und Renderer(n) braucht.

### Schritte

**1. Type definieren** in `shared/types/`

```typescript
// shared/types/myFeature.ts
export interface MyFeatureState {
  count: number;
  label: string;
  items: string[];
}
```

Type in `shared/types/index.ts` re-exportieren:

```typescript
export type { MyFeatureState } from "./myFeature";
```

**2. Store erstellen** in `shared/stores/`

```typescript
// shared/stores/myFeatureStore.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { MyFeatureState } from "../types";

export const $myFeature = syncedAtom<MyFeatureState>("myFeature", {
  count: 0,
  label: "",
  items: [],
});
```

Regeln:
- Variablenname beginnt mit `$` (Nanostore-Konvention)
- Erster Parameter ist eine **global eindeutige** String-ID
- Zweiter Parameter ist der Initialwert
- Generischer Typ `<T>` explizit angeben

Store in `shared/stores/index.ts` re-exportieren:

```typescript
export { $myFeature } from "./myFeatureStore";
```

**3. Store im Main-Prozess importieren** — in `electron/main.ts`:

```typescript
// Nach initNanoStoreIPC() aufrufen:
import "../shared/stores/myFeatureStore";
```

> Durch den bloßen Import wird der Store automatisch registriert. Kein weiterer Code nötig.

**4. Im Renderer verwenden** — z.B. in einer React-Komponente:

```tsx
import { useStore } from "@nanostores/react";
import { $myFeature } from "@shared/stores";

function MyComponent() {
  const myFeature = useStore($myFeature);

  // Lesen:
  console.log(myFeature.count);

  // Schreiben (sync an alle Fenster):
  const increment = () => {
    $myFeature.set({ ...myFeature, count: myFeature.count + 1 });
  };

  return <button onClick={increment}>Count: {myFeature.count}</button>;
}
```

### Optionen für syncedAtom

```typescript
export const $readOnlyData = syncedAtom("readOnlyData", initialValue, {
  rendererCanSet: false,        // Renderer darf nicht schreiben
  warnIfNoIPC: true,           // Warnung wenn kein Electron
  onError: (err) => {},        // Fehler-Handler
  validateValue: (v) => true,  // Wert-Validierung (z.B. Zod)
});
```

---

## Aufgabe 2: Neuen Service definieren

### Wann?

Wenn der User Business-Logik braucht, die im Main-Prozess läuft (DB-Zugriff, Dateisystem, privilegierte Ops) und vom Renderer aufgerufen werden soll.

### Schritte

**1. Service erstellen** in `shared/services/`

```typescript
// shared/services/myService.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

export const myService = defineService({
  id: "myService",           // Global eindeutige ID
  handlers: {
    // Jeder Handler MUSS async sein
    async doSomething(param1: string, param2: number): Promise<string> {
      // Diese Logik läuft NUR im Main-Prozess
      const result = `Processed: ${param1} x ${param2}`;

      // Optional: Event an alle Renderer broadcasten
      myService.broadcast("somethingDone", { result });

      return result;
    },

    async fetchData(): Promise<{ items: string[] }> {
      // Hier z.B. Datenbank-Zugriff, Dateisystem, etc.
      return { items: ["a", "b", "c"] };
    },
  },

  // Optional: Middleware-Hooks (nur im Main)
  hooks: {
    beforeAll: async (methodName, args) => {
      console.log(`→ ${methodName}`, args);
    },
    afterAll: async (methodName, result, duration) => {
      console.log(`✓ ${methodName} (${duration.toFixed(2)}ms)`);
    },
  },
});
```

Regeln:
- `id` muss **global eindeutig** sein
- Alle `handlers` müssen `async` sein
- `broadcast(eventName, data)` sendet Events an alle Renderer (nur Main)
- `on(eventName, cb)` empfängt Events (nur Renderer)
- Handler-Parameter und Return-Types werden typsicher über IPC übertragen

Service in `shared/services/index.ts` re-exportieren:

```typescript
export { myService } from "./myService";
```

**2. Service im Main-Prozess importieren** — in `electron/main.ts`:

```typescript
// Nach initNanoStoreIPC() aufrufen:
import "../shared/services/myService";
```

> Auch hier reicht der bloße Import. Auto-Registrierung.

**3. Im Renderer verwenden**

```tsx
import { myService } from "@shared/services/myService";
import React from "react";

function MyComponent() {
  const [data, setData] = React.useState<string[]>([]);

  // RPC-Call: läuft im Main, gibt Ergebnis zurück
  const handleClick = async () => {
    const result = await myService.doSomething("test", 42);
    console.log(result); // "Processed: test x 42"
  };

  // Daten laden via Service
  React.useEffect(() => {
    myService.fetchData().then((d) => setData(d.items));
  }, []);

  // Events vom Main empfangen
  React.useEffect(() => {
    const unsub = myService.on("somethingDone", (eventData) => {
      const { result } = eventData as { result: string };
      console.log("Event:", result);
    });
    return unsub; // Cleanup
  }, []);

  return (
    <div>
      <button onClick={handleClick}>Do Something</button>
      <ul>{data.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}
```

---

## Aufgabe 3: Service + Store kombinieren

### Wann?

Wenn ein Service den State eines Stores manipulieren soll (z.B. Controller-Pattern).

### Beispiel

```typescript
// shared/services/counterController.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";
import { $myFeature } from "../stores";

export const counterController = defineService({
  id: "counterController",
  handlers: {
    async increment(amount: number = 1) {
      const current = $myFeature.get();
      $myFeature.set({ ...current, count: current.count + amount });
      counterController.broadcast("countChanged", { count: current.count + amount });
      return current.count + amount;
    },

    async reset() {
      const current = $myFeature.get();
      $myFeature.set({ ...current, count: 0 });
      counterController.broadcast("countReset", {});
      return 0;
    },
  },
});
```

Renderer:

```tsx
const count = useStore($myFeature).count;

// Via Service (Main-Prozess Logik):
await counterController.increment(5);

// Oder direkt via Store (einfache Updates):
$myFeature.set({ ...$myFeature.get(), count: 99 });
```

---

## Aufgabe 4: Grundgerüst für neues Electron-Projekt

### Wann?

Wenn der User ein neues Electron-Projekt mit nanostore-ipc-bridge aufsetzen will.

### Dateien die erstellt werden müssen

**`electron/main.ts`** (immer gleiche Struktur):

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. IPC Bridge ZUERST initialisieren
initNanoStoreIPC({
  channelPrefix: "app",     // Frei wählbar, muss überall gleich sein
  enableLogging: true,       // Im Dev aktivieren
  autoRegisterWindows: true,
  allowRendererSet: true,
});

// 2. Shared Code importieren (nach init)
import "../shared/stores";
import "../shared/services";

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

**`electron/preload.ts`** (immer 2 Zeilen):

```typescript
import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";
exposeNanoStoreIPC({ channelPrefix: "app" });
```

**`shared/types/index.ts`** (Starter):

```typescript
// Types hier definieren und re-exportieren
```

**`shared/stores/index.ts`** (Starter):

```typescript
// Stores hier re-exportieren
// export { $myStore } from "./myStore";
```

**`shared/services/index.ts`** (Starter):

```typescript
// Services hier re-exportieren
// export { myService } from "./myService";
```

---

## Checkliste: Neuen Store hinzufügen

- [ ] Type in `shared/types/` definiert und in index.ts re-exportiert
- [ ] `syncedAtom()` in `shared/stores/` erstellt mit eindeutiger ID
- [ ] Store in `shared/stores/index.ts` re-exportiert
- [ ] Store-Import in `electron/main.ts` vorhanden (nach `initNanoStoreIPC()`)
- [ ] Im Renderer via `useStore($store)` (React) oder entsprechendem Binding verwendet

## Checkliste: Neuen Service hinzufügen

- [ ] `defineService()` in `shared/services/` erstellt mit eindeutiger ID
- [ ] Alle Handler sind `async`
- [ ] Service in `shared/services/index.ts` re-exportiert
- [ ] Service-Import in `electron/main.ts` vorhanden (nach `initNanoStoreIPC()`)
- [ ] Im Renderer: Methoden als `await service.method()` aufgerufen
- [ ] Im Renderer: Events via `service.on("eventName", cb)` subscribed (mit Cleanup)

## Checkliste: channelPrefix

- [ ] `initNanoStoreIPC({ channelPrefix: "X" })` in main.ts
- [ ] `exposeNanoStoreIPC({ channelPrefix: "X" })` in preload.ts
- [ ] Falls syncedAtom Options genutzt: gleiches `channelPrefix`

---

## Häufige Fehler & Fixes

| Fehler | Ursache | Fix |
|---|---|---|
| Store bleibt auf Initialwert | Store nicht in `electron/main.ts` importiert | `import "../shared/stores/myStore"` hinzufügen |
| `SERVICE_NOT_FOUND` | Service nicht in main.ts importiert | `import "../shared/services/myService"` hinzufügen |
| `RENDERER_WRITE_DISABLED` | `allowRendererSet: false` in init | Auf `true` setzen oder Service zum Schreiben nutzen |
| IPC nicht verfügbar im Renderer | Preload fehlt oder channelPrefix stimmt nicht | channelPrefix in main.ts und preload.ts vergleichen |
| `ALREADY_INITIALIZED` | `initNanoStoreIPC()` zweimal aufgerufen | Nur einmal in main.ts aufrufen |
| Service-Methode throws im Renderer | Handler-Fehler im Main | try/catch um `await service.method()` im Renderer |
| `broadcast()` im Renderer | `broadcast()` ist nur für Main | Im Renderer `on()` zum Empfangen, im Handler `broadcast()` zum Senden |
| `on()` im Main | `on()` ist nur für Renderer | Im Main `broadcast()` nutzen, `on()` nur im Renderer |

---

## Code-Generierungs-Templates

### Template: Neuer Store

```typescript
// shared/stores/{{name}}Store.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";
import type { {{Type}} } from "../types";

export const ${{name}} = syncedAtom<{{Type}}>("{{id}}", {{defaultValue}});
```

### Template: Neuer Service

```typescript
// shared/services/{{name}}Service.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

export const {{name}}Service = defineService({
  id: "{{id}}",
  handlers: {
    async {{methodName}}({{params}}): Promise<{{ReturnType}}> {
      // Logik hier (läuft im Main-Prozess)
      {{name}}Service.broadcast("{{eventName}}", { /* data */ });
      return result;
    },
  },
});
```

### Template: Renderer Event-Subscription

```tsx
React.useEffect(() => {
  const unsub = {{service}}.on("{{eventName}}", (data) => {
    const typed = data as {{EventDataType}};
    // Handle event
  });
  return unsub;
}, []);
```

### Template: Renderer Service-Call

```tsx
const handleAction = async () => {
  try {
    const result = await {{service}}.{{method}}({{args}});
    // Handle result
  } catch (err) {
    console.error("Service call failed:", err);
  }
};
```
