import { existsSync } from "fs";
import { join } from "path";
import { addIcon, ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import type { IPty } from "node-pty";
import { Terminal, FitAddon } from "ghostty-web";
import { loadGhostty, buildThemeFromObsidian } from "./lib";

const VIEW_TYPE_GHOSTTY = "ghostty-terminal-view";
const GHOSTTY_ICON_ID = "ghostty-logo";

addIcon(
  GHOSTTY_ICON_ID,
  `<g transform="translate(13.5, 0) scale(3.7)">` +
    `<path d="M20.3955 32C19.1436 32 17.9152 31.6249 16.879 30.9333C15.8428 31.6249 14.6121 32 13.3625 32C12.113 32 10.8822 31.6249 9.84606 30.9333C8.8169 31.6249 7.62598 31.9906 6.37177 32H6.33426C4.63228 32 3.0358 31.3225 1.83316 30.0941C0.64928 28.8844 -0.00244141 27.2926 -0.00244141 25.6117V13.3626C-9.70841e-05 5.99443 5.99433 0 13.3625 0C20.7307 0 26.7252 5.99443 26.7252 13.3626V25.6164C26.7252 29.0086 24.0995 31.8078 20.7472 31.9906C20.6299 31.9977 20.5127 32 20.3955 32Z" fill="currentColor"/>` +
    `<path d="M23.9119 13.3627V25.6165C23.9119 27.4919 22.4654 29.079 20.5923 29.1822C19.6827 29.2314 18.8435 28.936 18.1941 28.4132C17.4158 27.7873 16.321 27.8154 15.5356 28.4343C14.9378 28.9055 14.183 29.1869 13.3601 29.1869C12.5372 29.1869 11.7847 28.9055 11.1869 28.4343C10.3922 27.8084 9.29738 27.8084 8.50266 28.4343C7.90954 28.9009 7.16405 29.1822 6.35291 29.1869C4.40478 29.2009 2.81299 27.5599 2.81299 25.6118V13.3627C2.81299 7.53704 7.5368 2.81323 13.3624 2.81323C19.1881 2.81323 23.9119 7.53704 23.9119 13.3627Z" fill="var(--background-primary)"/>` +
    `<path d="M11.2808 12.4366L7.3494 10.1673C6.83833 9.87192 6.18192 10.0477 5.88654 10.5588C5.59115 11.0699 5.76698 11.7263 6.27804 12.0217L8.60361 13.365L6.27804 14.7083C5.76698 15.0036 5.59115 15.6577 5.88654 16.1711C6.18192 16.6822 6.83599 16.858 7.3494 16.5626L11.2808 14.2933C11.9935 13.8807 11.9935 12.8516 11.2808 12.4389V12.4366Z" fill="currentColor"/>` +
    `<path d="M20.1822 12.2913H15.0176C14.4269 12.2913 13.9463 12.7695 13.9463 13.3626C13.9463 13.9557 14.4245 14.434 15.0176 14.434H20.1822C20.773 14.434 21.2535 13.9557 21.2535 13.3626C21.2535 12.7695 20.7753 12.2913 20.1822 12.2913Z" fill="currentColor"/>` +
    `</g>`
);

class GhosttyTerminalView extends ItemView {
  private pty: IPty | null = null;
  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeDisposable: { dispose(): void } | null = null;
  private title: string = "";

  constructor(leaf: WorkspaceLeaf, private plugin: GhosttyPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GHOSTTY;
  }

  getDisplayText(): string {
    return this.title || "Ghostty terminal";
  }

  getIcon(): string {
    return GHOSTTY_ICON_ID;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ghostty-terminal-view");

    // Add "+" button to the view header for new tabs
    this.addAction("plus", "New terminal tab", () => {
      this.plugin.newTerminalTab(this.leaf).catch(console.error);
    });

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

    // 7. Set initial title from cwd
    this.title = cwd;
    (this.leaf as any).updateHeader?.();

    // 8. Wire bidirectional data flow
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

    this.addRibbonIcon(GHOSTTY_ICON_ID, "Ghostty terminal", () => {
      this.activateView().catch(console.error);
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
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
    if (existing.length > 0) {
      await this.newTerminalTab(existing[0]);
    } else {
      await this.activateView();
    }
  }

  async newTerminalTab(siblingLeaf: WorkspaceLeaf): Promise<void> {
    const leaf = this.app.workspace.createLeafBySplit(siblingLeaf, "vertical", false);
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
