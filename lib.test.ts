import { describe, expect, it, mock } from "bun:test";
import { join } from "path";

describe("loadGhostty", () => {
  it("loads the real WASM and returns a Ghostty instance", async () => {
    const { loadGhostty } = await import("./lib");
    const wasmPath = join(import.meta.dir, "ghostty-vt.wasm");

    const ghostty = await loadGhostty(wasmPath);

    expect(ghostty).toBeDefined();
    expect(typeof ghostty.createTerminal).toBe("function");
    expect(typeof ghostty.createKeyEncoder).toBe("function");
  });
});

describe("buildThemeFromObsidian", () => {
  it("maps CSS variables to ITheme fields", async () => {
    // Mock the DOM globals that getCssVar relies on
    const cssVars: Record<string, string> = {
      "--background-primary": "#282c34",
      "--text-normal": "#abb2bf",
      "--text-accent": "#61afef",
      "--text-selection": "#3e4451",
      "--color-base-00": "#21252b",
      "--color-red": "#e06c75",
      "--color-green": "#98c379",
      "--color-yellow": "#e5c07b",
      "--color-blue": "#61afef",
      "--color-purple": "#c678dd",
      "--color-cyan": "#56b6c2",
      "--color-base-70": "#abb2bf",
      "--color-base-50": "#5c6370",
      "--color-base-100": "#ffffff",
    };

    const mockGetPropertyValue = mock((name: string) => cssVars[name] ?? "");
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: mockGetPropertyValue,
    })) as any;
    globalThis.document = { body: {} } as any;

    // Re-import to pick up the mocked globals
    // Use a cache-busting query so bun doesn't serve the cached module
    const { buildThemeFromObsidian } = await import(`./lib?t=${Date.now()}`);

    const theme = buildThemeFromObsidian();

    expect(theme.background).toBe("#282c34");
    expect(theme.foreground).toBe("#abb2bf");
    expect(theme.cursor).toBe("#61afef");
    expect(theme.cursorAccent).toBe("#282c34");
    expect(theme.selectionBackground).toBe("#3e4451");
    expect(theme.black).toBe("#21252b");
    expect(theme.red).toBe("#e06c75");
    expect(theme.green).toBe("#98c379");
    expect(theme.yellow).toBe("#e5c07b");
    expect(theme.blue).toBe("#61afef");
    expect(theme.magenta).toBe("#c678dd");
    expect(theme.cyan).toBe("#56b6c2");
    expect(theme.white).toBe("#abb2bf");
    expect(theme.brightBlack).toBe("#5c6370");
    expect(theme.brightWhite).toBe("#ffffff");
  });

  it("falls back to defaults when CSS variables are empty", async () => {
    const mockGetPropertyValue = mock(() => "");
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: mockGetPropertyValue,
    })) as any;
    globalThis.document = { body: {} } as any;

    const { buildThemeFromObsidian } = await import(`./lib?t=${Date.now()}`);

    const theme = buildThemeFromObsidian();

    expect(theme.background).toBe("#1e1e1e");
    expect(theme.foreground).toBe("#d4d4d4");
    expect(theme.cursor).toBe("#528bff");
    expect(theme.selectionBackground).toBeUndefined();
    expect(theme.black).toBe("#000000");
    expect(theme.brightWhite).toBe("#ffffff");
  });
});
