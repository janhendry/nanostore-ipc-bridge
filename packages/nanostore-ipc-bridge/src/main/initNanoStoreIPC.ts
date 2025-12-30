import { app, type BrowserWindow, ipcMain } from "electron";
import type { Store } from "nanostores";
import {
	WF_NS_MAIN_API,
	WF_NS_QUEUE,
	WF_NS_SERVICE_QUEUE,
} from "../internal/symbols";
import type {
	ErrorHandler,
	MainApi,
	NanoStoreIPCError,
	ServiceQueueEntry,
	Snapshot,
} from "../internal/types";
import { NanoStoreIPCError as IPCError } from "../internal/types";
import { initServices } from "./services";

export interface InitNanoStoreIPCOptions {
	channelPrefix?: string;
	enableLogging?: boolean;
	autoRegisterWindows?: boolean;
	/**
	 * If false, renderer cannot call set() (write access). Reads + updates still work.
	 * Default: true (DX-first).
	 */
	allowRendererSet?: boolean;
	/**
	 * Error handler called when errors occur in IPC operations.
	 */
	onError?: ErrorHandler;
	/**
	 * If true, validates that store values are serializable before broadcasting.
	 * Recommended only for development (performance cost).
	 * Default: false
	 */
	validateSerialization?: boolean;
}

type StoreEntry<T = unknown> = {
	store: Store<T>;
	rev: number;
	unsubscribe: () => void;
};

type Queue = Map<string, Store<unknown>>;

function ch(prefix: string, c: string) {
	return prefix ? `${prefix}:${c}` : c;
}

/**
 * Initializes a minimal IPC surface:
 * - invoke: ns:get(id) -> {id,rev,value}
 * - invoke: ns:set(id,value) -> void
 * - event:  ns:update({id,rev,value}) broadcast to all registered windows
 *
 * Windows are auto-registered by default.
 *
 * Stores can be created before init; they are kept in a global queue and registered on init.
 */
