# AGENTS.md

This file provides guidance when working with code in this repository.

## Common commands
- Install deps: `bun install`
- Dev build: `bun run dev` (outputs `main.js` with sourcemaps + copies `ghostty-vt.wasm`)
- Production build: `bun run build` (minified `main.js` + copies `ghostty-vt.wasm`)
- Rebuild node-pty against Obsidian's Electron headers: `bun run build:pty:electron`

## Architecture overview
- **Obsidian plugin entrypoint**: `main.ts` registers the view and command, resolves the plugin directory, spawns a PTY via node-pty, and renders the terminal using ghostty-web's WASM-powered canvas renderer. Build output is `main.js` (bundled by `esbuild.config.cjs`).
- **Terminal rendering**: Uses `ghostty-web` npm package (Ghostty's VT100 parser compiled to WASM + canvas rendering). Provides full color, cursor styles, ligatures, and GPU-accelerated rendering via an xterm.js-compatible API.
- **WASM file**: `ghostty-vt.wasm` (~413KB) is copied from `node_modules/ghostty-web/` during build. Loaded at runtime via `Ghostty.load(wasmPath)`.
- **FitAddon**: Auto-resizes the terminal canvas to fit the container element using ResizeObserver.
- **PTY backend**: `node-pty` spawns the user's shell. Kept as external in esbuild since it's a native Node addon.
- **Build**: `esbuild.config.cjs` bundles ghostty-web's JS into `main.js` and copies the WASM file as a post-build step.
