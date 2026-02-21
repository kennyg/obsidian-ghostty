import esbuild from "esbuild";
import { copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "node-pty"],
  format: "cjs",
  platform: "node",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "main.js",
});

// Copy ghostty-vt.wasm to plugin directory for runtime loading
const wasmSrc = join(__dirname, "node_modules", "ghostty-web", "ghostty-vt.wasm");
const wasmDst = join(__dirname, "ghostty-vt.wasm");
copyFileSync(wasmSrc, wasmDst);
console.log("  Copied ghostty-vt.wasm");
