import { type BrowserWindow, ipcMain } from "electron";
import {
	NanoStoreIPCError,
	type ServiceCallResult,
	type ServiceDefinition,
	type ServiceHandlers,
} from "../internal/types";

type ServiceEntry<T extends ServiceHandlers = ServiceHandlers> = {
	id: string;
	definition: ServiceDefinition<T>;
};

export interface InitServicesOptions {
	channelPrefix?: string;
	enableLogging?: boolean;
	onError?: (error: NanoStoreIPCError) => void;
}

/**
 * Initialize service IPC handlers in main process
 * Should be called after initNanoStoreIPC()
 */
export function initServices(
	windows: Set<BrowserWindow>,
	opts: InitServicesOptions = {},
) {
	const channelPrefix = opts.channelPrefix ?? "";
	const enableLogging = opts.enableLogging ?? false;

	const services = new Map<string, ServiceEntry>();

	const log = (...args: unknown[]) => {
		if (enableLogging) console.log("[services]", ...args);
	};

	const handleError = (error: NanoStoreIPCError) => {
		if (enableLogging) {
			console.error("[services:error]", {
				code: error.code,
				message: error.message,
				originalError: error.originalError,
			});
		}

		if (opts.onError) {
			try {
				opts.onError(error);
			} catch (error_) {
				console.error("[services] Error in error handler:", error_);
			}
		}
	};

	const ch = (c: string) => (channelPrefix ? `${channelPrefix}:${c}` : c);

	// Broadcast event to all windows
	const broadcast = (serviceId: string, eventName: string, data: unknown) => {
		const channel = ch("svc:event");
		const payload = { serviceId, eventName, data };

		// Clean up destroyed windows
		for (const win of windows) {
			if (win.isDestroyed()) {
				windows.delete(win);
			}
		}

		// Broadcast to all active windows
		for (const win of windows) {
			try {
				win.webContents.send(channel, payload);
			} catch (err) {
				handleError(
					new NanoStoreIPCError(
						`Failed to broadcast service event "${eventName}"`,
						"IPC_FAILED",
						serviceId,
						err,
					),
				);
				windows.delete(win);
			}
		}

		log("broadcast:", serviceId, eventName, `(${windows.size} windows)`);
	};

	// Register a service
	const registerService = <T extends ServiceHandlers>(
		id: string,
		definition: ServiceDefinition<T>,
	) => {
		if (services.has(id)) {
			log("service already registered, skipping:", id);
			return;
		}

		services.set(id, { id, definition });
		log("service registered:", id);
	};

	// IPC handler for service calls
	const callChannel = ch("svc:call");

	if (ipcMain.listenerCount(callChannel) === 0) {
		ipcMain.handle(
			callChannel,
			async (
				_event,
				serviceId: string,
				methodName: string,
				args: unknown[],
			): Promise<ServiceCallResult> => {
				const startTime = performance.now();

				try {
					// Find service
					const service = services.get(serviceId);
					if (!service) {
						const err = new NanoStoreIPCError(
							`Service not found: ${serviceId}`,
							"SERVICE_NOT_FOUND",
							serviceId,
						);
						handleError(err);
						return {
							success: false,
							error: {
								message: err.message,
								code: err.code,
								stack: err.stack,
							},
						};
					}

					// Find method
					const handler = service.definition.handlers[methodName];
					if (!handler || typeof handler !== "function") {
						const err = new NanoStoreIPCError(
							`Method not found: ${serviceId}.${methodName}`,
							"SERVICE_METHOD_NOT_FOUND",
							serviceId,
						);
						handleError(err);
						return {
							success: false,
							error: {
								message: err.message,
								code: err.code,
								stack: err.stack,
							},
						};
					}

					// Execute beforeAll hook
					if (service.definition.beforeAll) {
						await service.definition.beforeAll(methodName, args);
					}

					// Execute handler
					const result = await handler(...args);

					// Execute afterAll hook
					const duration = performance.now() - startTime;
					if (service.definition.afterAll) {
						await service.definition.afterAll(methodName, result, duration);
					}

					log(
						`${serviceId}.${methodName}() completed in ${duration.toFixed(2)}ms`,
					);

					return {
						success: true,
						result,
					};
				} catch (err) {
					const duration = performance.now() - startTime;
					const error = err instanceof Error ? err : new Error(String(err));

					// Still call afterAll on error
					const service = services.get(serviceId);
					if (service?.definition.afterAll) {
						try {
							await service.definition.afterAll(
								methodName,
								undefined,
								duration,
							);
						} catch {}
					}

					handleError(
						new NanoStoreIPCError(
							`Service call failed: ${serviceId}.${methodName}`,
							"IPC_FAILED",
							serviceId,
							err,
						),
					);

					return {
						success: false,
						error: {
							message: error.message,
							code: error.name,
							stack: error.stack,
						},
					};
				}
			},
		);
	}

	log("service IPC initialized", { channelPrefix });

	return {
		registerService,
		broadcast,
		destroy: () => {
			services.clear();
			try {
				ipcMain.removeHandler(callChannel);
			} catch (err) {
				handleError(
					new NanoStoreIPCError(
						"Failed to remove service IPC handler",
						"IPC_FAILED",
						undefined,
						err,
					),
				);
			}
			log("destroyed");
		},
	};
}
