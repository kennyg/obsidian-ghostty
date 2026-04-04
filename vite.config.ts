import { defineConfig } from "vite";
import { builtinModules } from "module";
import { copyFileSync } from "fs";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const production = mode === "production";

  return {
    build: {
      lib: {
        entry: resolve(__dirname, "src/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      outDir: "dist",
      sourcemap: production ? false : "inline",
      minify: production ? "esbuild" : false,
      target: "es2022",
      rollupOptions: {
        external: [
          "obsidian",
          "node-pty",
          ...builtinModules,
          ...builtinModules.map((m) => `node:${m}`),
        ],
        output: {
          codeSplitting: false,
        },
      },
    },
    plugins: [
      {
        name: "post-build",
        closeBundle() {
          copyFileSync(resolve(__dirname, "dist", "main.js"), resolve(__dirname, "main.js"));
          copyFileSync(
            resolve(__dirname, "node_modules", "ghostty-web", "ghostty-vt.wasm"),
            resolve(__dirname, "ghostty-vt.wasm"),
          );
          console.log("  Copied main.js and ghostty-vt.wasm to plugin root");
        },
      },
    ],
  };
});
