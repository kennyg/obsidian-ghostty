# Obsidian Ghostty Terminal

Embedded terminal view for Obsidian, powered by [ghostty-web](https://github.com/coder/ghostty-web) (WASM + canvas rendering). Unofficial — not affiliated with the Ghostty project.

## Features

- Full color and TUI support (vim, htop, etc.)
- Terminal colors follow your active Obsidian theme
- Ghostty icon in the left ribbon to open the terminal
- Multiple terminal tabs with "+" button or command palette
- Tab management commands (new, close, next, previous terminal)
- Toggle with Cmd/Ctrl+J

## Installation

### Using BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin
2. Open BRAT settings → **Add Beta Plugin**
3. Enter: `kennyg/obsidian-ghostty`
4. Enable "Ghostty terminal" in Community Plugins

### Manual

1. Clone this repo into your vault's plugin directory:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/kennyg/obsidian-ghostty.git ghostty-terminal
   cd ghostty-terminal
   ```
2. Install dependencies and build:
   ```bash
   bun install
   bun run build:pty:electron
   bun run build
   ```
3. Enable "Ghostty terminal" in Obsidian → Settings → Community Plugins

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
4. Symlink the plugin folder into your vault at `.obsidian/plugins/ghostty-terminal/` and enable it in Obsidian.

## Production build

```bash
bun run build
```
