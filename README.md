# Obsidian Ghostty Terminal

Ghostty-powered terminal view for Obsidian, using [ghostty-web](https://github.com/coder/ghostty-web) (WASM + canvas rendering).

## Features

- Full color and TUI support (vim, htop, etc.)
- Terminal colors follow your active Obsidian theme
- Tab management via command palette (new, close, next, previous terminal)
- Toggle with Cmd/Ctrl+J

## Development

1. Install dependencies:
   ```bash
   bun install
   ```
2. Rebuild node-pty for Obsidian's Electron:
   ```bash
   bun run build:pty:electron
   ```
3. Build the plugin:
   ```bash
   bun run dev
   ```
4. Copy the plugin folder into your vault at `.obsidian/plugins/obsidian-ghostty/` and enable it in Obsidian.

## Production build

```bash
bun run build
```
