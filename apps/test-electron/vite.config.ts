import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	root: "renderer",
	resolve: {
		alias: {
			"@shared": path.resolve(__dirname, "shared"),
		},
	},
	build: {
		outDir: "../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
