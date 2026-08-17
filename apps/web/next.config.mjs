import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Next runs from apps/web in this workspace. Load the repository-root .env for
// local development/builds so API and Web share one local configuration file.
// On Railway there is no committed .env, so injected service variables remain
// the source of truth.
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath);

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
