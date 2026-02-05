const esbuild = require("esbuild");

const production = process.argv.includes("--production");

esbuild
  .build({
    entryPoints: ["main.ts"],
    bundle: true,
    external: ["obsidian", "node-pty"],
    format: "cjs",
    platform: "node",
    target: "es2018",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    minify: production,
    outfile: "main.js",
  })
  .catch(() => process.exit(1));
