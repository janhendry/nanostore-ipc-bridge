import { useStore } from "@nanostores/react";
import { storeController } from "@shared/storeController";
import { $counter, $settings } from "@shared/stores";
import { todoService } from "@shared/todoService";
import React from "react";

export function App() {
	const counter = useStore($counter);
	const settings = useStore($settings);
	const [todos, setTodos] = React.useState<
		Array<{ id: number; text: string; completed: boolean }>
	>([]);
	const [newTodoText, setNewTodoText] = React.useState("");
	const [loading, setLoading] = React.useState(false);
	const [controllerEvents, setControllerEvents] = React.useState<string[]>([]);

	// Load todos on mount
	React.useEffect(() => {
		todoService.getTodos().then(setTodos);
	}, []);

	// Subscribe to store controller events
	React.useEffect(() => {
		const addEvent = (event: string) => {
			setControllerEvents((prev) => [...prev.slice(-4), event]);
		};

		const unsubs = [
			storeController.on("counterChanged", (data) => {
				const d = data as { from: number; to: number; amount: number };
				addEvent(`Counter: ${d.from} → ${d.to} (+${d.amount})`);
			}),
			storeController.on("counterReset", () => {
				addEvent("Counter reset to 0");
			}),
			storeController.on("counterRandomized", (data) => {
				addEvent(`Counter randomized: ${(data as any).value}`);
			}),
			storeController.on("themeToggled", (data) => {
				addEvent(`Theme → ${(data as any).theme}`);
			}),
			storeController.on("hotkeyUpdated", (data) => {
				addEvent(`Hotkey → ${(data as any).hotkey}`);
			}),
			storeController.on("bulkUpdate", () => {
				addEvent("Bulk update executed");
			}),
		];

		return () => unsubs.forEach((fn) => fn());
	}, []);

	// Subscribe to todo events
	React.useEffect(() => {
		const unsubAdded = todoService.on("todoAdded", (data) => {
			console.log("Event: todoAdded", data);
			setTodos((prev) => [...prev, data as any]);
		});

		const unsubToggled = todoService.on("todoToggled", (data) => {
			console.log("Event: todoToggled", data);
			const { id, completed } = data as { id: number; completed: boolean };
			setTodos((prev) =>
				prev.map((t) => (t.id === id ? { ...t, completed } : t)),
			);
		});

		const unsubDeleted = todoService.on("todoDeleted", (data) => {
			console.log("Event: todoDeleted", data);
			const { id } = data as { id: number };
			setTodos((prev) => prev.filter((t) => t.id !== id));
		});

		return () => {
			unsubAdded();
			unsubToggled();
			unsubDeleted();
		};
	}, []);

	const handleAddTodo = async () => {
		if (!newTodoText.trim()) return;
		setLoading(true);
		try {
			await todoService.addTodo(newTodoText);
			setNewTodoText("");
		} catch (err) {
			console.error("Failed to add todo:", err);
		} finally {
			setLoading(false);
		}
	};

	const handleToggle = async (id: number) => {
		try {
			await todoService.toggleTodo(id);
		} catch (err) {
			console.error("Failed to toggle todo:", err);
		}
	};

	const handleDelete = async (id: number) => {
		try {
			await todoService.deleteTodo(id);
		} catch (err) {
			console.error("Failed to delete todo:", err);
		}
	};

	return (
		<div style={{ fontFamily: "system-ui", padding: 16 }}>
			<h2>NanoStore IPC Bridge Demo</h2>
			<p>Opened as two windows. Changes should sync instantly across both.</p>

			<section
				style={{
					border: "1px solid #ddd",
					borderRadius: 8,
					padding: 12,
					marginBottom: 12,
				}}
			>
				<h3>Shared Counter</h3>
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						marginBottom: 8,
					}}
				>
					<button onClick={() => $counter.set(counter - 1)}>-</button>
					<div style={{ minWidth: 60, textAlign: "center", fontSize: 18 }}>
						{counter}
					</div>
					<button onClick={() => $counter.set(counter + 1)}>+</button>
					<button onClick={() => $counter.set(0)} style={{ marginLeft: 8 }}>
						Reset
					</button>
				</div>

				<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
					<button
						onClick={() => storeController.incrementCounter(5)}
						style={{ fontSize: "12px", padding: "4px 8px" }}
					>
						+5 (RPC)
					</button>
					<button
						onClick={() => storeController.setRandomCounter()}
						style={{ fontSize: "12px", padding: "4px 8px" }}
					>
						Random (RPC)
					</button>
					<button
						onClick={() => storeController.resetCounter()}
						style={{ fontSize: "12px", padding: "4px 8px" }}
					>
						Reset (RPC)
					</button>
				</div>
			</section>

			<section
				style={{
					border: "1px solid #ddd",
					borderRadius: 8,
					padding: 12,
					marginBottom: 12,
				}}
			>
				<h3>Store Controller Events</h3>
				{controllerEvents.length === 0 ? (
					<p style={{ color: "#999", fontSize: "14px", margin: 0 }}>
						No events yet. Try RPC buttons above.
					</p>
				) : (
					<ul style={{ margin: 0, padding: "0 0 0 20px", fontSize: "14px" }}>
						{controllerEvents.map((event, i) => (
							<li key={i} style={{ marginBottom: 4 }}>
								{event}
							</li>
						))}
					</ul>
				)}
			</section>

			<section
				style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}
			>
				<h3>Shared Settings</h3>

				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						marginBottom: 8,
					}}
				>
					<div>Theme:</div>
					<strong>{settings.theme}</strong>
					<button
						onClick={() =>
							$settings.set({
								...settings,
								theme: settings.theme === "dark" ? "light" : "dark",
							})
						}
					>
						Toggle
					</button>
					<button
						onClick={() => storeController.toggleTheme()}
						style={{ fontSize: "12px", padding: "4px 8px" }}
					>
						Toggle (RPC)
					</button>
				</div>

				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<div style={{ width: 60 }}>Hotkey:</div>
					<input
						value={settings.hotkey}
						onChange={(e) =>
							$settings.set({ ...settings, hotkey: e.target.value })
						}
						style={{ flex: 1 }}
					/>
				</div>
			</section>

			<section
				style={{
					border: "1px solid #ddd",
					borderRadius: 8,
					padding: 12,
					marginBottom: 12,
				}}
			>
				<h3>Todo Service (RPC Demo)</h3>

				<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
					<input
						value={newTodoText}
						onChange={(e) => setNewTodoText(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleAddTodo()}
						placeholder="New todo..."
						style={{ flex: 1, padding: "4px 8px" }}
						disabled={loading}
					/>
					<button
						onClick={handleAddTodo}
						disabled={loading || !newTodoText.trim()}
					>
						Add
					</button>
				</div>

				{todos.length === 0 ? (
					<p style={{ color: "#999", fontStyle: "italic" }}>
						No todos yet. Add one above!
					</p>
				) : (
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{todos.map((todo) => (
							<li
								key={todo.id}
								style={{
									display: "flex",
									gap: 8,
									alignItems: "center",
									padding: "4px 0",
									borderBottom: "1px solid #eee",
								}}
							>
								<input
									type="checkbox"
									checked={todo.completed}
									onChange={() => handleToggle(todo.id)}
								/>
								<span
									style={{
										flex: 1,
										textDecoration: todo.completed ? "line-through" : "none",
										color: todo.completed ? "#999" : "inherit",
									}}
								>
									{todo.text}
								</span>
								<button
									onClick={() => handleDelete(todo.id)}
									style={{ fontSize: "12px", padding: "2px 6px" }}
								>
									✕
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			<hr style={{ margin: "16px 0" }} />

			<details>
				<summary>What to try</summary>
				<ul>
					<li>Change counter in Window A — Window B updates.</li>
					<li>Toggle theme in Window B — Window A updates.</li>
					<li>Edit hotkey string in either window — syncs as you type.</li>
					<li>
						<strong>Add todos</strong> in one window — see them appear in both
						via RPC + events.
					</li>
					<li>
						<strong>Toggle/delete todos</strong> — all windows stay in sync.
					</li>
				</ul>
			</details>
		</div>
	);
}
