import { spawnSync } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(repositoryRoot, "apps", "web");
const webNodeModules = resolve(webRoot, "node_modules");
const eslintEntry = resolve(repositoryRoot, "node_modules", "eslint", "bin", "eslint.js");
const inheritedNodePath = process.env.NODE_PATH;

const result = spawnSync(process.execPath, [eslintEntry, "."], {
  cwd: webRoot,
  env: {
    ...process.env,
    NODE_PATH: inheritedNodePath
      ? `${webNodeModules}${delimiter}${inheritedNodePath}`
      : webNodeModules,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
