import { existsSync } from "fs";
import { join } from "path";
import { ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { IPty } from "node-pty";
import {
  tryLoadGhosttyNative,
  type GhosttyNative,
  type GhosttyNativeState,
  type GhosttyTerminal,
} from "./native/ghostty";

const VIEW_TYPE_GHOSTTY = "ghostty-terminal-view";

class GhosttyTerminalView extends ItemView {
  private pty: IPty | null = null;
  private vt: GhosttyTerminal | null = null;
  private outputEl: HTMLPreElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingRender = false;
  private charSize: { width: number; height: number } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: GhosttyPlugin) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_TYPE_GHOSTTY;
  }

  getDisplayText(): string {
    return "Ghostty Terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ghostty-terminal-view");
    console.info("[ghostty] terminal view opened");

    contentEl.createEl("div", {
      cls: "ghostty-terminal-header",
      text: "Ghostty Terminal",
    });

    const body = contentEl.createEl("div", {
      cls: "ghostty-terminal-body",
    });
    this.bodyEl = body;

    const nativeState = this.plugin.getNativeState(true);
    this.statusEl = body.createEl("div", {
      cls: "ghostty-terminal-status",
      text: nativeState.message,
    });

    if (nativeState.native) {
      this.startSession(nativeState.native);
    } else {
      body.createEl("div", {
        cls: "ghostty-terminal-placeholder",
        text: "Native backend not loaded yet.",
      });
    }
  }

  async onClose(): Promise<void> {
    this.stopSession();
    this.contentEl.empty();
  }

  private startSession(native: GhosttyNative): void {
    if (!this.bodyEl) return;
    this.stopSession();

    const screen = this.bodyEl.createEl("div", {
      cls: "ghostty-terminal-screen",
    });
    this.outputEl = screen.createEl("pre", {
      cls: "ghostty-terminal-output",
    });

    const { cols, rows } = this.measureSize();
    this.vt = native.createTerminal(cols, rows);

    let spawnPty: typeof import("node-pty").spawn;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ({ spawn: spawnPty } = require("node-pty") as typeof import("node-pty"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusEl?.setText(`Failed to load node-pty: ${message}`);
      return;
    }

    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const cwd =
      adapter.getBasePath?.() || process.env.HOME || process.cwd() || "/";

    this.pty = spawnPty(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data) => {
      if (!this.vt) return;
      this.vt.feed(data);
      this.scheduleRender();
    });

    this.bodyEl.tabIndex = 0;
    this.bodyEl.addEventListener("keydown", this.handleKeyDown);
    this.bodyEl.addEventListener("paste", this.handlePaste);
    this.bodyEl.addEventListener("mousedown", this.focusTerminal);

    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(screen);

    this.scheduleRender();
  }

  private stopSession(): void {
    if (this.bodyEl) {
      this.bodyEl.removeEventListener("keydown", this.handleKeyDown);
      this.bodyEl.removeEventListener("paste", this.handlePaste);
      this.bodyEl.removeEventListener("mousedown", this.focusTerminal);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // ignore
      }
      this.pty = null;
    }
    if (this.vt) {
      this.vt.free();
      this.vt = null;
    }
    this.outputEl = null;
    this.pendingRender = false;
    this.charSize = null;
  }

  private scheduleRender(): void {
    if (this.pendingRender || !this.outputEl || !this.vt) return;
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      if (!this.outputEl || !this.vt) return;
      this.outputEl.setText(this.vt.dumpViewport());
      const container = this.outputEl.parentElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  private updateSize(): void {
    if (!this.vt || !this.pty) return;
    const { cols, rows } = this.measureSize();
    this.vt.resize(cols, rows);
    this.pty.resize(cols, rows);
    this.scheduleRender();
  }

  private measureSize(): { cols: number; rows: number } {
    const target = this.outputEl?.parentElement ?? this.bodyEl;
    if (!target) {
      return { cols: 80, rows: 24 };
    }
    const rect = target.getBoundingClientRect();
    const { width, height } = this.getCharSize();
    const cols = Math.max(2, Math.floor(rect.width / width));
    const rows = Math.max(2, Math.floor((rect.height - 12) / height));
    return { cols, rows };
  }

  private getCharSize(): { width: number; height: number } {
    if (this.charSize) return this.charSize;
    if (!this.bodyEl) {
      return { width: 8, height: 16 };
    }
    const span = document.createElement("span");
    span.textContent = "M";
    span.style.visibility = "hidden";
    span.style.position = "absolute";
    span.style.whiteSpace = "pre";
    span.style.fontFamily = "var(--font-monospace)";
    this.bodyEl.appendChild(span);
    const rect = span.getBoundingClientRect();
    span.remove();
    this.charSize = {
      width: rect.width || 8,
      height: rect.height || 16,
    };
    return this.charSize;
  }

  private focusTerminal = (): void => {
    this.bodyEl?.focus();
  };

  private handlePaste = (event: ClipboardEvent): void => {
    if (!this.pty) return;
    const text = event.clipboardData?.getData("text");
    if (text) {
      this.pty.write(text);
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.pty) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
      return;
    }

    let data: string | null = null;

    if (event.ctrlKey && event.key.length === 1) {
      const code = event.key.toUpperCase().charCodeAt(0) - 64;
      if (code >= 1 && code <= 26) {
        data = String.fromCharCode(code);
      }
    } else if (event.key === "Enter") {
      data = "\r";
    } else if (event.key === "Backspace") {
      data = "\x7f";
    } else if (event.key === "Tab") {
      data = "\t";
    } else if (event.key === "Escape") {
      data = "\x1b";
    } else if (event.key === "ArrowUp") {
      data = "\x1b[A";
    } else if (event.key === "ArrowDown") {
      data = "\x1b[B";
    } else if (event.key === "ArrowRight") {
      data = "\x1b[C";
    } else if (event.key === "ArrowLeft") {
      data = "\x1b[D";
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.length === 1) {
        data = event.key;
      }
    }

    if (data) {
      this.pty.write(data);
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

export default class GhosttyPlugin extends Plugin {
  private nativeState: GhosttyNativeState | null = null;
  async onload(): Promise<void> {
    console.info("[ghostty] plugin loaded");
    new Notice("Ghostty plugin loaded");
    this.registerView(VIEW_TYPE_GHOSTTY, (leaf: WorkspaceLeaf) => {
      return new GhosttyTerminalView(leaf, this);
    });

    this.addCommand({
      id: "open-ghostty-terminal",
      name: "Open Ghostty Terminal",
      hotkeys: [{ modifiers: ["Mod"], key: "J" }],
      callback: () => this.activateView(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GHOSTTY);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY);
    if (existingLeaves.length > 0) {
      workspace.detachLeavesOfType(VIEW_TYPE_GHOSTTY);
      return;
    }

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_GHOSTTY)[0];

    if (!leaf) {
      const splitLeaf = (workspace as any).getLeaf?.(
        "split",
        "horizontal"
      ) as WorkspaceLeaf | undefined;
      leaf = splitLeaf ?? workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_GHOSTTY, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  getNativeState(refresh = false): GhosttyNativeState {
    if (refresh || !this.nativeState || !this.nativeState.native) {
      this.nativeState = tryLoadGhosttyNative(this.resolvePluginDir());
    }
    return this.nativeState;
  }

  private resolvePluginDir(): string {
    const candidates: string[] = [];
    const manifestDir = (this.manifest as { dir?: string }).dir;
    if (manifestDir) {
      candidates.push(manifestDir);
    }

    const adapter = this.app.vault.adapter as {
      getBasePath?: () => string;
    };
    if (adapter.getBasePath) {
      const basePath = adapter.getBasePath();
      if (basePath) {
        candidates.push(
          join(basePath, ".obsidian", "plugins", this.manifest.id)
        );
      }
    }

    for (const dir of candidates) {
      if (existsSync(join(dir, "manifest.json"))) {
        return dir;
      }
    }

    return candidates[0] ?? "";
  }
}
