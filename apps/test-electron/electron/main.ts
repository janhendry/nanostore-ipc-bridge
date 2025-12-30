import path from "node:path";
import { fileURLToPath } from "node:url";
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";
import { app, BrowserWindow } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize IPC FIRST before importing stores/services
initNanoStoreIPC({
	channelPrefix: "wf",
	enableLogging: true,
	autoRegisterWindows: true,
	allowRendererSet: true,
});

// IMPORTANT: import the shared stores/services AFTER init so they are created/registered in the main process.
// With Queue Pattern, import order doesn't matter anymore - but good practice to import after init
import "../shared/stores";
import "../shared/todoService";
import "../shared/storeController";

function createWindow(title: string) {
	const win = new BrowserWindow({
		width: 520,
		height: 420,
		title,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	const devUrl = process.env.VITE_DEV_SERVER_URL;
	if (devUrl) {
		win.loadURL(devUrl);
	} else {
		win.loadFile(path.join(__dirname, "../dist/index.html"));
	}
	return win;
}

app.whenReady().then(() => {
	createWindow("Window A");
	createWindow("Window B");
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
