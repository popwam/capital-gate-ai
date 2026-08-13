import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ApplicationCache } from "./application-cache";

test("bounded cache returns a hit and namespace invalidation forces a miss", async () => {
  const cache = new ApplicationCache(3);
  let loads = 0;
  const load = () => Promise.resolve(++loads);
  assert.equal(await cache.getOrLoad("property-search", "filters", 60_000, load), 1);
  assert.equal(await cache.getOrLoad("property-search", "filters", 60_000, load), 1);
  assert.equal(cache.stats().hits, 1);
  cache.invalidate("property-search");
  assert.equal(await cache.getOrLoad("property-search", "filters", 60_000, load), 2);
});

test("customer-data invalidation clears search, aggregation, project and media data", () => {
  const cache = new ApplicationCache();
  for (const namespace of ["property-search", "aggregation", "project-public", "project-media"]) cache.set(namespace, "key", { safe: true }, 60_000);
  cache.set("unrelated", "key", "kept", 60_000);
  cache.invalidateCustomerData();
  assert.equal(cache.get("property-search", "key"), undefined);
  assert.equal(cache.get("aggregation", "key"), undefined);
  assert.equal(cache.get("project-media", "key"), undefined);
  assert.equal(cache.get("unrelated", "key"), "kept");
});
