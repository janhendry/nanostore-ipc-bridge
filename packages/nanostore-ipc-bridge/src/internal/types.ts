import type { Store } from "nanostores";

export type Snapshot<T> = { id: string; rev: number; value: T };

export type MainRegisterFn = <T = unknown>(id: string, store: Store<T>) => void;

export type MainApi = {
	registerStore: MainRegisterFn;
	isInitialized: () => boolean;
	registerService: ServiceRegisterFn;
	broadcast: (serviceId: string, eventName: string, data?: unknown) => void;
};

export type ErrorHandler = (error: NanoStoreIPCError) => void;

export class NanoStoreIPCError extends Error {
	constructor(
		message: string,
		public code:
			| "STORE_NOT_FOUND"
			| "RENDERER_WRITE_DISABLED"
			| "SERIALIZATION_FAILED"
			| "IPC_FAILED"
			| "SERVICE_NOT_FOUND"
			| "SERVICE_METHOD_NOT_FOUND"
			| "ALREADY_INITIALIZED",
		public storeId?: string,
		public originalError?: unknown,
	) {
		super(message);
		this.name = "NanoStoreIPCError";
	}
}

// Service types
export type ServiceHandler = (...args: unknown[]) => Promise<unknown>;

export type ServiceHandlers = Record<string, ServiceHandler>;

export type ServiceHooks = {
	beforeAll?: (methodName: string, args: unknown[]) => void | Promise<void>;
	afterAll?: (
		methodName: string,
		result: unknown,
		duration: number,
	) => void | Promise<void>;
};

export type ServiceDefinition<T extends ServiceHandlers = ServiceHandlers> = {
	handlers: T;
	beforeAll?: (methodName: string, args: unknown[]) => void | Promise<void>;
	afterAll?: (
		methodName: string,
		result: unknown,
		duration: number,
	) => void | Promise<void>;
};

export type ServiceQueueEntry<T extends ServiceHandlers = ServiceHandlers> = {
	id: string;
	definition: ServiceDefinition<T>;
};

export type ServiceEventCallback = (data: unknown) => void;

export type ServiceBroadcastFn = (eventName: string, data: unknown) => void;

export type ServiceRegisterFn = <T extends ServiceHandlers>(
	id: string,
	handlers: ServiceDefinition<T>,
) => void;

export type ServiceCallResult<T = unknown> = {
	success: boolean;
	result?: T;
	error?: {
		message: string;
		code: string;
		stack?: string;
	};
};
