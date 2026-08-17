import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

// npm workspaces run the API with apps/api as the current working directory.
// Keep a single local .env at the repository root, while production platforms
// (Railway, Docker, etc.) continue to inject process.env normally.
const rootEnvPath = resolve(__dirname, "../../../.env");

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}
