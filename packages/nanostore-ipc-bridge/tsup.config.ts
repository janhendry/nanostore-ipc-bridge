import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"main/index": "src/main/index.ts",
		"preload/index": "src/preload/index.ts",
		"universal/index": "src/universal/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	target: "es2022",
	external: ["electron", "nanostores"],
	noExternal: [],
});
