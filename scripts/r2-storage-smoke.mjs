import "dotenv/config";
import assert from "node:assert/strict";
import { StorageService } from "../apps/api/dist/storage/storage.service.js";

const storage = new StorageService();
let key;
try {
  const payload = Buffer.from("maqar-r2-smoke");
  const stored = await storage.put(payload, "smoke.txt", "text/plain", "smoke-tests");
  key = stored.key;
  const loaded = await storage.get(key);
  assert.deepEqual(loaded, payload);
  console.log("R2 storage round trip: PASS");
} finally {
  if (key) await storage.delete(key);
}
