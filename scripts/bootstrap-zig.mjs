import { spawnSync } from "child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { join } from "path";

const version = "0.14.1";

const platformMap = {
  darwin: "macos",
  linux: "linux",
};

const archMap = {
  arm64: "aarch64",
  x64: "x86_64",
};

const os = platformMap[process.platform];
const arch = archMap[process.arch];

if (!os || !arch) {
  throw new Error(
    `Unsupported platform/arch for Zig bootstrap: ${process.platform}/${process.arch}`
  );
}

const fileName = `zig-${arch}-${os}-${version}.tar.xz`;
const url = `https://ziglang.org/download/${version}/${fileName}`;

const root = join(process.cwd());
const contextDir = join(root, ".context", "zig");
const tarPath = join(contextDir, fileName);
const extractRoot = join(contextDir, `zig-${arch}-${os}-${version}`);
const zigBin = join(extractRoot, "zig");
const linkPath = join(contextDir, "zig");

if (existsSync(linkPath)) {
  console.log(`Zig already present at ${linkPath}`);
  process.exit(0);
}

mkdirSync(contextDir, { recursive: true });

console.log(`Downloading ${url}`);
const curl = spawnSync("curl", ["-fL", "-o", tarPath, url], {
  stdio: "inherit",
});
if (curl.status !== 0) {
  process.exit(curl.status ?? 1);
}

console.log(`Extracting ${tarPath}`);
const tar = spawnSync("tar", ["-xJf", tarPath, "-C", contextDir], {
  stdio: "inherit",
});
if (tar.status !== 0) {
  process.exit(tar.status ?? 1);
}

if (!existsSync(zigBin)) {
  throw new Error(`Zig binary not found at ${zigBin}`);
}

try {
  rmSync(linkPath);
} catch {
  // ignore
}
symlinkSync(zigBin, linkPath);
console.log(`Zig installed at ${linkPath}`);
