import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import type { IPty } from "node-pty";
import { Ghostty, Terminal, FitAddon } from "ghostty-web";
import type { ITheme } from "ghostty-web";

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

/**
 * Read an Obsidian CSS variable from the body element.
 */
function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/**
 * Build a ghostty-web ITheme from Obsidian's current CSS variables.
 */
function buildThemeFromObsidian(): ITheme {
  return {
    background: getCssVar("--background-primary") || "#1e1e1e",
    foreground: getCssVar("--text-normal") || "#d4d4d4",
    cursor: getCssVar("--text-accent") || "#528bff",
    cursorAccent: getCssVar("--background-primary") || "#1e1e1e",
    selectionBackground: getCssVar("--text-selection") || undefined,

    // Map Obsidian's color palette to ANSI colors
    black: getCssVar("--color-base-00") || "#000000",
    red: getCssVar("--color-red") || "#e06c75",
    green: getCssVar("--color-green") || "#98c379",
    yellow: getCssVar("--color-yellow") || "#e5c07b",
    blue: getCssVar("--color-blue") || "#61afef",
    magenta: getCssVar("--color-purple") || "#c678dd",
    cyan: getCssVar("--color-cyan") || "#56b6c2",
    white: getCssVar("--color-base-70") || "#abb2bf",

    brightBlack: getCssVar("--color-base-50") || "#5c6370",
    brightRed: getCssVar("--color-red") || "#e06c75",
    brightGreen: getCssVar("--color-green") || "#98c379",
    brightYellow: getCssVar("--color-yellow") || "#e5c07b",
    brightBlue: getCssVar("--color-blue") || "#61afef",
    brightMagenta: getCssVar("--color-purple") || "#c678dd",
    brightCyan: getCssVar("--color-cyan") || "#56b6c2",
    brightWhite: getCssVar("--color-base-100") || "#ffffff",
  };
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
    this.plugin.untrackView(this);
    this.stopSession();
    this.contentEl.empty();
  }

  /** Re-read Obsidian CSS vars and push them into the terminal renderer. */
  syncTheme(): void {
    if (!this.term?.renderer) return;
    this.term.renderer.setTheme(buildThemeFromObsidian());
  }

  private async startSession(): Promise<void> {
    const { contentEl } = this;
    this.stopSession();

    // 1. Load ghostty WASM
    const pluginDir = this.plugin.getPluginDirPath();
    const wasmPath = join(pluginDir, "ghostty-vt.wasm");
    const ghostty = await loadGhostty(wasmPath);

    // 2. Create Terminal themed from Obsidian's CSS variables
    this.term = new Terminal({
      ghostty,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 10000,
      theme: buildThemeFromObsidian(),
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
    container.addEventListener("keydown", (e) => {
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
  private views: Set<GhosttyTerminalView> = new Set();

  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_GHOSTTY, (leaf: WorkspaceLeaf) => {
      const view = new GhosttyTerminalView(leaf, this);
      this.views.add(view);
      return view;
    });

    this.addCommand({
      id: "toggle",
      name: "Toggle terminal",
      callback: () => {
        this.toggleView().catch(console.error);
      },
    });

    this.addCommand({
      id: "new-terminal",
      name: "New terminal",
      callback: () => {
        this.newTerminal().catch(console.error);
      },
    });

    this.addCommand({
      id: "close-terminal",
      name: "Close terminal",
      checkCallback: (checking) => {
        const leaf = this.getFocusedTerminalLeaf();
        if (!leaf) return false;
        if (!checking) leaf.detach();
        return true;
      },
    });

    this.addCommand({
      id: "next-terminal",
      name: "Next terminal",
      checkCallback: (checking) => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
        if (leaves.length < 2) return false;
        if (!checking) this.cycleTerminal(1);
        return true;
      },
    });

    this.addCommand({
      id: "prev-terminal",
      name: "Previous terminal",
      checkCallback: (checking) => {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
        if (leaves.length < 2) return false;
        if (!checking) this.cycleTerminal(-1);
        return true;
      },
    });

    // Sync terminal theme when Obsidian theme/CSS changes
    this.registerEvent(
      (this.app.workspace as any).on("css-change", () => {
        for (const view of this.views) {
          view.syncTheme();
        }
      })
    );
  }

  onunload(): void {
    this.views.clear();
  }

  /** Remove a view from tracking (called implicitly when view closes). */
  untrackView(view: GhosttyTerminalView): void {
    this.views.delete(view);
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

  private async newTerminal(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("split", "horizontal");
    await leaf.setViewState({ type: VIEW_TYPE_GHOSTTY, active: true });
    await this.app.workspace.revealLeaf(leaf);
    setTimeout(() => {
      const view = leaf.view;
      if (view instanceof GhosttyTerminalView) {
        view.focusInput();
      }
    }, 100);
  }

  private getFocusedTerminalLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
    return leaves.find((l) =>
      l.view.containerEl.contains(document.activeElement)
    ) ?? null;
  }

  private cycleTerminal(direction: 1 | -1): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
    if (leaves.length < 2) return;

    const currentIndex = leaves.findIndex((l) =>
      l.view.containerEl.contains(document.activeElement)
    );
    const nextIndex =
      (currentIndex + direction + leaves.length) % leaves.length;
    const nextLeaf = leaves[nextIndex];

    this.app.workspace.revealLeaf(nextLeaf).then(() => {
      const view = nextLeaf.view;
      if (view instanceof GhosttyTerminalView) {
        view.focusInput();
      }
    });
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
