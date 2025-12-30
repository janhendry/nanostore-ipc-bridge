import type { Store } from "nanostores";

export type Snapshot<T> = { id: string; rev: number; value: T };

export type MainRegisterFn = <T = unknown>(id: string, store: Store<T>) => void;

export type MainApi = {
	registerStore: MainRegisterFn;
	isInitialized: () => boolean;
};

export type ErrorHandler = (error: NanoStoreIPCError) => void;

export class NanoStoreIPCError extends Error {
	constructor(
		message: string,
		public code:
			| "STORE_NOT_FOUND"
			| "RENDERER_WRITE_DISABLED"
			| "SERIALIZATION_FAILED"
			| "IPC_FAILED",
		public storeId?: string,
		public originalError?: unknown,
	) {
		super(message);
		this.name = "NanoStoreIPCError";
	}
}
