import { contextBridge, ipcRenderer } from "electron";
import type { ServiceCallResult, Snapshot } from "../internal/types";

export interface ExposeNanoStoreIPCOptions {
	channelPrefix?: string;
	/**
	 * Name under which the API is exposed to window.
	 * Default: "nanostoreIPC"
	 */
	globalName?: string;
}

export type NanoStoreIPC = {
	get: <T = unknown>(id: string) => Promise<Snapshot<T>>;
	set: <T = unknown>(id: string, value: T) => Promise<void>;
	subscribe: <T = unknown>(
		id: string,
		cb: (snap: Snapshot<T>) => void,
	) => () => void;
	subscribeAll: (cb: (snap: Snapshot<unknown>) => void) => () => void;
	// Services
	callService: <T = unknown>(
		serviceId: string,
		method: string,
		...args: unknown[]
	) => Promise<T>;
	subscribeServiceEvent: (
		serviceId: string,
		eventName: string,
		cb: (data: unknown) => void,
	) => () => void;
};

function ch(prefix: string, c: string) {
	return prefix ? `${prefix}:${c}` : c;
}

export function exposeNanoStoreIPC(opts: ExposeNanoStoreIPCOptions = {}) {
	const channelPrefix = opts.channelPrefix ?? "";
	const globalName = opts.globalName ?? "nanostoreIPC";

	const api: NanoStoreIPC = {
		get: (id) => ipcRenderer.invoke(ch(channelPrefix, "ns:get"), id),
		set: (id, value) =>
			ipcRenderer.invoke(ch(channelPrefix, "ns:set"), id, value),
		subscribe: (id, cb) => {
			const channel = ch(channelPrefix, "ns:update");
			const handler = (_: unknown, snap: Snapshot<unknown>) => {
				if (snap.id !== id) return;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				cb(snap as any);
			};
			ipcRenderer.on(channel, handler);
			return () => ipcRenderer.removeListener(channel, handler);
		},
		subscribeAll: (cb) => {
			const channel = ch(channelPrefix, "ns:update");
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const handler = (_: unknown, snap: Snapshot<unknown>) => cb(snap as any);
			ipcRenderer.on(channel, handler);
			return () => ipcRenderer.removeListener(channel, handler);
		},

		// Service RPC call
		callService: async <T = unknown>(
			serviceId: string,
			method: string,
			...args: unknown[]
		): Promise<T> => {
			const channel = ch(channelPrefix, "svc:call");
			const result: ServiceCallResult = await ipcRenderer.invoke(
				channel,
				serviceId,
				method,
				args,
			);

			if (!result.success) {
				// Reconstruct error from Main
				const error = new Error(result.error?.message || "Service call failed");
				error.name = result.error?.code || "ServiceError";
				if (result.error?.stack) {
					error.stack = result.error.stack;
				}
				throw error;
			}

			return result.result as T;
		},

		// Subscribe to service events
		subscribeServiceEvent: (
			serviceId: string,
			eventName: string,
			cb: (data: unknown) => void,
		) => {
			const channel = ch(channelPrefix, "svc:event");
			const handler = (
				_: unknown,
				payload: { serviceId: string; eventName: string; data: unknown },
			) => {
				if (payload.serviceId !== serviceId || payload.eventName !== eventName)
					return;
				cb(payload.data);
			};
			ipcRenderer.on(channel, handler);
			return () => ipcRenderer.removeListener(channel, handler);
		},
	};

	contextBridge.exposeInMainWorld(globalName, api);
	return api;
}
