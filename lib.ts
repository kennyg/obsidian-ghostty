import { readFileSync } from "fs";
import { Ghostty } from "ghostty-web";
import type { ITheme } from "ghostty-web";

/**
 * Load Ghostty WASM directly with readFileSync.
 * ghostty-web's Ghostty.load() uses `await import('fs/promises')` which
 * breaks when esbuild bundles to CJS (Obsidian requires CJS output).
 */
export async function loadGhostty(wasmPath: string): Promise<Ghostty> {
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
export function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/**
 * Build a ghostty-web ITheme from Obsidian's current CSS variables.
 */
export function buildThemeFromObsidian(): ITheme {
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
