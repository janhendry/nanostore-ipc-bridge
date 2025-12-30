import { defineService } from "@whisperflow/nanostore-ipc-bridge/services";
import { $counter, $settings } from "./stores";

/**
 * Store Controller Service - Demonstrates service + store integration
 *
 * Services can manipulate stores from Main process and broadcast events
 */
export const storeController = defineService({
	id: "storeController",
	handlers: {
		async incrementCounter(amount: number = 1) {
			const current = $counter.get();
			const newValue = current + amount;
			$counter.set(newValue);

			// Broadcast event to all windows
			storeController.broadcast("counterChanged", {
				from: current,
				to: newValue,
				amount,
			});

			return newValue;
		},

		async resetCounter() {
			$counter.set(0);
			storeController.broadcast("counterReset", { timestamp: Date.now() });
			return 0;
		},

		async setRandomCounter() {
			const random = Math.floor(Math.random() * 100);
			$counter.set(random);
			storeController.broadcast("counterRandomized", { value: random });
			return random;
		},

		async toggleTheme() {
			const current = $settings.get();
			const newTheme = current.theme === "dark" ? "light" : "dark";

			$settings.set({
				...current,
				theme: newTheme,
			});

			storeController.broadcast("themeToggled", { theme: newTheme });
			return newTheme;
		},

		async updateHotkey(hotkey: string) {
			const current = $settings.get();
			$settings.set({
				...current,
				hotkey,
			});

			storeController.broadcast("hotkeyUpdated", { hotkey });
			return hotkey;
		},

		async getStoreSnapshot() {
			return {
				counter: $counter.get(),
				settings: $settings.get(),
				timestamp: Date.now(),
			};
		},

		async bulkUpdate(counter?: number, theme?: "light" | "dark") {
			if (counter !== undefined) {
				$counter.set(counter);
			}

			if (theme !== undefined) {
				const current = $settings.get();
				$settings.set({ ...current, theme });
			}

			storeController.broadcast("bulkUpdate", { counter, theme });

			return {
				counter: $counter.get(),
				settings: $settings.get(),
			};
		},
	},
	hooks: {
		beforeAll: async (methodName, args) => {
			console.log(`[storeController] → ${methodName}`, args);
		},
		afterAll: async (methodName, result, duration) => {
			console.log(
				`[storeController] ✓ ${methodName} (${duration.toFixed(2)}ms)`,
				result,
			);
		},
	},
});