export function initNanoStoreIPC(opts: InitNanoStoreIPCOptions = {}) {
	const channelPrefix = opts.channelPrefix ?? "";
	const enableLogging = opts.enableLogging ?? false;
	const autoRegisterWindows = opts.autoRegisterWindows ?? true;
	const allowRendererSet = opts.allowRendererSet ?? true;
	const validateSerialization = opts.validateSerialization ?? false;

	const windows = new Set<BrowserWindow>();
	const stores = new Map<string, StoreEntry>();

	const globalWithSymbols = globalThis as Record<symbol, unknown>;
	const queue: Queue =
		(globalWithSymbols[WF_NS_QUEUE] as Queue | undefined) ??
		new Map<string, Store<unknown>>();
	globalWithSymbols[WF_NS_QUEUE] = queue;

	const log = (...args: unknown[]) => {
		if (enableLogging) console.log("[nanostore-ipc]", ...args);
	};

	const handleError = (error: NanoStoreIPCError) => {
		if (enableLogging) {
			console.error("[nanostore-ipc:error]", {
				code: error.code,
				message: error.message,
				storeId: error.storeId,
				originalError: error.originalError,
			});
		}

		if (opts.onError) {
			try {
				opts.onError(error);
			} catch (error_) {
				console.error("[nanostore-ipc] Error in error handler:", error_);
			}
		}
	};

	const broadcast = (snap: Snapshot<unknown>) => {
		const channel = ch(channelPrefix, "ns:update");

		// Clean up destroyed windows first
		for (const win of windows) {
			if (win.isDestroyed()) {
				windows.delete(win);
			}
		}

		// Then broadcast
		for (const win of windows) {
			try {
				win.webContents.send(channel, snap);
			} catch (err) {
				handleError(
					new IPCError(
						`Failed to broadcast update for store "${snap.id}"`,
						"IPC_FAILED",
						snap.id,
						err,
					),
				);
				// Window might have closed during send - remove it
				windows.delete(win);
			}
		}

		log("broadcast:", snap.id, `(${windows.size} windows)`);
	};

	const registerStore = <T = unknown>(id: string, store: Store<T>) => {
		if (stores.has(id)) {
			log("store already registered, skipping:", id);
			return;
		}

		const entry: StoreEntry<T> = {
			store,
			rev: 0,
			unsubscribe: () => {},
		};

		const unsubscribe = store.subscribe((value) => {
			entry.rev += 1;
			const snap: Snapshot<T> = { id, rev: entry.rev, value };

			// Optional: Serialization validation
			if (validateSerialization) {
				try {
					structuredClone(value);
				} catch (err) {
					handleError(
						new IPCError(
							`Store value not serializable: ${id}`,
							"SERIALIZATION_FAILED",
							id,
							err,
						),
					);
					return; // Don't broadcast invalid values
				}
			}

			broadcast(snap);
		});

		entry.unsubscribe = unsubscribe;
		stores.set(id, entry);

		log("store registered:", id);
	};

	// Initialize services
	const serviceManager = initServices(windows, {
		channelPrefix,
		enableLogging,
		onError: opts.onError,
	});

	const api: MainApi = {
		registerStore,
		isInitialized: () => true,
		registerService: serviceManager.registerService,
		broadcast: serviceManager.broadcast,
	};
	globalWithSymbols[WF_NS_MAIN_API] = api;

	// Drain the store queue: auto-register stores that were created before initNanoStoreIPC()
	for (const [id, store] of queue.entries()) {
		registerStore(id, store);
	}
	queue.clear();

	// Drain the service queue: auto-register services that were created before initNanoStoreIPC()
	const serviceQueue: Map<string, ServiceQueueEntry> =
		(globalWithSymbols[WF_NS_SERVICE_QUEUE] as
			| Map<string, ServiceQueueEntry>
			| undefined) ?? new Map();
	for (const [id, entry] of serviceQueue.entries()) {
		api.registerService(id, entry.definition);
		log("service registered from queue:", id);
	}
	serviceQueue.clear();

	// IPC handlers (generic, no per-store handlers)
	const getChannel = ch(channelPrefix, "ns:get");
	const setChannel = ch(channelPrefix, "ns:set");

	if (ipcMain.listenerCount(getChannel) === 0) {
		ipcMain.handle(getChannel, (_e, id: string) => {
			const entry = stores.get(id);
			if (!entry) {
				const err = new IPCError(
					`Store not found: ${id}`,
					"STORE_NOT_FOUND",
					id,
				);
				handleError(err);
				throw err;
			}
			return {
				id,
				rev: entry.rev,
				value: entry.store.get(),
			} satisfies Snapshot<unknown>;
		});
	}

	if (ipcMain.listenerCount(setChannel) === 0) {
		ipcMain.handle(setChannel, (_e, id: string, value: unknown) => {
			if (!allowRendererSet) {
				const err = new IPCError(
					"Renderer writes are disabled (allowRendererSet=false)",
					"RENDERER_WRITE_DISABLED",
					id,
				);
				handleError(err);
				throw err;
			}

			const entry = stores.get(id);
			if (!entry) {
				const err = new IPCError(
					`Store not found: ${id}`,
					"STORE_NOT_FOUND",
					id,
				);
				handleError(err);
				throw err;
			}

			// Type-safe set with existence check
			const store = entry.store as { set?: (val: unknown) => void };
			if (typeof store.set === "function") {
				store.set(value);
			}
		});
	}

	const registerWindow = (win: BrowserWindow) => {
		if (windows.has(win)) return;
		windows.add(win);

		// Cleanup on close
		const onClosed = () => {
			windows.delete(win);
			log("window unregistered:", win.id);
		};
		win.once("closed", onClosed);

		// Push snapshots only once per load
		const pushSnapshots = () => {
			if (win.isDestroyed()) return;

			log("pushing snapshots to window:", win.id);
			for (const [id, entry] of stores.entries()) {
				const snap: Snapshot<unknown> = {
					id,
					rev: entry.rev,
					value: entry.store.get(),
				};
				try {
					win.webContents.send(ch(channelPrefix, "ns:update"), snap);
				} catch (err) {
					handleError(
						new IPCError(
							`Failed to push snapshot for store "${id}"`,
							"IPC_FAILED",
							id,
							err,
						),
					);
				}
			}
		};

		// Use once() instead of on() to prevent memory leak
		win.webContents.once("did-finish-load", pushSnapshots);

		log("window registered:", win.id);
	};

	if (autoRegisterWindows) {
		app.on("browser-window-created", (_event, win) => {
			registerWindow(win);
		});
	}

	log("IPC initialized", {
		channelPrefix,
		autoRegisterWindows,
		allowRendererSet,
	});

	return {
		registerStore,
		registerWindow,
		destroy: () => {
			log("destroying IPC bridge...");

			// Unsubscribe all stores
			for (const [id, entry] of stores.entries()) {
				try {
					entry.unsubscribe();
					log("unsubscribed store:", id);
				} catch (err) {
					handleError(
						new IPCError(
							`Failed to unsubscribe store "${id}"`,
							"IPC_FAILED",
							id,
							err,
						),
					);
				}
			}

			// Clear collections
			stores.clear();
			windows.clear();

			// Remove IPC handlers
			try {
				ipcMain.removeHandler(getChannel);
				ipcMain.removeHandler(setChannel);
			} catch (err) {
				handleError(
					new IPCError(
						"Failed to remove IPC handlers",
						"IPC_FAILED",
						undefined,
						err,
					),
				);
			}

			// Destroy services
			try {
				serviceManager.destroy();
			} catch (err) {
				handleError(
					new IPCError(
						"Failed to destroy services",
						"IPC_FAILED",
						undefined,
						err,
					),
				);
			}
		},
	};
}
