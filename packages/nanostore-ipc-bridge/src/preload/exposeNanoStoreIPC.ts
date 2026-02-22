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

/**
 * Validates that a value is safe to send via IPC.
 * Checks for basic serializability and prevents prototype pollution.
 */
function validateIPCValue(value: unknown): void {
	if (value === null || value === undefined) return;

	const type = typeof value;

	// Primitives are always safe
	if (type === "string" || type === "number" || type === "boolean") return;

	// Functions, symbols, and undefined are not serializable
	if (type === "function" || type === "symbol") {
		throw new TypeError(`Cannot serialize ${type} values via IPC`);
	}

	// Check objects and arrays recursively (with depth limit)
	if (type === "object") {
		// Reject dangerous constructors
		const proto = Object.getPrototypeOf(value);
		if (
			proto !== Object.prototype &&
			proto !== Array.prototype &&
			proto !== null
		) {
			// Allow Date, RegExp, Error which are structured-cloneable
			if (
				!(
					value instanceof Date ||
					value instanceof RegExp ||
					value instanceof Error
				)
			) {
				throw new TypeError("Cannot serialize class instances via IPC");
			}
		}

		// Check for prototype pollution attempts
		if (
			"__proto__" in (value as object) ||
			"constructor" in (value as object) ||
			"prototype" in (value as object)
		) {
			const obj = value as Record<string, unknown>;
			// Use Object.getPrototypeOf instead of deprecated __proto__
			const proto = Object.getPrototypeOf(obj);
			if (
				proto !== Object.prototype &&
				proto !== Array.prototype &&
				proto !== null
			) {
				throw new TypeError("Potentially unsafe object structure");
			}
		}
	}
}

/**
 * Validates string IDs to prevent injection attacks
 */
function validateId(id: string): void {
	if (typeof id !== "string" || id.length === 0) {
		throw new TypeError("ID must be a non-empty string");
	}
	if (id.length > 256) {
		throw new TypeError("ID too long (max 256 characters)");
	}
}

export function exposeNanoStoreIPC(opts: ExposeNanoStoreIPCOptions = {}) {
	const channelPrefix = opts.channelPrefix ?? "";
	const globalName = opts.globalName ?? "nanostoreIPC";

	const api: NanoStoreIPC = {
		get: (id) => {
			validateId(id);
			return ipcRenderer.invoke(ch(channelPrefix, "ns:get"), id);
		},
		set: (id, value) => {
			validateId(id);
			validateIPCValue(value);
			return ipcRenderer.invoke(ch(channelPrefix, "ns:set"), id, value);
		},
		subscribe: <T>(id: string, cb: (snap: Snapshot<T>) => void) => {
			validateId(id);
			if (typeof cb !== "function") {
				throw new TypeError("Callback must be a function");
			}
			const channel = ch(channelPrefix, "ns:update");
			const handler = (_: unknown, snap: Snapshot<unknown>) => {
				if (snap.id !== id) return;
				cb(snap as Snapshot<T>);
			};
			ipcRenderer.on(channel, handler);
			return () => ipcRenderer.removeListener(channel, handler);
		},
		subscribeAll: (cb) => {
			if (typeof cb !== "function") {
				throw new TypeError("Callback must be a function");
			}
			const channel = ch(channelPrefix, "ns:update");
			const handler = (_: unknown, snap: Snapshot<unknown>) => cb(snap);
			ipcRenderer.on(channel, handler);
			return () => ipcRenderer.removeListener(channel, handler);
		},

		// Service RPC call
		callService: async <T = unknown>(
			serviceId: string,
			method: string,
			...args: unknown[]
		): Promise<T> => {
			validateId(serviceId);
			validateId(method);

			// Validate all arguments
			for (const arg of args) {
				validateIPCValue(arg);
			}

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
			validateId(serviceId);
			validateId(eventName);
			if (typeof cb !== "function") {
				throw new TypeError("Callback must be a function");
			}
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
