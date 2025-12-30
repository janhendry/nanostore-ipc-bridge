import type { Store, WritableAtom } from "nanostores";
import { atom } from "nanostores";
import { WF_NS_MAIN_API, WF_NS_QUEUE } from "../internal/symbols";
import type { ErrorHandler, MainApi, Snapshot } from "../internal/types";
import { NanoStoreIPCError } from "../internal/types";

export interface SyncedAtomOptions<T> {
	/**
	 * If true, renderer writes are blocked even if main allows writes.
	 * Useful to force "actions only" mutability later without breaking API.
	 */
	rendererCanSet?: boolean;
	/**
	 * Optional: warn when IPC is not available (e.g. during SSR/tests).
	 */
	warnIfNoIPC?: boolean;
	/**
	 * Optional: channel prefix to match init/expose
	 * If you set it here, you must also pass it to expose/init.
	 * If omitted, uses unprefixed channels.
	 */
	channelPrefix?: string;
	/**
	 * Window global name used by preload exposure.
	 * Default: "nanostoreIPC"
	 */
	globalName?: string;
	/**
	 * Error handler called when errors occur in IPC operations.
	 */
	onError?: ErrorHandler;
	/**
	 * Optional value validator. Return false to reject the value.
	 * Can be used for runtime validation (e.g., with Zod).
	 */
	validateValue?: (value: T) => boolean | Promise<boolean>;
}

function isElectronMain(): boolean {
	// In Electron main, `process.versions.electron` exists and there is no window/document.
	return (
		typeof process !== "undefined" &&
		!!(process as { versions?: { electron?: string } }).versions?.electron &&
		globalThis.window === undefined
	);
}

type RendererIPC = {
	get: <T = unknown>(id: string) => Promise<Snapshot<T>>;
	set: <T = unknown>(id: string, value: T) => Promise<void>;
	subscribe: <T = unknown>(
		id: string,
		cb: (snap: Snapshot<T>) => void,
	) => () => void;
	subscribeAll: (cb: (snap: Snapshot<unknown>) => void) => () => void;
};

function getRendererIPC(globalName: string): RendererIPC | null {
	if (globalThis.window === undefined) return null;
	return (globalThis as unknown as Record<string, unknown>)[
		globalName
	] as RendererIPC | null;
}

function getMainApi(): MainApi | null {
	const globalWithSymbols = globalThis as Record<symbol, unknown>;
	return (globalWithSymbols[WF_NS_MAIN_API] as MainApi | undefined) ?? null;
}

function getQueue(): Map<string, Store<unknown>> {
	const globalWithSymbols = globalThis as Record<symbol, unknown>;
	const q: Map<string, Store<unknown>> = (globalWithSymbols[WF_NS_QUEUE] as
		| Map<string, Store<unknown>>
		| undefined) ?? new Map();
	globalWithSymbols[WF_NS_QUEUE] = q;
	return q;
}

/**
 * syncedAtom(id, initial):
 * - In Electron Main: creates a real atom and registers it for IPC broadcast.
 * - In Electron Renderer: creates a proxy atom and syncs it via preload-exposed IPC API.
 * - Outside Electron: behaves as a normal atom(initial).
 *
 * No central "bridge definition" required; ID is the single piece of shared contract.
 */
export function syncedAtom<T>(
	id: string,
	initial: T,
	options: SyncedAtomOptions<T> = {},
) {
	const globalName = options.globalName ?? "nanostoreIPC";

	// MAIN: real store + registration
	if (isElectronMain()) {
		const $store = atom<T>(initial);

		const api = getMainApi();
		if (api) {
			api.registerStore(id, $store);
		} else {
			// initNanoStoreIPC not called yet -> queue for later
			getQueue().set(id, $store);
		}

		return $store;
	}

	// RENDERER: IPC-backed proxy store (if IPC is available)
	const ipc = getRendererIPC(globalName);

	type AtomWithDestroy<T> = WritableAtom<T> & { destroy?: () => void };
	const $local: AtomWithDestroy<T> = atom<T>(initial);

	if (!ipc) {
		if (options.warnIfNoIPC) {
			// eslint-disable-next-line no-console
			console.warn(
				`[syncedAtom] IPC not available for "${id}". Falling back to local atom().`,
			);
		}
		return $local;
	}

	let applyingRemote = false;
	let lastRev = -1;
	let readyForOutbound = false;
	const rendererCanSet = options.rendererCanSet ?? true;

	// remote -> local (subscribe first)
	const unsubscribeRemote = ipc.subscribe(id, (snap: Snapshot<T>) => {
		if (snap.rev <= lastRev) return;
		lastRev = snap.rev;
		applyingRemote = true;
		$local.set(snap.value);
		applyingRemote = false;
		readyForOutbound = true;
	});

	// then get snapshot (rev-gated)
	ipc
		.get<T>(id)
		.then((snap: Snapshot<T>) => {
			if (snap.rev <= lastRev) return;
			lastRev = snap.rev;

			applyingRemote = true;
			$local.set(snap.value);
			applyingRemote = false;
			readyForOutbound = true;
		})
		.catch((err: unknown) => {
			const ipcError =
				err instanceof NanoStoreIPCError
					? err
					: new NanoStoreIPCError(
							`Failed to get initial value for store "${id}"`,
							"IPC_FAILED",
							id,
							err,
						);

			if (options.onError) {
				options.onError(ipcError);
			} else if (options.warnIfNoIPC) {
				console.warn("[syncedAtom]", ipcError.message, ipcError);
			}

			readyForOutbound = true; // allow local usage even if remote missing
		});

	// local -> remote (after first remote snapshot or after get failed)
	const unsubscribeLocal = $local.subscribe((value: T) => {
		if (!rendererCanSet) return;
		if (!readyForOutbound) return;
		if (applyingRemote) return;

		// Optional validation
		if (options.validateValue) {
			const isValid = options.validateValue(value);
			if (isValid === false) {
				const err = new NanoStoreIPCError(
					`Validation failed for store "${id}"`,
					"SERIALIZATION_FAILED",
					id,
				);
				if (options.onError) options.onError(err);
				return;
			}
		}

		ipc.set(id, value).catch((err: unknown) => {
			const ipcError =
				err instanceof NanoStoreIPCError
					? err
					: new NanoStoreIPCError(
							`Failed to set value for store "${id}"`,
							"IPC_FAILED",
							id,
							err,
						);
			if (options.onError) {
				options.onError(ipcError);
			}
		});
	});

	// Optional cleanup hook
	$local.destroy = () => {
		try {
			unsubscribeRemote();
		} catch (err) {
			if (options.onError) {
				options.onError(
					new NanoStoreIPCError(
						"Failed to unsubscribe from remote updates",
						"IPC_FAILED",
						id,
						err,
					),
				);
			}
		}

		try {
			unsubscribeLocal();
		} catch (err) {
			if (options.onError) {
				options.onError(
					new NanoStoreIPCError(
						"Failed to unsubscribe from local updates",
						"IPC_FAILED",
						id,
						err,
					),
				);
			}
		}
	};

	return $local;
}
