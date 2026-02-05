# Obsidian Ghostty Terminal

Minimal Obsidian plugin scaffold for a Ghostty-powered terminal view.

## Development

1. Install dependencies:
   ```bash
   bun install
   ```
2. Build the native VT core (requires Zig 0.14.1):
   ```bash
   bun run build:native
   ```
   If running inside Obsidian, build against its Electron headers:
   ```bash
   bun run build:native:electron
   ```
   Rebuild node-pty for Obsidian’s Electron:
   ```bash
   bun run build:pty:electron
   ```
3. Build in watch mode:
   ```bash
   bun run dev
   ```
4. Copy the plugin folder into your vault at `.obsidian/plugins/obsidian-ghostty/` and enable it in Obsidian.

### Native build prerequisites

- Zig 0.14.1 (auto-download with `bun run bootstrap:zig`, or set `ZIG=/path/to/zig`)
- Ghostty sources are vendored under `vendor/ghostty`

## Build

```bash
bun run build
```
