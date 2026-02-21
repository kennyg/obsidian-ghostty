import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import type { IPty } from "node-pty";
import { Ghostty, Terminal, FitAddon } from "ghostty-web";

/**
 * Load Ghostty WASM directly with readFileSync.
 * ghostty-web's Ghostty.load() uses `await import('fs/promises')` which
 * breaks when esbuild bundles to CJS (Obsidian requires CJS output).
 */
async function loadGhostty(wasmPath: string): Promise<Ghostty> {
  const buf = readFileSync(wasmPath);
  const wasmBytes = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
  const wasmModule = await WebAssembly.compile(wasmBytes);
  let memory: WebAssembly.Memory;
  const wasmInstance = await WebAssembly.instantiate(wasmModule, {
    env: {
      log: (ptr: number, len: number) => {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        console.log("[ghostty-vt]", new TextDecoder().decode(bytes));
      },
    },
  });
  memory = (wasmInstance.exports as { memory: WebAssembly.Memory }).memory;
  return new Ghostty(wasmInstance);
}

const VIEW_TYPE_GHOSTTY = "ghostty-terminal-view";

class GhosttyTerminalView extends ItemView {
  private pty: IPty | null = null;
  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeDisposable: { dispose(): void } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: GhosttyPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GHOSTTY;
  }

  getDisplayText(): string {
    return "Ghostty terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ghostty-terminal-view");

    try {
      await this.startSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      contentEl.createEl("div", {
        cls: "ghostty-terminal-placeholder",
        text: `Failed to start terminal: ${message}`,
      });
    }
  }

  async onClose(): Promise<void> {
    this.stopSession();
    this.contentEl.empty();
  }

  private async startSession(): Promise<void> {
    const { contentEl } = this;
    this.stopSession();

    // 1. Load ghostty WASM
    const pluginDir = this.plugin.getPluginDirPath();
    const wasmPath = join(pluginDir, "ghostty-vt.wasm");
    const ghostty = await loadGhostty(wasmPath);

    // 2. Create Terminal with ghostty-web (canvas-based rendering)
    this.term = new Terminal({
      ghostty,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 10000,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
      },
    });

    // 3. Load FitAddon for auto-resize
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);

    // 4. Mount to DOM
    const container = contentEl.createEl("div", {
      cls: "ghostty-terminal-container",
    });
    this.term.open(container);

    // 4b. Stop keyboard events from bubbling to Obsidian's hotkey system.
    // ghostty-web's InputHandler calls preventDefault but doesn't always
    // stopPropagation, so Obsidian intercepts keys like Enter, arrows, etc.
    container.addEventListener("keydown", (e) => {
      // Let Cmd/Ctrl+J propagate so our close handler works
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") return;
      e.stopPropagation();
    });

    // 5. Fit terminal to container after DOM layout
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.fitAddon.fit();
    this.fitAddon.observeResize();

    // 6. Spawn PTY
    let spawnPty: typeof import("node-pty").spawn;
    try {
      const nodePtyPath = pluginDir
        ? join(pluginDir, "node_modules", "node-pty")
        : "node-pty";
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Native node-pty module needs runtime require() for dynamic path resolution in Electron
      ({ spawn: spawnPty } = require(nodePtyPath) as typeof import("node-pty"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      contentEl.createEl("div", {
        cls: "ghostty-terminal-placeholder",
        text: `Failed to load node-pty: ${message}`,
      });
      return;
    }

    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const cwd: string =
      adapter.getBasePath?.() || process.env.HOME || process.cwd() || "/";

    this.pty = spawnPty(shell, [], {
      name: "xterm-256color",
      cols: this.term.cols,
      rows: this.term.rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    // 7. Wire bidirectional data flow
    this.pty.onData((data) => this.term?.write(data));   // PTY -> Terminal
    this.term.onData((data) => this.pty?.write(data));   // Terminal -> PTY

    // 8. Wire resize: when terminal resizes (via FitAddon), resize the PTY
    this.resizeDisposable = this.term.onResize(({ cols, rows }) => {
      try {
        this.pty?.resize(cols, rows);
      } catch {
        // ignore resize errors on dead PTY
      }
    });

    // 9. Handle Cmd/Ctrl+J to close terminal
    // NOTE: ghostty-web has inverted semantics from xterm.js —
    // return true = "I consumed this, skip it", false = "let terminal handle it"
    this.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        if (event.type === "keydown") {
          this.leaf.detach();
        }
        return true; // consumed — don't send to terminal
      }
      return false; // not consumed — let terminal process normally
    });

    // 10. Focus terminal
    this.term.focus();
  }

  private stopSession(): void {
    this.resizeDisposable?.dispose();
    this.resizeDisposable = null;

    this.fitAddon?.dispose();
    this.fitAddon = null;

    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // ignore
      }
      this.pty = null;
    }

    this.term?.dispose();
    this.term = null;
  }

  focusInput(): void {
    this.term?.focus();
  }
}

export default class GhosttyPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_GHOSTTY, (leaf: WorkspaceLeaf) => {
      return new GhosttyTerminalView(leaf, this);
    });

    this.addCommand({
      id: "toggle",
      name: "Toggle terminal",
      callback: () => {
        this.toggleView().catch(console.error);
      },
    });
  }

  onunload(): void {
    // Views are cleaned up automatically by Obsidian
  }

  private async toggleView(): Promise<void> {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);

    if (existingLeaves.length > 0) {
      const leaf = existingLeaves[0];
      // If the terminal is focused, close it; otherwise reveal it
      if (leaf.view.containerEl.contains(document.activeElement)) {
        leaf.detach();
        return;
      }
      await workspace.revealLeaf(leaf);
      const view = leaf.view;
      if (view instanceof GhosttyTerminalView) {
        view.focusInput();
      }
      return;
    }

    await this.activateView();
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);

    if (existingLeaves.length > 0) {
      await workspace.revealLeaf(existingLeaves[0]);
      const view = existingLeaves[0].view;
      if (view instanceof GhosttyTerminalView) {
        view.focusInput();
      }
      return;
    }

    const leaf = workspace.getLeaf("split", "horizontal");
    await leaf.setViewState({ type: VIEW_TYPE_GHOSTTY, active: true });
    await workspace.revealLeaf(leaf);

    // Focus the terminal input after it opens
    setTimeout(() => {
      const view = leaf.view;
      if (view instanceof GhosttyTerminalView) {
        view.focusInput();
      }
    }, 100);
  }

  getPluginDirPath(): string {
    return this.resolvePluginDir();
  }

  private resolvePluginDir(): string {
    const candidates: string[] = [];

    // Prefer the absolute path derived from the vault adapter
    const adapter = this.app.vault.adapter as {
      getBasePath?: () => string;
    };
    if (adapter.getBasePath) {
      const basePath = adapter.getBasePath();
      if (basePath) {
        candidates.push(
          join(basePath, this.app.vault.configDir, "plugins", this.manifest.id)
        );
      }
    }

    // Fall back to manifest.dir (may be relative)
    const manifestDir = (this.manifest as { dir?: string }).dir;
    if (manifestDir) {
      candidates.push(manifestDir);
    }

    for (const dir of candidates) {
      if (existsSync(join(dir, "manifest.json"))) {
        return dir;
      }
    }

    return candidates[0] ?? "";
  }
}
