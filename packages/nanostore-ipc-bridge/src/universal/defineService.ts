import { WF_NS_MAIN_API, WF_NS_SERVICE_QUEUE } from "../internal/symbols";
import type {
	MainApi,
	ServiceHandlers,
	ServiceHooks,
	ServiceQueueEntry,
} from "../internal/types";

export interface DefineServiceOptions<THandlers extends ServiceHandlers> {
	/**
	 * Service identifier - must be unique across your app
	 */
	id: string;
	/**
	 * Service method handlers
	 * Main: executed locally
	 * Renderer: creates RPC proxy
	 */
	handlers: THandlers;
	/**
	 * Optional middleware hooks for Main process only
	 */
	hooks?: ServiceHooks;
	/**
	 * Window global name used by preload exposure.
	 * Default: "nanostoreIPC"
	 */
	globalName?: string;
}

type ServiceProxy<THandlers extends ServiceHandlers> = {
	[K in keyof THandlers]: THandlers[K] extends (
		...args: infer Args
	) => Promise<infer Return>
		? (...args: Args) => Promise<Return>
		: never;
} & {
	/**
	 * Subscribe to service events (Renderer only)
	 */
	on: (eventName: string, callback: (data: unknown) => void) => () => void;
	/**
	 * Broadcast an event to all renderer windows (Main only)
	 */
	broadcast: (eventName: string, data?: unknown) => void;
};

function isElectronMain(): boolean {
	return (
		typeof process !== "undefined" &&
		!!(process as { versions?: { electron?: string } }).versions?.electron &&
		globalThis.window === undefined
	);
}

function getMainApi(): MainApi | null {
	const globalWithSymbols = globalThis as Record<symbol, unknown>;
	return (globalWithSymbols[WF_NS_MAIN_API] as MainApi | undefined) ?? null;
}

type RendererServiceIPC = {
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

function getRendererServiceIPC(globalName: string): RendererServiceIPC | null {
	if (globalThis.window === undefined) return null;
	return (globalThis as unknown as Record<string, unknown>)[
		globalName
	] as RendererServiceIPC | null;
}

function getServiceQueue(): Map<string, ServiceQueueEntry> {
	const globalWithSymbols = globalThis as Record<symbol, unknown>;
	const q: Map<string, ServiceQueueEntry> =
		(globalWithSymbols[WF_NS_SERVICE_QUEUE] as
			| Map<string, ServiceQueueEntry>
			| undefined) ?? new Map();
	globalWithSymbols[WF_NS_SERVICE_QUEUE] = q;
	return q;
}

/**
 * Define a service that works in both Main and Renderer processes.
 *
 * **Main Process:**
 * - Registers handlers to be called via IPC
 * - Returns proxy with broadcast() method for sending events
 * - Handlers execute locally
 *
 * **Renderer Process:**
 * - Returns RPC proxy that calls Main process via IPC
 * - Returns proxy with on() method for listening to events
 * - All methods are async and execute remotely
 *
 * @example
 * ```ts
 * // shared/services/todoService.ts
 * export const todoService = defineService({
 *   id: 'todos',
 *   handlers: {
 *     async addTodo(text: string) {
 *       const todo = { id: Date.now(), text };
 *       todos.push(todo);
 *       todoService.broadcast('todoAdded', todo); // Main only
 *       return todo;
 *     },
 *     async getTodos() {
 *       return todos;
 *     }
 *   }
 * });
 *
 * // Main process (electron/main.ts)
 * import './shared/services/todoService'; // Auto-registers
 *
 * // Renderer (React component)
 * const todo = await todoService.addTodo('Buy milk'); // RPC call
 * todoService.on('todoAdded', (todo) => {
 *   console.log('New todo:', todo);
 * });
 * ```
 */
export function defineService<THandlers extends ServiceHandlers>(
	options: DefineServiceOptions<THandlers>,
): ServiceProxy<THandlers> {
	const { id, handlers, hooks, globalName = "nanostoreIPC" } = options;

	if (isElectronMain()) {
		// Main Process: Register service handlers or queue
		const api = getMainApi();
		const definition = {
			handlers,
			beforeAll: hooks?.beforeAll,
			afterAll: hooks?.afterAll,
		};

		if (!api) {
			// Main API not ready yet - add to queue
			const queue = getServiceQueue();
			queue.set(id, { id, definition });
		} else {
			// Main API ready - register immediately
			api.registerService(id, definition);
		}

		// Create proxy with broadcast() method
		const proxy = {} as ServiceProxy<THandlers>;

		// Add broadcast method (works with or without API)
		proxy.broadcast = (eventName: string, data?: unknown) => {
			const currentApi = getMainApi();
			if (currentApi) {
				currentApi.broadcast(id, eventName, data);
			}
			// If API not ready, broadcast is silently skipped (service not fully initialized yet)
		};

		// Add dummy on() that throws (Main shouldn't listen to events)
		proxy.on = () => {
			throw new Error(
				`[defineService] Cannot use on() in Main process. Use broadcast() to send events to Renderer.`,
			);
		};

		// Bind handler methods directly (no RPC needed in Main)
		for (const [methodName, handler] of Object.entries(handlers)) {
			(proxy as Record<string, unknown>)[methodName] = handler;
		}

		return proxy;
	} else {
		// Renderer Process: Create RPC proxy
		const ipc = getRendererServiceIPC(globalName);
		if (!ipc) {
			throw new Error(
				`[defineService] Renderer IPC not available. Ensure exposeNanoStoreIPC() is called in preload script with globalName="${globalName}".`,
			);
		}

		const proxy = {} as ServiceProxy<THandlers>;

		// Add on() method for event subscription
		proxy.on = (eventName: string, callback: (data: unknown) => void) => {
			return ipc.subscribeServiceEvent(id, eventName, callback);
		};

		// Add dummy broadcast() that throws (Renderer shouldn't broadcast)
		proxy.broadcast = () => {
			throw new Error(
				`[defineService] Cannot use broadcast() in Renderer process. Use RPC methods to trigger events from Main.`,
			);
		};

		// Create RPC proxy for each handler
		for (const methodName of Object.keys(handlers)) {
			(proxy as Record<string, unknown>)[methodName] = (...args: unknown[]) => {
				return ipc.callService(id, methodName, ...args);
			};
		}

		return proxy;
	}
}
