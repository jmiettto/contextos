#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPi = join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
const npxExecutable = process.platform === "win32" ? "npx.cmd" : "npx";

if (process.argv.includes("--contextos-version")) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}

const piExecutable = executableExists(localPi) ? localPi : commandExists("pi") ? "pi" : npxExecutable;
const args =
  piExecutable === npxExecutable
    ? ["-y", "@earendil-works/pi-coding-agent", "-e", packageRoot, ...process.argv.slice(2)]
    : ["-e", packageRoot, ...process.argv.slice(2)];

const child = spawn(piExecutable, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    CONTEXTOS_PACKAGE_ROOT: packageRoot
  }
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("contextOS could not find pi or npx.");
    console.error("Reinstall with: npm install -g github:jmiettto/contextos");
    process.exit(127);
  }
  console.error(`contextOS failed to start: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function executableExists(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command) {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const folder of pathValue.split(process.platform === "win32" ? ";" : ":")) {
    for (const extension of extensions) {
      if (executableExists(join(folder, `${command}${extension}`))) return true;
    }
  }
  return false;
}
