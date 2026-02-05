# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands
- Install deps: `bun install`
- Dev build (watch): `bun run dev` (outputs `main.js`)
- Production build: `bun run build`
- Build native VT core + addon (Node): `bun run build:native`
- Build native addon against Obsidian’s Electron headers: `bun run build:native:electron`
- Rebuild node-pty against Obsidian’s Electron headers: `bun run build:pty:electron`
- Bootstrap Zig 0.14.1 locally: `bun run bootstrap:zig`
- Clean native artifacts: `bun run clean:native`

## Architecture overview
- **Obsidian plugin entrypoint**: `main.ts` registers the view and command, resolves the plugin directory, and loads the native module on view open. Build output is `main.js` (bundled by `esbuild.config.cjs`).
- **Native loader**: `native/ghostty.ts` resolves and `require()`s `native/ghostty_vt.node`, surfacing load status into the view.
- **Native addon**: `native/ghostty_vt.cc` is a Node-API addon that calls into the Ghostty VT C ABI and returns a demo viewport string.
- **Ghostty VT static library**: `native/ghostty_vt/zig` builds `libghostty_vt.a` from the vendored Ghostty sources; headers live in `native/ghostty_vt/include`.
- **Ghostty sources**: vendored under `vendor/ghostty` and used by the Zig build. Avoid editing unless necessary.
- **Build scripts**:
  - `scripts/build-ghostty-vt.mjs` builds the Zig static library and is chained into native builds.
  - `scripts/bootstrap-zig.mjs` downloads Zig 0.14.1 into `.context/zig/`.

## Vendored Ghostty notes (from `vendor/ghostty/AGENTS.md`)
- Use `zig build` for Ghostty (avoid `xcodebuild`).
- Formatting/testing commands there are `zig fmt .`, `zig build test`.
