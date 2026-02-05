import { existsSync } from "fs";
import { join } from "path";

export type GhosttyNative = {
  version(): string;
  renderDemo(): string;
  createTerminal(cols: number, rows: number): GhosttyTerminal;
};

export type GhosttyTerminal = {
  feed(data: Uint8Array | string): number;
  resize(cols: number, rows: number): number;
  dumpViewport(): string;
  free(): void;
};

export type GhosttyNativeState = {
  native: GhosttyNative | null;
  message: string;
};

export function tryLoadGhosttyNative(
  pluginDir: string,
  fallbackDir?: string
): GhosttyNativeState {
  const baseDir = pluginDir || fallbackDir || "";
  if (!baseDir) {
    return {
      native: null,
      message: "Plugin directory is unavailable.",
    };
  }
  const modulePath = join(baseDir, "native", "ghostty_vt.node");

  if (!existsSync(modulePath)) {
    return {
      native: null,
      message: `Native module not found at ${modulePath}. baseDir=${baseDir}`,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const native = require(modulePath) as GhosttyNative;
    return {
      native,
      message: `Native module loaded: ${native.version()}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      native: null,
      message: `Failed to load native module: ${message}`,
    };
  }
}
