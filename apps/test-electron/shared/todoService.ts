import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

// In-memory todo storage
const todos: Array<{ id: number; text: string; completed: boolean }> = [];

/**
 * Todo Service - Example service demonstrating defineService API
 *
 * In Main Process:
 * - Handlers execute locally
 * - Use broadcast() to send events to all renderer windows
 *
 * In Renderer Process:
 * - Returns RPC proxy calling Main process
 * - Use on() to listen to events from Main
 */
export const todoService = defineService({
	id: "todos",
	handlers: {
		async addTodo(text: string) {
			const todo = {
				id: Date.now(),
				text,
				completed: false,
			};
			todos.push(todo);

			// Broadcast event to all renderer windows (Main only)
			todoService.broadcast("todoAdded", todo);

			return todo;
		},

		async getTodos() {
			return [...todos];
		},

		async toggleTodo(id: number) {
			const todo = todos.find((t) => t.id === id);
			if (!todo) {
				throw new Error(`Todo ${id} not found`);
			}

			todo.completed = !todo.completed;

			// Broadcast event to all renderer windows (Main only)
			todoService.broadcast("todoToggled", { id, completed: todo.completed });

			return todo;
		},

		async deleteTodo(id: number) {
			const index = todos.findIndex((t) => t.id === id);
			if (index === -1) {
				throw new Error(`Todo ${id} not found`);
			}

			todos.splice(index, 1);

			// Broadcast event to all renderer windows (Main only)
			todoService.broadcast("todoDeleted", { id });

			return true;
		},
	},
	hooks: {
		beforeAll: async (methodName, args) => {
			console.log(`[todoService] Calling ${methodName}`, args);
		},
		afterAll: async (methodName, result, duration) => {
			console.log(
				`[todoService] ${methodName} completed in ${duration.toFixed(2)}ms`,
			);
		},
	},
});
