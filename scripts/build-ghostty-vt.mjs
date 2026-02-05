import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const zigDir = join(root, "native", "ghostty_vt", "zig");
const prefix = join(root, "native", "ghostty_vt", "zig-out");
const ghosttySrc = join(zigDir, "ghostty_src");

if (!existsSync(ghosttySrc)) {
  throw new Error(
    "ghostty sources not found. Expected symlink at native/ghostty_vt/zig/ghostty_src."
  );
}

function findZig() {
  if (process.env.ZIG) {
    return process.env.ZIG;
  }

  const fallback = join(root, ".context", "zig", "zig");
  if (existsSync(fallback)) {
    return fallback;
  }

  const check = spawnSync("zig", ["version"], { encoding: "utf8" });
  if (check.status === 0) {
    const version = String(check.stdout || "").trim();
    if (version === "0.14.1") {
      return "zig";
    }
  }
  const bootstrap = spawnSync(process.execPath, [
    join(root, "scripts", "bootstrap-zig.mjs"),
  ], {
    stdio: "inherit",
  });

  if (bootstrap.status === 0 && existsSync(fallback)) {
    return fallback;
  }

  throw new Error(
    "Zig not found. Install Zig 0.14.1 or run `bun run bootstrap:zig`."
  );
}

const zig = findZig();
const result = spawnSync(
  zig,
  ["build", "-Doptimize=ReleaseFast", "--prefix", prefix],
  { cwd: zigDir, stdio: "inherit" }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
