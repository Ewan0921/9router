#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const major = Number(process.versions.node.split(".")[0]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.error) throw r.error;
  process.exit(r.status ?? 1);
}

if (major < 22) {
  // Actions setup-node may still be 20; re-run this pack under Node 22 from npx.
  // `node` npm package exposes a real Node binary used as: npx node@VER <script>
  console.log(`[cli-pack] Node ${process.version} < 22; re-exec under node@22.23.4 via npx`);
  run("npx", ["--yes", "node@22.23.4", path.join(root, "scripts", "cli-pack-node22.mjs")], { cwd: root });
}

// Running on Node >=22: invoke the normal CLI pack.
console.log(`[cli-pack] using Node ${process.version}`);
run("npm", ["--prefix", "cli", "run", "pack:cli"], { cwd: root, env: process.env });
