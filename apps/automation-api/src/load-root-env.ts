import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const rootEnvPath = resolve(__dirname, "../../../.env");
if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath);
