import { defineConfig } from "tsup";

export default defineConfig([
	// Main process (ESM)
	{
		entry: {
			main: "electron/main.ts",
		},
		format: ["esm"],
		outDir: "dist-electron",
		external: [
			"electron",
			"nanostores",
			"@whisperflow/nanostore-ipc-bridge",
			"@nanostores/react",
		],
		noExternal: [],
		platform: "node",
		target: "node18",
		sourcemap: false,
		clean: true,
	},
	// Preload script (CommonJS with bundled dependencies)
	{
		entry: {
			preload: "electron/preload.ts",
		},
		format: ["cjs"],
		outDir: "dist-electron",
		outExtension: () => ({ js: ".js" }),
		external: ["electron"],
		noExternal: [/@whisperflow/],
		platform: "node",
		target: "node18",
		sourcemap: false,
		clean: false,
	},
]);
